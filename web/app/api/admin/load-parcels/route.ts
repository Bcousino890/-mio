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
  fileName: string,
): Promise<{ ok: boolean; rows: number; error?: string }> {
  return new Promise((resolve) => {
    const script = `
import sys, os, re, warnings
warnings.filterwarnings('ignore')
import geopandas as gpd
import sqlalchemy as sa
from sqlalchemy import text
from shapely.geometry import MultiPolygon

path = ${JSON.stringify(filePath)}
file_name = ${JSON.stringify(fileName)}
db_url = ${JSON.stringify(dbUrl)}
# SQLAlchemy 1.4+ eliminó el alias "postgres" — exige "postgresql"
if db_url.startswith('postgres://'):
    db_url = 'postgresql://' + db_url[len('postgres://'):]

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
        if cl in ('rol','rol_avaluo','num_rol','folio'): rename[col]='rol'
    if rename: gdf = gdf.rename(columns=rename)
    if 'rol' not in gdf.columns:
        gdf['rol'] = None

    gdf = gdf[['rol', gdf.geometry.name]].copy()
    gdf = gdf.rename_geometry('geom')
    gdf['geom'] = gdf['geom'].apply(
        lambda g: MultiPolygon([g]) if g is not None and g.geom_type == 'Polygon' else g
    )
    gdf = gdf[gdf['geom'].notna()]

    # cadastre_parcels_cl (ver 0020_cadastre_chile.sql) usa comuna_id (FK a
    # chile_comunas), no una columna sii_comuna_code directa. El código
    # numérico del nombre de archivo (ej. "Lo_Barnechea_15161") no es
    # confiable como sii_comuna_code (ver 0022-0027), así que la comuna se
    # resuelve por nombre.
    stem = os.path.splitext(file_name)[0]
    comuna_name = re.sub(r'_\\d+$', '', stem).replace('_', ' ').strip()

    engine = sa.create_engine(db_url)
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id FROM chile_comunas WHERE name ILIKE :n"),
            {"n": comuna_name},
        ).fetchone()
        if row is None:
            print(f"ERR:No se encontró la comuna '{comuna_name}' (de archivo {file_name}) en chile_comunas")
            sys.exit(0)
        comuna_id = str(row[0])

    gdf['comuna_id'] = comuna_id
    gdf['source'] = 'catastral_cl'
    gdf = gdf[['comuna_id', 'rol', 'geom', 'source']]

    gdf.to_postgis('cadastre_parcels_cl', engine, if_exists='append', index=False)
    print(f"OK:{len(gdf)}")
except Exception as e:
    print("ERR:" + str(e).replace(chr(10), ' | '))
`
    let out = ''
    let err = ''
    const proc = spawn('python3', ['-c', script])
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code) => {
      const line = out.trim().split('\n').pop() ?? ''
      if (line.startsWith('OK:'))        resolve({ ok: true, rows: parseInt(line.slice(3)) || 0 })
      else if (line.startsWith('SKIP:')) resolve({ ok: true, rows: 0 })
      else {
        const errMsg = line.replace('ERR:', '') || err.trim().split('\n').pop() || `exit ${code}`
        resolve({ ok: false, rows: 0, error: errMsg })
      }
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
            toProcess.push(...extracted.filter(p => /\.(parquet|gpkg)$/i.test(p) && !p.split('/').pop()!.startsWith('._')))
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

          const result = await loadFileWithPython(filePath, process.env.DATABASE_URL!, fileName)
          totalRows += result.rows
          results.push({ file: fileName, ...result })
          send({ progress: true, status: result.ok ? 'ok' : 'error', file: fileName, rows: result.rows, error: result.error, index: i + 1, total: toProcess.length })
        }

        const anyOk = results.some((r) => r.ok)
        send({
          done: true,
          success: anyOk,
          error: anyOk ? undefined : (results[0]?.error ?? 'Ningún archivo se procesó correctamente'),
          data: { results, totalRows, filesProcessed: toProcess.length },
        })
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
