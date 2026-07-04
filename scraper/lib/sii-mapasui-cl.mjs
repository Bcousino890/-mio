// ─────────────────────────────────────────────────────────────────────────────
// sii-mapasui-cl.mjs — ingesta de la salida JSONL de `scraper/sii-scraper/`
// (scraping automatizado del backend `mapasFacadeService` del visor de mapas
// del SII) en `sii_mapasui_predios_cl`.
//
// Procedencia distinta y legalmente más frágil que `sii-catastro-cl.mjs` (ver
// cabecera de db/migrations/0052_sii_mapasui_predios_cl.sql): esta tabla NUNCA
// se mezcla con `sii_roles_cl`.
// ─────────────────────────────────────────────────────────────────────────────
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'

const { Client } = pg

async function* readJsonlLines(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    yield JSON.parse(trimmed)
  }
}

async function resolveComunaId(client, comunaCode) {
  const res = await client.query(
    `SELECT id FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`,
    [String(comunaCode)]
  )
  return res.rows[0]?.id ?? null
}

function toNumberOrNull(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

/**
 * Ingesta un archivo `output/predios/<comuna>.jsonl` (salida de
 * `python run.py predios`, ver `scraper/sii-scraper/README.md`) en
 * `sii_mapasui_predios_cl`.
 *
 * @param {object} params
 * @param {string} params.filePath - ruta al .jsonl de predios de una comuna.
 * @param {string} [params.db_url]
 * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
 */
export async function ingestMapasuiPrediosFile({ filePath, db_url = process.env.DATABASE_URL } = {}) {
  if (!filePath) return { ok: false, error: 'filePath requerido' }
  if (!db_url) return { ok: false, error: 'DATABASE_URL required' }

  const client = new Client({ connectionString: db_url })
  let count = 0
  try {
    await client.connect()
    const comunaIdCache = new Map()

    for await (const rec of readJsonlLines(filePath)) {
      if (!rec.rol_predio || rec.comuna_id === undefined || rec.comuna_id === null) continue

      const comunaCode = String(rec.comuna_id)
      if (!comunaIdCache.has(comunaCode)) {
        comunaIdCache.set(comunaCode, await resolveComunaId(client, comunaCode))
      }
      const comunaId = comunaIdCache.get(comunaCode)

      await client.query(
        `
        INSERT INTO sii_mapasui_predios_cl (
          comuna_id, sii_comuna_code, rol,
          avaluo_total, avaluo_afecto, avaluo_exento,
          lat, lng, nombre_propiedad, direccion,
          area_homogenea, superficie_banda, extraction_datetime
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (sii_comuna_code, rol) DO UPDATE SET
          avaluo_total         = EXCLUDED.avaluo_total,
          avaluo_afecto         = EXCLUDED.avaluo_afecto,
          avaluo_exento         = EXCLUDED.avaluo_exento,
          lat                   = COALESCE(EXCLUDED.lat, sii_mapasui_predios_cl.lat),
          lng                   = COALESCE(EXCLUDED.lng, sii_mapasui_predios_cl.lng),
          nombre_propiedad      = COALESCE(EXCLUDED.nombre_propiedad, sii_mapasui_predios_cl.nombre_propiedad),
          direccion             = COALESCE(EXCLUDED.direccion, sii_mapasui_predios_cl.direccion),
          area_homogenea        = COALESCE(EXCLUDED.area_homogenea, sii_mapasui_predios_cl.area_homogenea),
          superficie_banda      = COALESCE(EXCLUDED.superficie_banda, sii_mapasui_predios_cl.superficie_banda),
          extraction_datetime   = EXCLUDED.extraction_datetime,
          updated_at            = now()
        `,
        [
          comunaId, comunaCode, rec.rol_predio,
          toNumberOrNull(rec.avaluo_total), toNumberOrNull(rec.avaluo_afecto), toNumberOrNull(rec.avaluo_exento),
          toNumberOrNull(rec.latitud), toNumberOrNull(rec.longitud),
          rec.nombre_propiedad ?? null, rec.direccion ?? null,
          rec.area_homogenea ?? null, rec.superficie ?? null,
          rec.extraction_datetime ?? null,
        ]
      )
      count++
    }

    console.log(`[sii-mapasui-cl] ingesta completa ${filePath}: ${count} predios`)
    return { ok: true, count }
  } catch (err) {
    console.error(`[sii-mapasui-cl] error durante ingesta: ${err.message}`)
    return { ok: false, error: err.message, count }
  } finally {
    await client.end()
  }
}

/**
 * Devuelve el predio mapasui ya ingestado para un Rol, o null. Misma
 * convención de `rol` ("manzana-predio" sin ceros) que `sii_roles_cl`.
 *
 * @param {object} params
 * @param {string} params.comunaCode
 * @param {string} params.rol
 * @param {string} [params.db_url]
 */
export async function getMapasuiPredioForRol({ comunaCode, rol, db_url = process.env.DATABASE_URL } = {}) {
  if (!comunaCode || !rol || !db_url) return null

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()
    const res = await client.query(
      `SELECT * FROM sii_mapasui_predios_cl WHERE sii_comuna_code = $1 AND rol = $2 LIMIT 1`,
      [String(comunaCode), rol]
    )
    return res.rows[0] ?? null
  } catch (err) {
    console.error(`[sii-mapasui-cl] error en getMapasuiPredioForRol: ${err.message}`)
    return null
  } finally {
    await client.end()
  }
}

/**
 * Busca predios mapasui cuya dirección se parezca a una dirección declarada,
 * vía similitud de trigramas — equivalente a `findRolByAddress` en
 * `sii-catastro-cl.mjs`, pero contra la tabla de procedencia scraping.
 *
 * @param {object} params
 * @param {string} params.comunaCode
 * @param {string} params.address
 * @param {number} [params.limit=5]
 * @param {number} [params.minSimilarity=0.4]
 * @param {string} [params.db_url]
 */
export async function findMapasuiPredioByAddress({ comunaCode, address, limit = 5, minSimilarity = 0.4, db_url = process.env.DATABASE_URL } = {}) {
  if (!comunaCode || !address || !db_url) return []

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()
    const res = await client.query(
      `
      SELECT rol, direccion,
             similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) AS similarity
      FROM sii_mapasui_predios_cl
      WHERE sii_comuna_code = $1
        AND direccion IS NOT NULL
        AND similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) >= $3
      ORDER BY similarity DESC
      LIMIT $4
      `,
      [String(comunaCode), address, minSimilarity, limit]
    )
    return res.rows
  } catch (err) {
    console.error(`[sii-mapasui-cl] error en findMapasuiPredioByAddress: ${err.message}`)
    return []
  } finally {
    await client.end()
  }
}
