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
import {
  groupSiiFiles,
  ingestGroupedFilesStreaming,
  createNdjsonEncoder,
  sanitizeBaseName,
  type UploadedFile,
} from '@/lib/sii-upload-stream'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024  // 20 GB por archivo
const MAX_TOTAL_BYTES = 51 * 1024 * 1024 * 1024 // 51 GB total
const MAX_FILES = 20

// ── helpers ──────────────────────────────────────────────────────────────────

async function parseMultipart(
  request: NextRequest,
  workDir: string,
  onProgress?: (bytes: number) => void,
): Promise<UploadedFile[]> {
  const contentType = request.headers.get('content-type') ?? ''
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
    })
    const files: UploadedFile[] = []
    const writes: Promise<void>[] = []
    let totalBytes = 0
    let aborted = false

    function fail(err: Error) {
      if (aborted) return
      aborted = true
      reject(err)
    }

    busboy.on('file', (_field, stream, info) => {
      const name = sanitizeBaseName(info.filename || `file-${files.length + 1}`)
      const dest = join(workDir, name)
      const ws = createWriteStream(dest)
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        onProgress?.(totalBytes)
        if (totalBytes > MAX_TOTAL_BYTES) fail(new Error('Tamaño total excede el límite permitido'))
      })
      stream.on('limit', () => fail(new Error(`El archivo ${info.filename} excede el límite de tamaño`)))
      writes.push(
        pipeline(stream, ws)
          .then(() => { files.push({ name, path: dest }) })
          .catch((e) => fail(e instanceof Error ? e : new Error(String(e))))
      )
    })
    busboy.on('filesLimit', () => fail(new Error(`Máximo ${MAX_FILES} archivos por subida`)))
    busboy.on('finish', () => {
      if (!aborted) Promise.all(writes).then(() => resolve(files)).catch(reject)
    })
    busboy.on('error', reject)
    Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(busboy)
  })
}

async function extractZip(zipPath: string, destDir: string): Promise<UploadedFile[]> {
  await mkdir(destDir, { recursive: true })
  await execFileAsync('unzip', ['-o', '-q', '-j', zipPath, '-d', destDir])
  const entries: UploadedFile[] = []
  for (const name of await readdir(destDir)) {
    const p = join(destDir, name)
    const info = await stat(p)
    if (info.isFile()) entries.push({ name: sanitizeBaseName(name), path: p })
  }
  return entries
}

function loadParcelWithPython(
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

// ── process files already on disk ────────────────────────────────────────────

async function processFiles(
  inputPaths: { name: string; path: string }[],
  dbUrl: string,
  send: (obj: Record<string, unknown>) => void,
  workDir: string,
) {
  // expand ZIPs
  const flat: UploadedFile[] = []
  for (const f of inputPaths) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      send({ phase: 'extracting', file: f.name })
      const extractDir = join(workDir, `zip-${flat.length}`)
      flat.push(...await extractZip(f.path, extractDir))
    } else {
      flat.push(f)
    }
  }

  if (flat.length === 0) {
    send({ done: true, success: false, error: 'El ZIP no contenía archivos reconocidos' })
    return
  }

  // archivos ._xxx son metadata macOS (AppleDouble), ignorar
  const parcelFiles = flat.filter(f => /\.(parquet|gpkg)$/i.test(f.name) && !f.name.startsWith('._'))
  const siiFiles    = flat.filter(f => !/\.(parquet|gpkg)$/i.test(f.name) && !f.name.startsWith('._'))
  const summary: Record<string, unknown>[] = []

  if (parcelFiles.length > 0) {
    send({ phase: 'parcels', status: 'start', total: parcelFiles.length })
    let parcelRows = 0
    for (let i = 0; i < parcelFiles.length; i++) {
      const { name, path } = parcelFiles[i]
      send({ phase: 'parcels', status: 'processing', file: name, index: i + 1, total: parcelFiles.length })
      const result = await loadParcelWithPython(path, dbUrl, name)
      parcelRows += result.rows
      summary.push({ type: 'parcel', file: name, ...result })
      send({ phase: 'parcels', status: result.ok ? 'ok' : 'error', file: name, rows: result.rows, error: result.error, index: i + 1, total: parcelFiles.length })
    }
    send({ phase: 'parcels', status: 'done', totalRows: parcelRows, filesProcessed: parcelFiles.length })
  }

  if (siiFiles.length > 0) {
    const { filePorComuna, skipped } = groupSiiFiles(siiFiles)
    if (Object.keys(filePorComuna).length > 0) {
      send({ phase: 'sii', status: 'start', total: Object.keys(filePorComuna).length })
      const { results } = await ingestGroupedFilesStreaming(filePorComuna, dbUrl, send)
      for (const r of results) summary.push({ type: 'sii', ...r })
      send({ phase: 'sii', status: 'done', skipped })
    } else {
      send({ phase: 'sii', status: 'skipped', skipped, message: 'Sin archivos SII reconocidos' })
    }
  }

  const anyOk = summary.some((r) => (r as { ok?: boolean }).ok !== false)
  send({
    done: true,
    success: anyOk,
    error: anyOk ? undefined : 'Ningún archivo se procesó correctamente',
    data: { summary },
  })
}

// ── main handler ─────────────────────────────────────────────────────────────
// Acepta dos modos:
//   A) JSON body { paths: [{name, path},...] }  → procesa archivos ya en disco
//   B) multipart/form-data                       → sube + procesa en un paso

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return new Response(
      JSON.stringify({ done: true, success: false, error: 'DATABASE_URL no configurado' }) + '\n',
      { status: 500 },
    )
  }
  const dbUrl = process.env.DATABASE_URL
  const encode = createNdjsonEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: Record<string, unknown>) { controller.enqueue(encode(obj)) }
      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'ingest-'))
        const ct = request.headers.get('content-type') ?? ''

        let inputPaths: { name: string; path: string }[]

        if (ct.includes('application/json')) {
          // Modo A: archivos ya en disco (enviados por el panel después de upload-raw)
          const body = await request.json() as { paths?: { name: string; path: string }[] }
          inputPaths = body.paths ?? []
          if (inputPaths.length === 0) {
            send({ done: true, success: false, error: 'No se indicaron archivos' }); return
          }
        } else {
          // Modo B: multipart — sube y procesa en un paso (archivos pequeños)
          const totalReqBytes = Number(request.headers.get('content-length') ?? 0) || 0
          let lastReport = 0
          const uploaded = await parseMultipart(request, workDir, (loaded) => {
            if (!totalReqBytes) return
            const now = Date.now()
            if (now - lastReport < 500) return
            lastReport = now
            send({ phase: 'uploading', loadedBytes: loaded, totalBytes: totalReqBytes })
          })
          if (totalReqBytes) send({ phase: 'uploading', loadedBytes: totalReqBytes, totalBytes: totalReqBytes })
          if (uploaded.length === 0) {
            send({ done: true, success: false, error: 'No se recibió ningún archivo' }); return
          }
          inputPaths = uploaded
        }

        await processFiles(inputPaths, dbUrl, send, workDir)
      } catch (err) {
        send({ done: true, success: false, error: err instanceof Error ? err.message : String(err) })
      } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
