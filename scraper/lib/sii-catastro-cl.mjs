// ─────────────────────────────────────────────────────────────────────────────
// sii-catastro-cl.mjs — parser e ingesta de los archivos planos oficiales del
// SII ("Avalúos y Contribuciones de Bienes Raíces" → "Descarga de Información
// Vigente por Comuna"): Detalle Catastral (4 archivos) + Rol de Cobro (Rol
// Semestral de Contribuciones).
//
// ORIGEN DE LOS DATOS — esto NO es scraping:
//   sii.cl publica un botón de descarga masiva de autoservicio por comuna.
//   Un humano lo descarga manualmente desde el sitio y sube el archivo plano
//   resultante a este sistema. Este módulo SOLO lee archivos que ya están en
//   disco — JAMÁS hace una petición HTTP/scraping contra ningún (sub)dominio
//   sii.cl. Ver banner legal completo en cadastre-cl.mjs y en la migración
//   0021_sii_catastro_cl.sql (uso declarado por sii.cl: "personal y no
//   comercial" — estos datos se usan como señal interna de matching, nunca
//   se redistribuyen ni comercializan tal cual).
//
// Formato de archivos (confirmado contra datos reales de Las Condes, comuna
// 15108, año 2026 semestre 1 — ver estructura_detalle_catastral_1.pdf y
// estructura_rol_cobro_1.pdf):
//   - Detalle Catastral: 4 archivos pipe-delimited ("|"), sin encabezado, con
//     un "|" final por línea (genera un campo vacío extra al separar).
//   - Rol de Cobro: 1 archivo TXT de ancho fijo, sin encabezado, 117
//     caracteres por línea.
// ─────────────────────────────────────────────────────────────────────────────
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'

const { Client } = pg

// ─── Tablas de códigos oficiales (ver PDFs de estructura del SII) ──────────

export const SII_DESTINO_LABELS = {
  A: 'Agrícola',
  B: 'Agroindustrial',
  C: 'Comercio',
  D: 'Deporte y Recreación',
  E: 'Educación y Cultura',
  F: 'Forestal',
  G: 'Hotel, Motel',
  H: 'Habitacional',
  I: 'Industria',
  L: 'Bodega y Almacenaje',
  M: 'Minería',
  O: 'Oficina',
  P: 'Administración Pública y Defensa', // serie agrícola: P = Casa Patronal
  Q: 'Culto',
  S: 'Salud',
  T: 'Transporte y Telecomunicaciones',
  V: 'Otros no considerados',
  W: 'Sitio Eriazo',
  Y: 'Gallineros, chancheras y otros',
  Z: 'Estacionamiento',
}

// ─── Helpers de parseo ──────────────────────────────────────────────────────

function splitPipeLine(line) {
  const parts = line.split('|')
  // Cada línea termina en "|" → el último elemento del split es siempre ''.
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

function toIntOrNull(raw) {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  if (trimmed === '') return null
  const n = parseInt(trimmed, 10)
  return Number.isNaN(n) ? null : n
}

function toTextOrNull(raw) {
  if (raw === undefined || raw === null) return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Quita ceros a la izquierda de un número en texto (conservando "0" si es
 * literalmente cero), para normalizar manzana/predio antes de componer un Rol.
 */
function stripLeadingZeros(raw) {
  const n = toIntOrNull(raw)
  return n === null ? null : String(n)
}

/**
 * Compone el Rol de Avalúo normalizado "manzana-predio" (sin ceros a la
 * izquierda) — misma convención que `cadastre_parcels_cl.rol` (0020) para
 * poder cruzar ambas tablas por el mismo valor.
 */
export function normalizeRol(manzana, predio) {
  const m = stripLeadingZeros(manzana)
  const p = stripLeadingZeros(predio)
  if (m === null || p === null) return null
  return `${m}-${p}`
}

/**
 * Compone un Rol Bien Común / Rol Padre "comuna-manzana-predio". Estos
 * campos vienen en "00000-00000-00000" cuando no aplican (no es copropiedad)
 * — en ese caso se devuelve null en vez de un rol espurio "0-0".
 */
function normalizeRolTriple(comuna, manzana, predio) {
  const m = toIntOrNull(manzana)
  const p = toIntOrNull(predio)
  if (!m && !p) return null
  const c = toTextOrNull(comuna)
  return `${c}-${stripLeadingZeros(manzana)}-${stripLeadingZeros(predio)}`
}

/**
 * Normaliza una dirección para matching difuso: mayúsculas, sin tildes,
 * espacios colapsados. La normalización de acentos real (unaccent) se aplica
 * en SQL al consultar — esta función solo deja el texto comparable en JS.
 */
export function normalizeDireccion(direccion) {
  if (!direccion) return null
  return direccion
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

async function* readLines(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (line.length === 0) continue
    yield line
  }
}

// ─── Parsers — Detalle Catastral (pipe-delimited) ──────────────────────────

// Roles agrícolas (BRTMPCATASA) — 9 campos.
const ROLES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal',
  'avaluo_exento', 'codigo_ubicacion',
]

// Suelos y construcciones agrícolas (BRTMPCATASAL) — 12 campos, varias
// líneas por rol.
const SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'codigo_suelo', 'superficie_suelo_ha',
  'linea', 'material_code', 'calidad_code', 'superficie_m2', 'destino_code',
  'condicion_especial', 'numero_pisos',
]

// Roles no agrícolas (BRTMPCATASN) — 19 campos, incluye Rol Bien Común ×2 y
// Rol Padre (linkage de copropiedad/edificios).
const ROLES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'direccion',
  'avaluo_fiscal_total', 'contribucion_semestral', 'codigo_destino_principal', 'avaluo_exento',
  'rbc1_comuna', 'rbc1_manzana', 'rbc1_predio',
  'rbc2_comuna', 'rbc2_manzana', 'rbc2_predio',
  'superficie_terreno_m2', 'codigo_ubicacion',
  'padre_comuna', 'padre_manzana', 'padre_predio',
]

// Terrenos y construcciones no agrícolas (BRTMPCATASNL) — 11 campos, varias
// líneas por rol.
const CONSTRUCCIONES_NO_AGRICOLAS_FIELDS = [
  'sii_comuna_code', 'manzana', 'predio', 'linea', 'material_code', 'calidad_code',
  'anio_construccion', 'superficie_m2', 'destino_code', 'condicion_especial', 'numero_pisos',
]

async function* parsePipeFile(filePath, fieldNames) {
  for await (const line of readLines(filePath)) {
    const parts = splitPipeLine(line)
    const record = {}
    for (let i = 0; i < fieldNames.length; i++) {
      record[fieldNames[i]] = parts[i] ?? null
    }
    yield record
  }
}

/** @returns {AsyncGenerator<object>} un registro por rol agrícola. */
export function parseRolesAgricolas(filePath) {
  return mapAsync(parsePipeFile(filePath, ROLES_AGRICOLAS_FIELDS), (r) => ({
    sii_comuna_code: toTextOrNull(r.sii_comuna_code),
    manzana: toTextOrNull(r.manzana),
    predio: toTextOrNull(r.predio),
    rol: normalizeRol(r.manzana, r.predio),
    serie: 'agricola',
    direccion: toTextOrNull(r.direccion),
    avaluo_fiscal_total: toIntOrNull(r.avaluo_fiscal_total),
    contribucion_semestral: toIntOrNull(r.contribucion_semestral),
    codigo_destino_principal: toTextOrNull(r.codigo_destino_principal),
    avaluo_exento: toIntOrNull(r.avaluo_exento),
    codigo_ubicacion: toTextOrNull(r.codigo_ubicacion),
  }))
}

/** @returns {AsyncGenerator<object>} una línea de suelo/construcción agrícola. */
export function parseSuelosConstruccionesAgricolas(filePath) {
  return mapAsync(parsePipeFile(filePath, SUELOS_CONSTRUCCIONES_AGRICOLAS_FIELDS), (r) => ({
    sii_comuna_code: toTextOrNull(r.sii_comuna_code),
    manzana: toTextOrNull(r.manzana),
    predio: toTextOrNull(r.predio),
    rol: normalizeRol(r.manzana, r.predio),
    codigo_suelo: toTextOrNull(r.codigo_suelo),
    // Últimas 2 cifras son decimales (ej. "000250" = 2.50 ha) — ver PDF de estructura.
    superficie_suelo_ha: r.superficie_suelo_ha != null ? toIntOrNull(r.superficie_suelo_ha) / 100 : null,
    linea: toIntOrNull(r.linea),
    material_code: toTextOrNull(r.material_code),
    calidad_code: toTextOrNull(r.calidad_code),
    superficie_m2: toIntOrNull(r.superficie_m2),
    destino_code: toTextOrNull(r.destino_code),
    condicion_especial: toTextOrNull(r.condicion_especial),
    numero_pisos: toIntOrNull(r.numero_pisos),
  }))
}

/** @returns {AsyncGenerator<object>} un registro por rol no agrícola (urbano). */
export function parseRolesNoAgricolas(filePath) {
  return mapAsync(parsePipeFile(filePath, ROLES_NO_AGRICOLAS_FIELDS), (r) => ({
    sii_comuna_code: toTextOrNull(r.sii_comuna_code),
    manzana: toTextOrNull(r.manzana),
    predio: toTextOrNull(r.predio),
    rol: normalizeRol(r.manzana, r.predio),
    serie: 'no_agricola',
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
  }))
}

/** @returns {AsyncGenerator<object>} una línea de terreno/construcción no agrícola. */
export function parseConstruccionesNoAgricolas(filePath) {
  return mapAsync(parsePipeFile(filePath, CONSTRUCCIONES_NO_AGRICOLAS_FIELDS), (r) => ({
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
  }))
}

// ─── Parser — Rol de Cobro (ancho fijo, 117 caracteres) ────────────────────

// [nombre, posInicial, posFinal] — posiciones 1-indexadas tal cual el PDF
// "estructura_rol_cobro_1.pdf" (confirmado contra datos reales de Las Condes).
const ROL_COBRO_FIELDS = [
  ['comuna', 1, 5],
  ['anio', 6, 9],
  ['semestre', 10, 10],
  ['aseo', 11, 11],
  // 12-17 "Espacios" — campo sin información, se omite.
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

function parseRolCobroLine(line) {
  const get = (ini, fin) => line.slice(ini - 1, fin)
  const raw = {}
  for (const [name, ini, fin] of ROL_COBRO_FIELDS) raw[name] = get(ini, fin)

  return {
    sii_comuna_code: toTextOrNull(raw.comuna),
    anio: toIntOrNull(raw.anio),
    semestre: toIntOrNull(raw.semestre),
    incluye_aseo: toTextOrNull(raw.aseo) === 'A',
    direccion: toTextOrNull(raw.direccion),
    manzana: toTextOrNull(raw.manzana),
    predio: toTextOrNull(raw.predio),
    rol: normalizeRol(raw.manzana, raw.predio),
    serie: toTextOrNull(raw.serie) === 'A' ? 'agricola' : 'no_agricola',
    cuota_trimestral: toIntOrNull(raw.cuota_trimestral),
    avaluo_total: toIntOrNull(raw.avaluo_total),
    avaluo_exento: toIntOrNull(raw.avaluo_exento),
    anio_termino_exencion: toIntOrNull(raw.anio_termino_exencion),
    codigo_ubicacion: toTextOrNull(raw.codigo_ubicacion),
    codigo_destino: toTextOrNull(raw.codigo_destino),
  }
}

/** @returns {AsyncGenerator<object>} un registro por rol (Rol de Cobro). */
export async function* parseRolDeCobro(filePath) {
  for await (const line of readLines(filePath)) {
    if (line.length !== 117) continue // línea corrupta/truncada — se descarta, no se lanza
    yield parseRolCobroLine(line)
  }
}

async function* mapAsync(iterable, fn) {
  for await (const item of iterable) yield fn(item)
}

// ─── Ingesta a Postgres ─────────────────────────────────────────────────────

async function resolveComunaId(client, comunaCode) {
  const res = await client.query(
    `SELECT id FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`,
    [comunaCode]
  )
  return res.rows[0]?.id ?? null
}

async function upsertRol(client, comunaId, rec, rawSource) {
  if (!rec.rol) return null
  const res = await client.query(
    `
    INSERT INTO sii_roles_cl (
      comuna_id, sii_comuna_code, manzana, predio, rol, serie,
      direccion, avaluo_fiscal_total, avaluo_exento, contribucion_semestral,
      codigo_destino_principal, codigo_ubicacion,
      superficie_terreno_m2, rol_bien_comun_1, rol_bien_comun_2, rol_padre,
      raw_source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
    RETURNING id
    `,
    [
      comunaId, rec.sii_comuna_code, rec.manzana, rec.predio, rec.rol, rec.serie,
      rec.direccion, rec.avaluo_fiscal_total, rec.avaluo_exento, rec.contribucion_semestral,
      rec.codigo_destino_principal, rec.codigo_ubicacion ?? null,
      rec.superficie_terreno_m2 ?? null, rec.rol_bien_comun_1 ?? null, rec.rol_bien_comun_2 ?? null, rec.rol_padre ?? null,
      rawSource,
    ]
  )
  return res.rows[0]?.id ?? null
}

/**
 * Parsea e ingesta los archivos planos del SII para UNA comuna en
 * `sii_roles_cl` / `sii_construcciones_cl`. Todas las rutas son OPCIONALES —
 * se puede ingestar solo lo que el usuario haya subido (ej. solo Rol de
 * Cobro, sin Detalle Catastral, o viceversa).
 *
 * @param {object} params
 * @param {string} params.comunaCode - código SII de comuna, ej. "15108".
 * @param {object} [params.files]
 * @param {string} [params.files.rolesNoAgricolas] - ruta a BRTMPCATASN_*
 * @param {string} [params.files.construccionesNoAgricolas] - ruta a BRTMPCATASNL_*
 * @param {string} [params.files.rolesAgricolas] - ruta a BRTMPCATASA_*
 * @param {string} [params.files.suelosConstruccionesAgricolas] - ruta a BRTMPCATASAL_*
 * @param {string} [params.files.rolDeCobro] - ruta al TXT de Rol Semestral
 * @param {string} [params.db_url] - connection string Postgres (por defecto, env var DATABASE_URL).
 * @returns {Promise<{ok: boolean, counts?: object, error?: string}>}
 */
export async function ingestSiiCatastroComuna({ comunaCode, files = {}, db_url = process.env.DATABASE_URL } = {}) {
  if (!comunaCode) return { ok: false, error: 'comunaCode requerido' }
  if (!db_url) {
    console.error('[sii-catastro-cl] DATABASE_URL no configurada')
    return { ok: false, error: 'DATABASE_URL required' }
  }

  const client = new Client({ connectionString: db_url })
  const counts = {
    roles_agricolas: 0, suelos_construcciones_agricolas: 0,
    roles_no_agricolas: 0, construcciones_no_agricolas: 0, rol_de_cobro: 0,
  }

  try {
    await client.connect()
    const comunaId = await resolveComunaId(client, comunaCode)
    if (!comunaId) {
      console.warn(`[sii-catastro-cl] comuna SII '${comunaCode}' no encontrada en chile_comunas — se ingesta con comuna_id NULL`)
    }

    // 1) Roles primero (no agrícola y agrícola) — las construcciones se
    //    enlazan por rol_id, así que el rol debe existir antes.
    if (files.rolesNoAgricolas) {
      const source = basename(files.rolesNoAgricolas)
      for await (const rec of parseRolesNoAgricolas(files.rolesNoAgricolas)) {
        const id = await upsertRol(client, comunaId, rec, source)
        if (id) counts.roles_no_agricolas++
      }
    }
    if (files.rolesAgricolas) {
      const source = basename(files.rolesAgricolas)
      for await (const rec of parseRolesAgricolas(files.rolesAgricolas)) {
        const id = await upsertRol(client, comunaId, rec, source)
        if (id) counts.roles_agricolas++
      }
    }

    // 2) Líneas de construcción/suelo — requieren que el rol_id ya exista;
    //    si una línea llega para un rol no visto (archivo de construcciones
    //    subido sin el archivo de roles correspondiente) se descarta con un
    //    warning en vez de fallar la ingesta completa.
    if (files.construccionesNoAgricolas) {
      for await (const rec of parseConstruccionesNoAgricolas(files.construccionesNoAgricolas)) {
        const rolRes = await client.query(
          `SELECT id FROM sii_roles_cl WHERE sii_comuna_code = $1 AND manzana = $2 AND predio = $3 LIMIT 1`,
          [rec.sii_comuna_code, rec.manzana, rec.predio]
        )
        const rolId = rolRes.rows[0]?.id
        if (!rolId) continue
        await client.query(
          `INSERT INTO sii_construcciones_cl (rol_id, linea, material_code, calidad_code, anio_construccion, superficie_m2, destino_code, condicion_especial, numero_pisos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [rolId, rec.linea, rec.material_code, rec.calidad_code, rec.anio_construccion, rec.superficie_m2, rec.destino_code, rec.condicion_especial, rec.numero_pisos]
        )
        counts.construcciones_no_agricolas++
      }
    }
    if (files.suelosConstruccionesAgricolas) {
      for await (const rec of parseSuelosConstruccionesAgricolas(files.suelosConstruccionesAgricolas)) {
        const rolRes = await client.query(
          `SELECT id FROM sii_roles_cl WHERE sii_comuna_code = $1 AND manzana = $2 AND predio = $3 LIMIT 1`,
          [rec.sii_comuna_code, rec.manzana, rec.predio]
        )
        const rolId = rolRes.rows[0]?.id
        if (!rolId) continue
        await client.query(
          `INSERT INTO sii_construcciones_cl (rol_id, linea, material_code, calidad_code, superficie_m2, destino_code, condicion_especial, numero_pisos, codigo_suelo, superficie_suelo_ha)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [rolId, rec.linea, rec.material_code, rec.calidad_code, rec.superficie_m2, rec.destino_code, rec.condicion_especial, rec.numero_pisos, rec.codigo_suelo, rec.superficie_suelo_ha]
        )
        counts.suelos_construcciones_agricolas++
      }
    }

    // 3) Rol de Cobro — UPSERT: si el rol no existe todavía (no se cargó
    //    Detalle Catastral para esta comuna), se crea una fila mínima con
    //    los datos propios del Rol de Cobro para que el lookup por dirección
    //    funcione igual.
    if (files.rolDeCobro) {
      const source = basename(files.rolDeCobro)
      for await (const rec of parseRolDeCobro(files.rolDeCobro)) {
        if (!rec.rol) continue
        const res = await client.query(
          `
          INSERT INTO sii_roles_cl (
            comuna_id, sii_comuna_code, manzana, predio, rol, serie, direccion,
            rol_cobro_anio, rol_cobro_semestre, rol_cobro_direccion,
            rol_cobro_avaluo_total, rol_cobro_avaluo_exento, rol_cobro_cuota_trimestral,
            rol_cobro_codigo_ubicacion, rol_cobro_codigo_destino, raw_source
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
            comunaId, rec.sii_comuna_code, rec.manzana, rec.predio, rec.rol, rec.serie, rec.direccion,
            rec.anio, rec.semestre, rec.direccion,
            rec.avaluo_total, rec.avaluo_exento, rec.cuota_trimestral,
            rec.codigo_ubicacion, rec.codigo_destino, source,
          ]
        )
        counts.rol_de_cobro++
      }
    }

    console.log(`[sii-catastro-cl] ingesta completa comuna=${comunaCode}:`, counts)
    return { ok: true, counts }
  } catch (err) {
    console.error(`[sii-catastro-cl] error durante ingesta: ${err.message}`)
    return { ok: false, error: err.message, counts }
  } finally {
    await client.end()
  }
}

function basename(filePath) {
  return String(filePath).split('/').pop()
}

/**
 * Devuelve los atributos SII de un Rol ya ingestado, en la forma que espera
 * `identity-resolution-cl.mjs` para `parcel.sii_metadata` (estrategia #4,
 * huella física): `{ sqm, property_type }`. SII no reporta dormitorios ni
 * baños — esos campos quedan ausentes (la función consumidora ya degrada
 * con gracia ante campos faltantes).
 *
 * `rol` debe venir normalizado ("manzana-predio", sin ceros a la izquierda)
 * — la misma convención que `cadastre_parcels_cl.rol` (0020), para que un
 * caller que ya resolvió una parcela por punto pueda pasar `parcel.rol`
 * directo sin tener que reconstruir el formato interno (con ceros) del SII.
 *
 * @param {object} params
 * @param {string} params.comunaCode
 * @param {string} params.rol - "manzana-predio" normalizado, ej. "100-1".
 * @param {string} [params.db_url]
 * @returns {Promise<object|null>}
 */
export async function getSiiMetadataForRol({ comunaCode, rol, db_url = process.env.DATABASE_URL } = {}) {
  if (!comunaCode || !rol || !db_url) return null

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()
    const rolRes = await client.query(
      `SELECT * FROM sii_roles_cl WHERE sii_comuna_code = $1 AND rol = $2 LIMIT 1`,
      [comunaCode, rol]
    )
    const rolRow = rolRes.rows[0]
    if (!rolRow) return null

    const constrRes = await client.query(
      `
      SELECT
        COALESCE(SUM(superficie_m2), 0) AS superficie_total_m2,
        COALESCE(SUM(superficie_m2) FILTER (WHERE destino_code = 'H'), 0) AS superficie_habitacional_m2,
        MAX(numero_pisos) AS numero_pisos,
        MIN(anio_construccion) AS anio_construccion_original
      FROM sii_construcciones_cl WHERE rol_id = $1
      `,
      [rolRow.id]
    )
    const constr = constrRes.rows[0]

    return {
      rol: rolRow.rol,
      direccion: rolRow.direccion ?? rolRow.rol_cobro_direccion ?? null,
      avaluo_fiscal_total: rolRow.avaluo_fiscal_total ?? rolRow.rol_cobro_avaluo_total ?? null,
      superficie_terreno_m2: rolRow.superficie_terreno_m2,
      sqm: constr.superficie_habitacional_m2 > 0 ? constr.superficie_habitacional_m2 : constr.superficie_total_m2 || null,
      superficie_construida_total_m2: constr.superficie_total_m2 || null,
      numero_pisos: constr.numero_pisos,
      anio_construccion: constr.anio_construccion_original,
      property_type: rolRow.codigo_destino_principal ? SII_DESTINO_LABELS[rolRow.codigo_destino_principal] ?? null : null,
      codigo_destino_principal: rolRow.codigo_destino_principal,
      rol_bien_comun_1: rolRow.rol_bien_comun_1,
      rol_bien_comun_2: rolRow.rol_bien_comun_2,
      rol_padre: rolRow.rol_padre,
    }
  } catch (err) {
    console.error(`[sii-catastro-cl] error en getSiiMetadataForRol: ${err.message}`)
    return null
  } finally {
    await client.end()
  }
}

/**
 * Busca Roles SII cuya dirección se parezca a la dirección declarada de un
 * anuncio, vía similitud de trigramas (pg_trgm + unaccent, ya habilitados en
 * 0001_extensions.sql). Señal complementaria a `findParcelByPoint` —
 * particularmente útil en Chile porque el pin lat/lng del anuncio es poco
 * confiable (ver docs/research-portalinmobiliario-chile.md), mientras que la
 * dirección de texto suele ser más estable entre corredoras que relistan la
 * misma propiedad.
 *
 * @param {object} params
 * @param {string} params.comunaCode
 * @param {string} params.address - dirección declarada del anuncio (texto libre).
 * @param {number} [params.limit=5]
 * @param {number} [params.minSimilarity=0.4] - umbral de similitud trigram (0..1).
 * @param {string} [params.db_url]
 * @returns {Promise<Array<{rol:string, direccion:string, similarity:number}>>}
 */
export async function findRolByAddress({ comunaCode, address, limit = 5, minSimilarity = 0.4, db_url = process.env.DATABASE_URL } = {}) {
  if (!comunaCode || !address || !db_url) return []

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()
    const res = await client.query(
      `
      SELECT rol, direccion,
             similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) AS similarity
      FROM sii_roles_cl
      WHERE sii_comuna_code = $1
        AND direccion IS NOT NULL
        AND similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) >= $3
      ORDER BY similarity DESC
      LIMIT $4
      `,
      [comunaCode, address, minSimilarity, limit]
    )
    return res.rows
  } catch (err) {
    console.error(`[sii-catastro-cl] error en findRolByAddress: ${err.message}`)
    return []
  } finally {
    await client.end()
  }
}
