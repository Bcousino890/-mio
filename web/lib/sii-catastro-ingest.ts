// ─────────────────────────────────────────────────────────────────────────────
// sii-catastro-ingest.ts — ingesta de los archivos planos oficiales del SII
// (Detalle Catastral + Rol de Cobro) a `sii_roles_cl` / `sii_construcciones_cl`.
//
// Duplicado (con ajustes) de `scraper/lib/sii-catastro-cl.mjs` — mismo motivo
// que la duplicación de `SII_DESTINO_LABELS` en `app/api/chile/sii-roles/route.ts`:
// web/ y scraper/ son proyectos Node separados y el build Docker de web/ solo
// incluye su propio directorio (contexto `../web` en infra/docker-compose.yml),
// así que scraper/lib no está disponible para la app en producción.
//
// Diferencia deliberada frente al original: cada archivo se ingesta dentro de
// una única transacción (en vez de autocommit fila por fila) y las filas se
// insertan/actualizan en bloques (vía `unnest`) en vez de una query por fila
// — con cientos de miles de filas por comuna, una query síncrona por fila
// tardaba minutos y la conexión moría (502/ERR_EMPTY_RESPONSE) antes de que
// el endpoint HTTP que la dispara (ver app/api/admin/sii-upload/route.ts)
// pudiera responder nada.
//
// ORIGEN DE LOS DATOS: sii.cl publica un botón de descarga masiva de
// autoservicio por comuna ("Avalúos y Contribuciones de Bienes Raíces" →
// "Descarga de Información Vigente por Comuna"). Un humano lo descarga
// manualmente y sube el archivo resultante a este sistema vía /configuracion.
// Este módulo SOLO lee archivos que ya están en disco — JAMÁS hace una
// petición HTTP/scraping contra sii.cl. Ver migración 0021_sii_catastro_cl.sql.
// ─────────────────────────────────────────────────────────────────────────────
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Client } from 'pg'

// Tamaño de bloque para los INSERT/UPSERT por lotes (vía unnest). Suficiente
// para convertir cientos de miles de filas en unos pocos cientos de queries.
const BATCH_SIZE = 2000

function splitPipeLine(line: string): string[] {
  const parts = line.split('|')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function toIntOrNull(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isNaN(n) ? null : n
}

function toTextOrNull(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed
}

function stripLeadingZeros(raw: unknown): string | null {
  const n = toIntOrNull(raw)
  return n === null ? null : String(n)
}

export function normalizeRol(manzana: unknown, predio: unknown): string | null {
  const m = stripLeadingZeros(manzana)
  const p = stripLeadingZeros(predio)
  if (m === null || p === null) return null
  return `${m}-${p}`
}

function normalizeRolTriple(comuna: unknown, manzana: unknown, predio: unknown): string | null {
  const m = toIntOrNull(manzana)
  const p = toIntOrNull(predio)
  if (!m && !p) return null
  const c = toTextOrNull(comuna)
  return `${c}-${stripLeadingZeros(manzana)}-${stripLeadingZeros(predio)}`
}

/**
 * Normaliza un Rol de Avalúo ya compuesto "manzana-predio" al mismo formato
 * que usa sii_roles_cl.rol (sin ceros a la izquierda, ej. "02452-00014" →
 * "2452-14"). Necesario porque el rol que llega de cadastre_parcels_cl (clic
 * en el mapa), de un deep-link compartido, o de la caja de búsqueda puede
 * traer el padding de ceros del origen y romper el match exacto contra
 * sii_roles_cl. Si el string no matchea "manzana-predio" numérico, se
 * devuelve tal cual (p. ej. rol_padre con formato "comuna-manzana-predio").
 */
export function normalizeClRol(raw: string): string {
  const trimmed = raw.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return trimmed
  return `${parseInt(parts[0], 10)}-${parseInt(parts[1], 10)}`
}

async function* readLines(filePath: string, onBytes?: (bytesRead: number) => void): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  let lineCount = 0
  for await (const line of rl) {
    if (line.length === 0) continue
    lineCount++
    // bytesRead del ReadStream da progreso real sin una pasada extra sobre
    // el archivo; se reporta cada 5000 líneas para no llamar al callback en
    // cada iteración de un archivo de millones de filas.
    if (onBytes && lineCount % 5000 === 0) onBytes(stream.bytesRead)
    yield line
  }
  onBytes?.(stream.bytesRead)
}

const ROLES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal',
  'avaluo_exento', 'codigo_ubicacion',
]

const SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'codigo_suelo', 'superficie_suelo_ha',
  'linea', 'material_code', 'calidad_code', 'superficie_m2', 'destino_code',
  'condicion_especial', 'numero_pisos',
]

const ROLES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal', 'avaluo_exento',
  'rbc1_comuna', 'rbc1_manzana', 'rbc1_predio',
  'rbc2_comuna', 'rbc2_manzana', 'rbc2_predio',
  'superficie_terreno_m2', 'codigo_ubicacion',
  'padre_comuna', 'padre_manzana', 'padre_predio',
]

const CONSTRUCCIONES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'linea', 'material_code', 'calidad_code',
  'anio_construccion', 'superficie_m2', 'destino_code', 'condicion_especial', 'numero_pisos',
]

async function* parsePipeFile(filePath: string, fieldNames: string[]): AsyncGenerator<Record<string, string | null>> {
  for await (const line of readLines(filePath)) {
    const parts = splitPipeLine(line)
    const record: Record<string, string | null> = {}
    for (let i = 0; i < fieldNames.length; i++) {
      record[fieldNames[i]] = parts[i] ?? null
    }
    yield record
  }
}

async function* parseRolesAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, ROLES_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      serie: 'agricola' as const,
      direccion: toTextOrNull(r.direccion),
      avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
      contribucion_semestral: toIntOrNull(r.contribucion_semestral),
      codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
      avaluo_exento: toIntOrNull(r.avaluo_exento),
      codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
    }
  }
}

async function* parseSuelosConstruccionesAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      codigo_suelo: toTextOrNull(r.codigo_suelo),
      superficie_suelo_ha: r.superficie_suelo_ha != null ? (toIntOrNull(r.superficie_suelo_ha) ?? 0) / 100 : null,
      linea: toIntOrNull(r.linea),
      material_code: toTextOrNull(r.material_code),
      calidad_code: toTextOrNull(r.calidad_code),
      superficie_m2: toIntOrNull(r.superficie_m2),
      destino_code: toTextOrNull(r.destino_code),
      condicion_especial: toTextOrNull(r.condicion_especial),
      numero_pisos: toIntOrNull(r.numero_pisos),
    }
  }
}

async function* parseRolesNoAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, ROLES_NO_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      serie: 'no_agricola' as const,
      direccion: toTextOrNull(r.direccion),
      avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
      contribucion_semestral: toIntOrNull(r.contribucion_semestral),
      codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
      avaluo_exento: toIntOrNull(r.avaluo_exento),
      rol_bien_comun_1: normalizeRolTriple(r.rbc1_comuna, r.rbc1_manzana, r.rbc1_predio),
      rol_bien_comun_2: normalizeRolTriple(r.rbc2_comuna, r.rbc2_manzana, r.rbc2_predio),
      superficie_terreno_m2: toIntOrNull(r.superficie_terreno_m2),
      codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
      rol_padre: normalizeRolTriple(r.padre_comuna, r.padre_manzana, r.padre_predio),
    }
  }
}

async function* parseConstruccionesNoAgricolas(filePath: string) {
  for await (const r of parsePipeFile(filePath, CONSTRUCCIONES_NO_AGRICOLAS_FIELDS)) {
    yield {
      sii_comuna_code: toTextOrNull(r.sii_comuna_code),
      manzana: toTextOrNull(r.manzana),
      predio: toTextOrNull(r.predio),
      rol: normalizeRol(r.manzana, r.predio),
      linea: toIntOrNull(r.linea),
      material_code: toTextOrNull(r.material_code),
      calidad_code: toTextOrNull(r.calidad_code),
      anio_construccion: toIntOrNull(r.anio_construccion),
      superficie_m2: toIntOrNull(r.superficie_m2),
      destino_code: toTextOrNull(r.destino_code),
      condicion_especial: toTextOrNull(r.condicion_especial),
      numero_pisos: toIntOrNull(r.numero_pisos),
    }
  }
}

// Rol de Cobro: ancho fijo, 117 caracteres, posiciones 1-indexadas tal cual
// "estructura_rol_cobro_1.pdf" (confirmado contra datos reales de Las Condes).
const ROL_COBRO_FIELDS: Array<[string, number, number]> = [
  ['comuna', 1, 5],
  ['anio', 6, 9],
  ['semestre', 10, 10],
  ['aseo', 11, 11],
  ['direccion', 18, 57],
  ['manzana', 58, 62],
  ['predio', 63, 67],
  ['serie', 68, 68],
  ['cuota_trimestral', 69, 81],
  ['avaluo_total', 82, 96],
  ['avaluo_exento', 97, 111],
  ['anio_termino_exencion', 112, 115],
  ['codigo_ubicacion', 116, 116],
  ['codigo_destino', 117, 117],
]

function parseRolCobroLine(line: string) {
  const get = (ini: number, fin: number) => line.slice(ini - 1, fin)
  const raw: Record<string, string> = {}
  for (const [name, ini, fin] of ROL_COBRO_FIELDS) raw[name] = get(ini, fin)

  return {
    sii_comuna_code: toTextOrNull(raw.comuna),
    anio: toIntOrNull(raw.anio),
    semestre: toIntOrNull(raw.semestre),
    direccion: toTextOrNull(raw.direccion),
    manzana: toTextOrNull(raw.manzana),
    predio: toTextOrNull(raw.predio),
    rol: normalizeRol(raw.manzana, raw.predio),
    serie: toTextOrNull(raw.serie) === 'A' ? ('agricola' as const) : ('no_agricola' as const),
    cuota_trimestral: toIntOrNull(raw.cuota_trimestral),
    avaluo_total: toIntOrNull(raw.avaluo_total),
    avaluo_exento: toIntOrNull(raw.avaluo_exento),
    codigo_ubicacion: toTextOrNull(raw.codigo_ubicacion),
    codigo_destino: toTextOrNull(raw.codigo_destino),
  }
}

async function* parseRolDeCobro(filePath: string) {
  for await (const line of readLines(filePath)) {
    if (line.length !== 117) continue // línea corrupta/truncada — se descarta, no se lanza
    yield parseRolCobroLine(line)
  }
}

function basename(filePath: string): string {
  return String(filePath).split('/').pop() ?? filePath
}

async function resolveComunaId(client: Client, comunaCode: string): Promise<string | null> {
  const res = await client.query(`SELECT id FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`, [comunaCode])
  return res.rows[0]?.id ?? null
}

interface RolBatchRow {
  comuna_id: string | null
  sii_comuna_code: string | null
  manzana: string | null
  predio: string | null
  rol: string
  serie: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  avaluo_exento: number | null
  contribucion_semestral: number | null
  codigo_destino_principal: string | null
  codigo_ubicacion: string | null
  superficie_terreno_m2: number | null
  rol_bien_comun_1: string | null
  rol_bien_comun_2: string | null
  rol_padre: string | null
  raw_source: string
}

async function flushRolesBatch(client: Client, batch: RolBatchRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const res = await client.query(
    `
    INSERT INTO sii_roles_cl (
      comuna_id, sii_comuna_code, manzana, predio, rol, serie,
      direccion, avaluo_fiscal_total, avaluo_exento, contribucion_semestral,
      codigo_destino_principal, codigo_ubicacion,
      superficie_terreno_m2, rol_bien_comun_1, rol_bien_comun_2, rol_padre,
      raw_source
    )
    SELECT * FROM unnest(
      $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
      $7::text[], $8::bigint[], $9::bigint[], $10::bigint[],
      $11::text[], $12::text[],
      $13::int[], $14::text[], $15::text[], $16::text[],
      $17::text[]
    )
    ON CONFLICT (sii_comuna_code, manzana, predio) DO UPDATE SET
      direccion                = EXCLUDED.direccion,
      avaluo_fiscal_total       = EXCLUDED.avaluo_fiscal_total,
      avaluo_exento             = EXCLUDED.avaluo_exento,
      contribucion_semestral    = EXCLUDED.contribucion_semestral,
      codigo_destino_principal  = EXCLUDED.codigo_destino_principal,
      codigo_ubicacion          = EXCLUDED.codigo_ubicacion,
      superficie_terreno_m2     = COALESCE(EXCLUDED.superficie_terreno_m2, sii_roles_cl.superficie_terreno_m2),
      rol_bien_comun_1          = COALESCE(EXCLUDED.rol_bien_comun_1, sii_roles_cl.rol_bien_comun_1),
      rol_bien_comun_2          = COALESCE(EXCLUDED.rol_bien_comun_2, sii_roles_cl.rol_bien_comun_2),
      rol_padre                 = COALESCE(EXCLUDED.rol_padre, sii_roles_cl.rol_padre),
      raw_source                = EXCLUDED.raw_source,
      updated_at                = now()
    `,
    [
      batch.map((r) => r.comuna_id),
      batch.map((r) => r.sii_comuna_code),
      batch.map((r) => r.manzana),
      batch.map((r) => r.predio),
      batch.map((r) => r.rol),
      batch.map((r) => r.serie),
      batch.map((r) => r.direccion),
      batch.map((r) => r.avaluo_fiscal_total),
      batch.map((r) => r.avaluo_exento),
      batch.map((r) => r.contribucion_semestral),
      batch.map((r) => r.codigo_destino_principal),
      batch.map((r) => r.codigo_ubicacion),
      batch.map((r) => r.superficie_terreno_m2),
      batch.map((r) => r.rol_bien_comun_1),
      batch.map((r) => r.rol_bien_comun_2),
      batch.map((r) => r.rol_padre),
      batch.map((r) => r.raw_source),
    ]
  )
  return res.rowCount ?? 0
}

interface RolCobroBatchRow {
  comuna_id: string | null
  sii_comuna_code: string | null
  manzana: string | null
  predio: string | null
  rol: string
  serie: string
  direccion: string | null
  anio: number | null
  semestre: number | null
  avaluo_total: number | null
  avaluo_exento: number | null
  cuota_trimestral: number | null
  codigo_ubicacion: string | null
  codigo_destino: string | null
  raw_source: string
}

async function flushRolDeCobroBatch(client: Client, batch: RolCobroBatchRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const res = await client.query(
    `
    INSERT INTO sii_roles_cl (
      comuna_id, sii_comuna_code, manzana, predio, rol, serie, direccion,
      rol_cobro_anio, rol_cobro_semestre, rol_cobro_direccion,
      rol_cobro_avaluo_total, rol_cobro_avaluo_exento, rol_cobro_cuota_trimestral,
      rol_cobro_codigo_ubicacion, rol_cobro_codigo_destino, raw_source
    )
    SELECT * FROM unnest(
      $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
      $8::int[], $9::int[], $10::text[],
      $11::bigint[], $12::bigint[], $13::bigint[],
      $14::text[], $15::text[], $16::text[]
    )
    ON CONFLICT (sii_comuna_code, manzana, predio) DO UPDATE SET
      direccion                   = COALESCE(sii_roles_cl.direccion, EXCLUDED.direccion),
      rol_cobro_anio              = EXCLUDED.rol_cobro_anio,
      rol_cobro_semestre          = EXCLUDED.rol_cobro_semestre,
      rol_cobro_direccion         = EXCLUDED.rol_cobro_direccion,
      rol_cobro_avaluo_total      = EXCLUDED.rol_cobro_avaluo_total,
      rol_cobro_avaluo_exento     = EXCLUDED.rol_cobro_avaluo_exento,
      rol_cobro_cuota_trimestral  = EXCLUDED.rol_cobro_cuota_trimestral,
      rol_cobro_codigo_ubicacion  = EXCLUDED.rol_cobro_codigo_ubicacion,
      rol_cobro_codigo_destino    = EXCLUDED.rol_cobro_codigo_destino,
      updated_at                  = now()
    `,
    [
      batch.map((r) => r.comuna_id),
      batch.map((r) => r.sii_comuna_code),
      batch.map((r) => r.manzana),
      batch.map((r) => r.predio),
      batch.map((r) => r.rol),
      batch.map((r) => r.serie),
      batch.map((r) => r.direccion),
      batch.map((r) => r.anio),
      batch.map((r) => r.semestre),
      batch.map((r) => r.direccion),
      batch.map((r) => r.avaluo_total),
      batch.map((r) => r.avaluo_exento),
      batch.map((r) => r.cuota_trimestral),
      batch.map((r) => r.codigo_ubicacion),
      batch.map((r) => r.codigo_destino),
      batch.map((r) => r.raw_source),
    ]
  )
  return res.rowCount ?? 0
}

interface ConstruccionBatchRow {
  rol_id: string
  linea: number | null
  material_code: string | null
  calidad_code: string | null
  anio_construccion: number | null
  superficie_m2: number | null
  destino_code: string | null
  condicion_especial: string | null
  numero_pisos: number | null
  codigo_suelo: string | null
  superficie_suelo_ha: number | null
}

async function flushConstruccionesBatch(client: Client, batch: ConstruccionBatchRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const res = await client.query(
    `
    INSERT INTO sii_construcciones_cl (
      rol_id, linea, material_code, calidad_code, anio_construccion,
      superficie_m2, destino_code, condicion_especial, numero_pisos,
      codigo_suelo, superficie_suelo_ha
    )
    SELECT * FROM unnest(
      $1::uuid[], $2::int[], $3::text[], $4::text[], $5::int[],
      $6::int[], $7::text[], $8::text[], $9::int[],
      $10::text[], $11::numeric[]
    )
    `,
    [
      batch.map((r) => r.rol_id),
      batch.map((r) => r.linea),
      batch.map((r) => r.material_code),
      batch.map((r) => r.calidad_code),
      batch.map((r) => r.anio_construccion),
      batch.map((r) => r.superficie_m2),
      batch.map((r) => r.destino_code),
      batch.map((r) => r.condicion_especial),
      batch.map((r) => r.numero_pisos),
      batch.map((r) => r.codigo_suelo),
      batch.map((r) => r.superficie_suelo_ha),
    ]
  )
  return res.rowCount ?? 0
}

// Mapa manzana|predio → rol_id para resolver las líneas de construcción/suelo
// sin una query SELECT por fila (eran cientos de miles de round-trips
// secuenciales — la causa real de los timeouts/502 en comunas grandes).
async function loadRolIdMap(client: Client, comunaCode: string): Promise<Map<string, string>> {
  const res = await client.query(
    `SELECT manzana, predio, id FROM sii_roles_cl WHERE sii_comuna_code = $1`,
    [comunaCode]
  )
  const map = new Map<string, string>()
  for (const row of res.rows) {
    map.set(`${row.manzana}|${row.predio}`, row.id)
  }
  return map
}

// ─── Parser catastral.cl CSV ─────────────────────────────────────────────────
// catastral.cl exporta un CSV con cabecera y todos los predios nacionales.
// Los nombres de columna pueden variar — se mapean con alias conocidos.
// Columnas exactas del CSV de catastral.cl (roles-backend pipeline/config.py)
// 38 columnas: periodo,anio,semestre,comuna,manzana,predio,rc_*,dc_*,serie
const CATASTRAL_CL_ALIASES: Record<string, string> = {
  // Identificadores
  comuna: 'sii_comuna_code', cod_comuna: 'sii_comuna_code',
  manzana: 'manzana', predio: 'predio',
  // Detalle Catastral (dc_)
  dc_direccion: 'direccion', direccion: 'direccion',
  dc_avaluo_fiscal: 'avaluo_fiscal_total', avaluo_fiscal_total: 'avaluo_fiscal_total',
  dc_avaluo_exento: 'avaluo_exento', avaluo_exento: 'avaluo_exento',
  dc_contribucion_semestral: 'contribucion_semestral', contribucion_semestral: 'contribucion_semestral',
  dc_cod_destino: 'codigo_destino_principal', codigo_destino_principal: 'codigo_destino_principal',
  dc_cod_ubicacion: 'codigo_ubicacion', codigo_ubicacion: 'codigo_ubicacion',
  dc_sup_terreno: 'superficie_terreno_m2', superficie_terreno_m2: 'superficie_terreno_m2',
  // Bien común (dc_bc1/bc2)
  dc_bc1_comuna: 'rbc1_comuna', dc_bc1_manzana: 'rbc1_manzana', dc_bc1_predio: 'rbc1_predio',
  dc_bc2_comuna: 'rbc2_comuna', dc_bc2_manzana: 'rbc2_manzana', dc_bc2_predio: 'rbc2_predio',
  dc_padre_comuna: 'padre_comuna', dc_padre_manzana: 'padre_manzana', dc_padre_predio: 'padre_predio',
  // Coordenadas (cuando vienen en CSV auxiliar o en versiones futuras)
  lat: 'lat', latitud: 'lat',
  lon: 'lng', lng: 'lng', longitud: 'lng',
  nombre_propietario: 'nombre_propietario', propietario: 'nombre_propietario',
}

function toFloatOrNull(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  const s = String(raw).trim().replace(',', '.')
  if (s === '') return null
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}

function parseCsvLine(line: string, delim: string): string[] {
  // Maneja campos entre comillas
  const fields: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote; continue }
    if (!inQuote && ch === delim) { fields.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  fields.push(cur.trim())
  return fields
}

async function* parseCatastralClCsv(filePath: string, onBytes?: (bytesRead: number) => void) {
  let headerMap: Record<number, string> | null = null
  let delim = ','
  let lineNo = 0

  for await (const line of readLines(filePath, onBytes)) {
    lineNo++
    if (lineNo === 1) {
      // Detectar delimitador
      if (line.includes(';') && !line.includes(',')) delim = ';'
      const rawHeaders = parseCsvLine(line, delim)
      headerMap = {}
      for (let i = 0; i < rawHeaders.length; i++) {
        const key = rawHeaders[i].toLowerCase().replace(/[^a-z0-9_]/g, '_')
        const mapped = CATASTRAL_CL_ALIASES[key]
        if (mapped) headerMap[i] = mapped
      }
      continue
    }
    if (!headerMap) continue
    const parts = parseCsvLine(line, delim)
    const r: Record<string, string> = {}
    for (const [idx, field] of Object.entries(headerMap)) {
      r[field] = parts[parseInt(idx)] ?? ''
    }
    const sii = toTextOrNull(r.sii_comuna_code)
    const manzana = toTextOrNull(r.manzana)
    const predio = toTextOrNull(r.predio)
    const rol = normalizeRol(manzana, predio)
    if (!sii || !rol) continue
    yield {
      sii_comuna_code: sii,
      manzana,
      predio,
      rol,
      serie: 'no_agricola' as const,
      direccion: toTextOrNull(r.direccion),
      avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
      avaluo_exento: toIntOrNull(r.avaluo_exento),
      contribucion_semestral: toIntOrNull(r.contribucion_semestral),
      codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
      codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
      superficie_terreno_m2: toIntOrNull(r.superficie_terreno_m2),
      rol_bien_comun_1: normalizeRolTriple(r.rbc1_comuna, r.rbc1_manzana, r.rbc1_predio),
      rol_bien_comun_2: normalizeRolTriple(r.rbc2_comuna, r.rbc2_manzana, r.rbc2_predio),
      rol_padre: normalizeRolTriple(r.padre_comuna, r.padre_manzana, r.padre_predio),
      lat: toFloatOrNull(r.lat),
      lng: toFloatOrNull(r.lng),
      nombre_propietario: toTextOrNull(r.nombre_propietario),
    }
  }
}

interface RolEnriquecidoBatchRow extends RolBatchRow {
  lat: number | null
  lng: number | null
  nombre_propietario: string | null
}

async function flushRolesEnriquecidosBatch(client: Client, batch: RolEnriquecidoBatchRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const res = await client.query(
    `
    INSERT INTO sii_roles_cl (
      comuna_id, sii_comuna_code, manzana, predio, rol, serie,
      direccion, avaluo_fiscal_total, avaluo_exento, contribucion_semestral,
      codigo_destino_principal, codigo_ubicacion,
      superficie_terreno_m2, rol_bien_comun_1, rol_bien_comun_2, rol_padre,
      lat, lng, nombre_propietario, raw_source
    )
    SELECT * FROM unnest(
      $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
      $7::text[], $8::bigint[], $9::bigint[], $10::bigint[],
      $11::text[], $12::text[],
      $13::int[], $14::text[], $15::text[], $16::text[],
      $17::double precision[], $18::double precision[], $19::text[], $20::text[]
    )
    ON CONFLICT (sii_comuna_code, manzana, predio) DO UPDATE SET
      direccion                = EXCLUDED.direccion,
      avaluo_fiscal_total       = EXCLUDED.avaluo_fiscal_total,
      avaluo_exento             = EXCLUDED.avaluo_exento,
      contribucion_semestral    = EXCLUDED.contribucion_semestral,
      codigo_destino_principal  = EXCLUDED.codigo_destino_principal,
      codigo_ubicacion          = EXCLUDED.codigo_ubicacion,
      superficie_terreno_m2     = COALESCE(EXCLUDED.superficie_terreno_m2, sii_roles_cl.superficie_terreno_m2),
      lat                       = COALESCE(EXCLUDED.lat, sii_roles_cl.lat),
      lng                       = COALESCE(EXCLUDED.lng, sii_roles_cl.lng),
      nombre_propietario        = COALESCE(EXCLUDED.nombre_propietario, sii_roles_cl.nombre_propietario),
      raw_source                = EXCLUDED.raw_source,
      updated_at                = now()
    `,
    [
      batch.map((r) => r.comuna_id),
      batch.map((r) => r.sii_comuna_code),
      batch.map((r) => r.manzana),
      batch.map((r) => r.predio),
      batch.map((r) => r.rol),
      batch.map((r) => r.serie),
      batch.map((r) => r.direccion),
      batch.map((r) => r.avaluo_fiscal_total),
      batch.map((r) => r.avaluo_exento),
      batch.map((r) => r.contribucion_semestral),
      batch.map((r) => r.codigo_destino_principal),
      batch.map((r) => r.codigo_ubicacion),
      batch.map((r) => r.superficie_terreno_m2),
      batch.map((r) => r.rol_bien_comun_1),
      batch.map((r) => r.rol_bien_comun_2),
      batch.map((r) => r.rol_padre),
      batch.map((r) => (r as RolEnriquecidoBatchRow).lat),
      batch.map((r) => (r as RolEnriquecidoBatchRow).lng),
      batch.map((r) => (r as RolEnriquecidoBatchRow).nombre_propietario),
      batch.map((r) => r.raw_source),
    ]
  )
  return res.rowCount ?? 0
}

// A diferencia del resto de bloques (que ingestan dentro de una única
// transacción de tamaño acotado por comuna), el CSV de catastral.cl tiene
// ~9.4M filas a nivel nacional: una sola transacción para todo el archivo no
// da feedback incremental y, si algo falla cerca del final, se pierde horas
// de trabajo. Aquí cada lote se commitea por separado.
async function flushRolesEnriquecidosBatchCommitted(client: Client, batch: RolEnriquecidoBatchRow[]): Promise<number> {
  if (batch.length === 0) return 0
  await client.query('BEGIN')
  try {
    const n = await flushRolesEnriquecidosBatch(client, batch)
    await client.query('COMMIT')
    return n
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

export interface SiiIngestFiles {
  rolesNoAgricolas?: string
  construccionesNoAgricolas?: string
  rolesAgricolas?: string
  suelosConstruccionesAgricolas?: string
  rolDeCobro?: string
  catastralCl?: string  // CSV nacional de catastral.cl (catastro_YYYY_N.csv)
}

export interface SiiIngestResult {
  ok: boolean
  counts: Record<string, number>
  error?: string
}

/**
 * Parsea e ingesta los archivos planos del SII para UNA comuna en
 * `sii_roles_cl` / `sii_construcciones_cl`. Todas las rutas son OPCIONALES —
 * se puede ingestar solo lo que se haya subido.
 */
export async function ingestSiiCatastroComuna({
  comunaCode,
  files = {},
  dbUrl = process.env.DATABASE_URL,
  onProgress,
}: {
  comunaCode: string
  files?: SiiIngestFiles
  dbUrl?: string
  onProgress?: (info: { rowsProcessed: number; processedBytes: number; totalBytes: number }) => void
}): Promise<SiiIngestResult> {
  const counts: Record<string, number> = {
    roles_agricolas: 0, suelos_construcciones_agricolas: 0,
    roles_no_agricolas: 0, construcciones_no_agricolas: 0, rol_de_cobro: 0,
  }
  if (!comunaCode) return { ok: false, counts, error: 'comunaCode requerido' }
  if (!dbUrl) return { ok: false, counts, error: 'DATABASE_URL no configurada' }

  const client = new Client({ connectionString: dbUrl })
  // Sin este listener, un error de conexión (socket reseteado, etc.) que
  // llegue mientras no hay query pendiente se emite como 'error' en el
  // Client; sin handler, Node lo relanza como excepción no capturada y
  // mata TODO el proceso (no solo esta request) — eso explica un 502 con
  // cero bytes de respuesta (el proceso entero muere a mitad de la subida).
  client.on('error', (err) => {
    console.error(`Error de conexión PG en ingesta SII (comuna ${comunaCode}):`, err)
  })

  try {
    await client.connect()
    const comunaId = await resolveComunaId(client, comunaCode)

    // 1) Roles primero (no agrícola y agrícola) — las construcciones se
    //    enlazan por rol_id, así que el rol debe existir antes.
    if (files.rolesNoAgricolas) {
      const source = basename(files.rolesNoAgricolas)
      await client.query('BEGIN')
      try {
        let batch: RolBatchRow[] = []
        for await (const rec of parseRolesNoAgricolas(files.rolesNoAgricolas)) {
          if (!rec.rol) continue
          batch.push({ ...rec, rol: rec.rol, comuna_id: comunaId, raw_source: source })
          if (batch.length >= BATCH_SIZE) {
            counts.roles_no_agricolas += await flushRolesBatch(client, batch)
            batch = []
          }
        }
        counts.roles_no_agricolas += await flushRolesBatch(client, batch)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.roles_no_agricolas = 0
        throw err
      }
    }
    if (files.rolesAgricolas) {
      const source = basename(files.rolesAgricolas)
      await client.query('BEGIN')
      try {
        let batch: RolBatchRow[] = []
        for await (const rec of parseRolesAgricolas(files.rolesAgricolas)) {
          if (!rec.rol) continue
          batch.push({
            ...rec,
            rol: rec.rol,
            comuna_id: comunaId,
            raw_source: source,
            superficie_terreno_m2: null,
            rol_bien_comun_1: null,
            rol_bien_comun_2: null,
            rol_padre: null,
          })
          if (batch.length >= BATCH_SIZE) {
            counts.roles_agricolas += await flushRolesBatch(client, batch)
            batch = []
          }
        }
        counts.roles_agricolas += await flushRolesBatch(client, batch)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.roles_agricolas = 0
        throw err
      }
    }

    // 2) Líneas de construcción/suelo — requieren que el rol_id ya exista; se
    //    resuelven contra un mapa cargado una sola vez (en vez de un SELECT
    //    por fila); si una línea llega para un rol no visto se descarta (no
    //    falla la ingesta).
    if (files.construccionesNoAgricolas) {
      await client.query('BEGIN')
      try {
        const rolIdMap = await loadRolIdMap(client, comunaCode)
        let batch: ConstruccionBatchRow[] = []
        for await (const rec of parseConstruccionesNoAgricolas(files.construccionesNoAgricolas)) {
          const rolId = rolIdMap.get(`${rec.manzana}|${rec.predio}`)
          if (!rolId) continue
          batch.push({
            rol_id: rolId,
            linea: rec.linea,
            material_code: rec.material_code,
            calidad_code: rec.calidad_code,
            anio_construccion: rec.anio_construccion,
            superficie_m2: rec.superficie_m2,
            destino_code: rec.destino_code,
            condicion_especial: rec.condicion_especial,
            numero_pisos: rec.numero_pisos,
            codigo_suelo: null,
            superficie_suelo_ha: null,
          })
          if (batch.length >= BATCH_SIZE) {
            counts.construcciones_no_agricolas += await flushConstruccionesBatch(client, batch)
            batch = []
          }
        }
        counts.construcciones_no_agricolas += await flushConstruccionesBatch(client, batch)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.construcciones_no_agricolas = 0
        throw err
      }
    }
    if (files.suelosConstruccionesAgricolas) {
      await client.query('BEGIN')
      try {
        const rolIdMap = await loadRolIdMap(client, comunaCode)
        let batch: ConstruccionBatchRow[] = []
        for await (const rec of parseSuelosConstruccionesAgricolas(files.suelosConstruccionesAgricolas)) {
          const rolId = rolIdMap.get(`${rec.manzana}|${rec.predio}`)
          if (!rolId) continue
          batch.push({
            rol_id: rolId,
            linea: rec.linea,
            material_code: rec.material_code,
            calidad_code: rec.calidad_code,
            anio_construccion: null,
            superficie_m2: rec.superficie_m2,
            destino_code: rec.destino_code,
            condicion_especial: rec.condicion_especial,
            numero_pisos: rec.numero_pisos,
            codigo_suelo: rec.codigo_suelo,
            superficie_suelo_ha: rec.superficie_suelo_ha,
          })
          if (batch.length >= BATCH_SIZE) {
            counts.suelos_construcciones_agricolas += await flushConstruccionesBatch(client, batch)
            batch = []
          }
        }
        counts.suelos_construcciones_agricolas += await flushConstruccionesBatch(client, batch)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.suelos_construcciones_agricolas = 0
        throw err
      }
    }

    // 3) Rol de Cobro — UPSERT: si el rol no existe todavía (no se cargó
    //    Detalle Catastral para esta comuna), se crea una fila mínima con
    //    los datos propios del Rol de Cobro para que el lookup por dirección
    //    funcione igual.
    if (files.rolDeCobro) {
      const source = basename(files.rolDeCobro)
      await client.query('BEGIN')
      try {
        let batch: RolCobroBatchRow[] = []
        for await (const rec of parseRolDeCobro(files.rolDeCobro)) {
          if (!rec.rol) continue
          batch.push({ ...rec, rol: rec.rol, comuna_id: comunaId, raw_source: source })
          if (batch.length >= BATCH_SIZE) {
            counts.rol_de_cobro += await flushRolDeCobroBatch(client, batch)
            batch = []
          }
        }
        counts.rol_de_cobro += await flushRolDeCobroBatch(client, batch)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        counts.rol_de_cobro = 0
        throw err
      }
    }

    // 4) CSV de catastral.cl — formato nacional con cabecera, incluye lat/lng.
    //    Ver comentario de flushRolesEnriquecidosBatchCommitted: aquí se
    //    commitea por lote (no en una única transacción) y se reporta
    //    progreso real (filas + bytes leídos del archivo) vía onProgress.
    if (files.catastralCl) {
      const source = basename(files.catastralCl)
      const totalBytes = (await stat(files.catastralCl)).size
      // Pre-cargar mapa de todas las comunas para no hacer un SELECT por fila
      const comunaMapRes = await client.query(
        `SELECT sii_comuna_code, id FROM chile_comunas WHERE sii_comuna_code IS NOT NULL`
      )
      const comunaIdMap = new Map<string, string>(
        comunaMapRes.rows.map((r: { sii_comuna_code: string; id: string }) => [r.sii_comuna_code, r.id])
      )

      let rowsProcessed = 0
      let processedBytes = 0
      let batchesSinceProgress = 0
      let batch: RolEnriquecidoBatchRow[] = []
      for await (const rec of parseCatastralClCsv(files.catastralCl, (bytesRead) => { processedBytes = bytesRead })) {
        rowsProcessed++
        batch.push({
          ...rec,
          rol: rec.rol!,
          comuna_id: comunaIdMap.get(rec.sii_comuna_code ?? '') ?? null,
          raw_source: source,
          rol_bien_comun_1: null,
          rol_bien_comun_2: null,
          rol_padre: null,
        })
        if (batch.length >= BATCH_SIZE) {
          counts.catastral_cl = (counts.catastral_cl ?? 0) + await flushRolesEnriquecidosBatchCommitted(client, batch)
          batch = []
          batchesSinceProgress++
          if (batchesSinceProgress >= 50) {
            batchesSinceProgress = 0
            onProgress?.({ rowsProcessed, processedBytes, totalBytes })
          }
        }
      }
      counts.catastral_cl = (counts.catastral_cl ?? 0) + await flushRolesEnriquecidosBatchCommitted(client, batch)
      onProgress?.({ rowsProcessed, processedBytes, totalBytes })
    }

    return { ok: true, counts }
  } catch (err) {
    return { ok: false, counts, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await client.end()
  }
}
