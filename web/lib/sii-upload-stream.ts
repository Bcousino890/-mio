// ─────────────────────────────────────────────────────────────────────────────
// sii-upload-stream.ts — lógica común a las dos vías de ingesta de archivos
// SII: subida manual vía multipart (app/api/admin/sii-upload/route.ts) y
// descarga server-side desde Google Drive (.../sii-upload/from-url/route.ts).
// Clasifica archivos por comuna/código y consume `ingestSiiCatastroComuna`
// emitiendo progreso como objetos NDJSON.
// ─────────────────────────────────────────────────────────────────────────────
import { ingestSiiCatastroComuna, type SiiIngestFiles } from './sii-catastro-ingest'

export interface UploadedFile {
  name: string
  path: string
}

// Nombres oficiales de los 5 archivos planos del SII (ver glosarios
// "Estructura de archivo para Detalle Catastral / Rol de Cobro" en
// sii.cl → Descarga de Información Vigente por Comuna). Siempre terminan en
// "_<año>_<semestre>_<códigoComuna>", con o sin extensión.
const FILE_KIND_TO_ROLE: Record<string, keyof SiiIngestFiles> = {
  BRTMPCATASN: 'rolesNoAgricolas',
  BRTMPCATASNL: 'construccionesNoAgricolas',
  BRTMPCATASA: 'rolesAgricolas',
  BRTMPCATASAL: 'suelosConstruccionesAgricolas',
  BRTMPROLSEM: 'rolDeCobro',
}
// Orden con los prefijos más largos primero (BRTMPCATASNL antes de
// BRTMPCATASN, BRTMPCATASAL antes de BRTMPCATASA) para que el regex no
// matchee el prefijo corto por error.
const KIND_PATTERN = Object.keys(FILE_KIND_TO_ROLE).sort((a, b) => b.length - a.length).join('|')
const FILENAME_RE = new RegExp(`^(${KIND_PATTERN})_(\\d+)_(\\d+)_(\\d+)$`, 'i')

// CSV nacional de catastral.cl — nombre: catastro_YYYY_N.csv o catastro_YYYYSN.csv
const CATASTRAL_CL_RE = /^catastro[_\-]?\d{4}[_\-s]?\d\.csv$/i

export function sanitizeBaseName(name: string): string {
  // path.basename ya evita "../", pero el nombre puede traer separadores de
  // Windows si el zip se generó ahí.
  return name.split(/[\\/]/).pop() ?? name
}

export function groupSiiFiles(entries: UploadedFile[]): {
  filePorComuna: Record<string, Partial<SiiIngestFiles>>
  skipped: string[]
} {
  const skipped: string[] = []
  const filePorComuna: Record<string, Partial<SiiIngestFiles>> = {}

  for (const entry of entries) {
    // Detectar CSV nacional de catastral.cl (catastro_2025_2.csv, etc.)
    if (CATASTRAL_CL_RE.test(entry.name)) {
      const code = 'catastral_cl'
      if (!filePorComuna[code]) filePorComuna[code] = {}
      filePorComuna[code].catastralCl = entry.path
      continue
    }

    const base = entry.name.replace(/\.[^.]+$/, '')
    const match = base.match(FILENAME_RE)
    if (!match) {
      skipped.push(entry.name)
      continue
    }
    const kind = match[1].toUpperCase()
    const fileComunaCode = match[4]
    if (!filePorComuna[fileComunaCode]) filePorComuna[fileComunaCode] = {}
    const role = FILE_KIND_TO_ROLE[kind]
    filePorComuna[fileComunaCode][role] = entry.path
  }

  return { filePorComuna, skipped }
}

export type SendFn = (obj: Record<string, unknown>) => void

// Recorre cada grupo (comunaCode o 'catastral_cl' para el CSV nacional),
// ingesta y emite progreso por `send` a medida que ocurre. Usado tanto por
// la subida manual como por la importación desde Google Drive para no
// duplicar este bucle ni el contrato de mensajes NDJSON.
export async function ingestGroupedFilesStreaming(
  filePorComuna: Record<string, Partial<SiiIngestFiles>>,
  dbUrl: string,
  send: SendFn
): Promise<{ results: Array<Record<string, unknown>> }> {
  const results: Array<Record<string, unknown>> = []

  for (const [comunaCode, files] of Object.entries(filePorComuna)) {
    send({ progress: true, comunaCode, status: 'procesando' })
    try {
      let lastTickTime = 0
      // catastral.cl tiene todas las comunas en un solo CSV — usamos '00000'
      // como placeholder; el parser resuelve el cod_comuna por fila.
      const resolvedCode = comunaCode === 'catastral_cl' ? '00000' : comunaCode
      const result = await ingestSiiCatastroComuna({
        comunaCode: resolvedCode,
        files: files as SiiIngestFiles,
        dbUrl,
        onProgress: (info) => {
          const now = Date.now()
          if (now - lastTickTime < 500) return
          lastTickTime = now
          send({ progress: true, comunaCode, status: 'procesando', ...info })
        },
      })
      results.push({ comunaCode, ...result })
      send({ progress: true, comunaCode, status: result.ok ? 'ok' : 'error', counts: result.counts, error: result.error })
    } catch (err) {
      console.error(`Error procesando ${comunaCode}:`, err)
      const error = err instanceof Error ? err.message : 'Error al procesar'
      results.push({ comunaCode, ok: false, counts: {}, error })
      send({ progress: true, comunaCode, status: 'error', error })
    }
  }

  return { results }
}

export function createNdjsonEncoder() {
  const encoder = new TextEncoder()
  return (obj: unknown) => encoder.encode(`${JSON.stringify(obj)}\n`)
}
