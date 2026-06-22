import { NextRequest } from 'next/server'
import { mkdtemp, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import Busboy from 'busboy'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 11 * 1024 * 1024 * 1024  // 11 GB
const MAX_FILES = 5  // por request (ZIPs o Parquets sueltos)

function sanitize(name: string) {
  return name.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._\-]/g, '_') ?? 'file'
}

async function parseMultipart(request: NextRequest, workDir: string): Promise<string[]> {
  const contentType = request.headers.get('content-type') ?? ''
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
    })
    const paths: string[] = []
    const writes: Promise<void>[] = []
    let aborted = false

    busboy.on('file', (_field, stream, info) => {
      const dest = join(workDir, sanitize(info.filename || `file-${paths.length + 1}`))
      const ws = createWriteStream(dest)
      writes.push(
        pipeline(stream, ws)
          .then(() => { paths.push(dest) })
          .catch((e) => { if (!aborted) { aborted = true; reject(e) } })
      )
    })
    busboy.on('filesLimit', () => reject(new Error(`Máximo ${MAX_FILES} archivos por subida`)))
    busboy.on('finish', () => {
      if (!aborted) Promise.all(writes).then(() => resolve(paths)).catch(reject)
    })
    busboy.on('error', reject)
    Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(busboy)
  })
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  await mkdir(destDir, { recursive: true })
  // -j aplana todas las rutas (evita zip-slip), -o sobreescribe
  await execFileAsync('unzip', ['-o', '-q', '-j', zipPath, '-d', destDir])
  const entries: string[] = []
  for (const name of await readdir(destDir)) {
    const p = join(destDir, name)
    const info = await stat(p)
    if (info.isFile()) entries.push(p)
  }
  return entries
}

function loadFileWithPython(
  filePath: string,
  dbUrl: string,
): Promise<{ ok: boolean; rows: number; error?: string }> {
  return new Promise((resolve) => {
    const script = `
import sys, os, warnings
warnings.filterwarnings('ignore')
import geopandas as gpd
import sqlalchemy as sa
from sqlalchemy import text
from shapely.geometry import MultiPolygon

path = ${JSON.stringify(filePath)}
db_url = ${JSON.stringify(dbUrl)}

try:
    ext = os.path.splitext(path)[1].lower()
    if ext == '.gpkg':
        gdf = gpd.read_file(path)
    elif ext == '.parquet':
        gdf = gpd.read_parquet(path)
    else:
        print(f"SKIP:formato no soportado {ext}")
        sys.exit(0)

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    rename = {}
    for col in gdf.columns:
        cl = col.lower()
        if cl in ('cod_comuna','comuna','cut','sii_comuna_code','codigo_comuna'): rename[col]='sii_comuna_code'
        elif cl in ('rol','rol_avaluo','num_rol','folio'): rename[col]='rol'
    if rename: gdf = gdf.rename(columns=rename)

    keep = [c for c in ('sii_comuna_code','rol') if c in gdf.columns]
    gdf = gdf[keep + [gdf.geometry.name]].copy()
    gdf = gdf.rename_geometry('geom')
    gdf['source'] = 'catastral_cl'
    gdf['geom'] = gdf['geom'].apply(
        lambda g: MultiPolygon([g]) if g is not None and g.geom_type == 'Polygon' else g
    )
    gdf = gdf[gdf['geom'].notna()]

    engine = sa.create_engine(db_url)
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cadastre_parcels_cl (
              id              bigserial PRIMARY KEY,
              sii_comuna_code text,
              rol             text,
              geom            geometry(MultiPolygon,4326),
              source          text DEFAULT 'catastral_cl',
              created_at      timestamptz DEFAULT now()
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cparcels_geom ON cadastre_parcels_cl USING gist(geom)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cparcels_rol  ON cadastre_parcels_cl(sii_comuna_code,rol)"))
        conn.commit()

    gdf.to_postgis('cadastre_parcels_cl', engine, if_exists='append', index=False)
    print(f"OK:{len(gdf)}")
except Exception as e:
    print(f"ERR:{e}")
`
    let out = ''
    const proc = spawn('python3', ['-c', script])
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', () => {})
    proc.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? ''
      if (line.startsWith('OK:'))   resolve({ ok: true,  rows: parseInt(line.slice(3)) || 0 })
      else if (line.startsWith('SKIP:')) resolve({ ok: true, rows: 0 })
      else resolve({ ok: false, rows: 0, error: line.replace('ERR:', '') || `exit ${code}` })
    })
    proc.on('error', (e) => resolve({ ok: false, rows: 0, error: e.message }))
  })
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return new Response(JSON.stringify({ done: true, success: false, error: 'DATABASE_URL no configurado' }) + '\n', { status: 500 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'))

      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'parcels-'))
        const uploaded = await parseMultipart(request, workDir)

        if (uploaded.length === 0) {
          send({ done: true, success: false, error: 'No se recibió ningún archivo' })
          controller.close(); return
        }

        // Expandir ZIPs — los archivos sueltos pasan directamente
        const toProcess: string[] = []
        for (const filePath of uploaded) {
          if (filePath.toLowerCase().endsWith('.zip')) {
            send({ progress: true, status: 'extracting', file: filePath.split('/').pop() })
            const extractDir = join(workDir, 'zip-' + toProcess.length)
            const extracted = await extractZip(filePath, extractDir)
            // Solo .parquet y .gpkg
            toProcess.push(...extracted.filter(p => /\.(parquet|gpkg)$/i.test(p)))
          } else if (/\.(parquet|gpkg)$/i.test(filePath)) {
            toProcess.push(filePath)
          }
        }

        if (toProcess.length === 0) {
          send({ done: true, success: false, error: 'No se encontraron archivos .parquet ni .gpkg en el ZIP' })
          controller.close(); return
        }

        send({ progress: true, status: 'start', total: toProcess.length })

        let totalRows = 0
        const results: { file: string; ok: boolean; rows: number; error?: string }[] = []

        for (let i = 0; i < toProcess.length; i++) {
          const filePath = toProcess[i]
          const fileName = filePath.split('/').pop() ?? filePath
          send({ progress: true, status: 'processing', file: fileName, index: i + 1, total: toProcess.length })

          const result = await loadFileWithPython(filePath, process.env.DATABASE_URL!)
          totalRows += result.rows
          results.push({ file: fileName, ...result })
          send({ progress: true, status: result.ok ? 'ok' : 'error', file: fileName, rows: result.rows, error: result.error, index: i + 1, total: toProcess.length })
        }

        send({ done: true, success: true, data: { results, totalRows, filesProcessed: toProcess.length } })
      } catch (err) {
        send({ done: true, success: false, error: err instanceof Error ? err.message : 'Error desconocido' })
      } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
    },
  })
}
