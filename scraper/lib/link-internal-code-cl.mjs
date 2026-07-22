// ─────────────────────────────────────────────────────────────────────────────
// link-internal-code-cl.mjs — enlace determinista Nivel 1.5 (plan Anuncios CL ·
// Fase 4 / H21): une el anuncio de Portal Inmobiliario con la ficha de la web
// propia de la MISMA corredora cuando comparten el código interno
// (seller_reference).
//
// Es un match SIN score, análogo al Nivel 1 (property_code): misma corredora +
// mismo código interno = la misma propiedad, con certeza. El código interno
// (ej. OR58124) es la referencia de la propiedad en el CRM de la corredora, y es
// estable por corredora — no cambia entre PI y su web.
//
// Dirección del enlace: la ficha de la web propia (source_type='agency_web') se
// SUMA al property_cl que ya creó el Nivel 1 desde el anuncio de PI. Así la web
// propia entra al mismo inmueble canónico, aportando fotos/datos extra y
// reforzando location_confidence (H21), sin crear un property_cl duplicado.
//
// Idempotente: re-ejecutar no re-enlaza lo ya enlazado (filtra
// property_cl_id IS NULL en el lado web) ni pisa nada.
// ─────────────────────────────────────────────────────────────────────────────
import { refreshPropertyClAggregates } from './dedup-cl.mjs'

/**
 * Enlaza anuncios de webs propias (agency_web) a su property_cl por código
 * interno compartido con un anuncio de portal de la misma corredora.
 *
 * Requisitos del lado web para ser candidato:
 *   · source_type = 'agency_web'
 *   · corredora_id NOT NULL (se resolvió al hacer upsert desde el target)
 *   · seller_reference NOT NULL (el código interno)
 *   · property_cl_id IS NULL (aún no enlazado)
 * Y del lado portal, un listing de la MISMA corredora, con el MISMO
 * seller_reference, que YA tenga property_cl_id (creado por Nivel 1).
 *
 * @param {import('pg').Client} client
 * @param {{ batch_size?: number }} [options]
 * @returns {Promise<{ candidates: number, linked: number, properties_touched: number }>}
 */
export async function runInternalCodeLinkCl(client, options = {}) {
  const { batch_size = 2000 } = options

  // Empareja en una sola consulta: cada anuncio web sin enlazar con el
  // property_cl del anuncio de portal de su misma corredora y mismo código.
  // DISTINCT ON (web.id) por si hubiera >1 portal con ese código (toma el más
  // reciente activo) — no debería, pero es defensivo.
  const { rows: pairs } = await client.query(
    `SELECT DISTINCT ON (web.id)
        web.id                AS web_id,
        pi.property_cl_id     AS property_cl_id
     FROM listings_cl web
     JOIN listings_cl pi
       ON pi.corredora_id = web.corredora_id
      AND lower(pi.seller_reference) = lower(web.seller_reference)
      AND pi.source_type = 'portal'
      AND pi.property_cl_id IS NOT NULL
     WHERE web.source_type = 'agency_web'
       AND web.corredora_id IS NOT NULL
       AND web.seller_reference IS NOT NULL
       AND web.property_cl_id IS NULL
     ORDER BY web.id, pi.is_active DESC, pi.last_seen_at DESC NULLS LAST
     LIMIT $1`,
    [batch_size]
  )

  let linked = 0
  const touched = new Set()

  for (const { web_id, property_cl_id } of pairs) {
    const res = await client.query(
      `UPDATE listings_cl
         SET property_cl_id = $1, match_confidence = 1, updated_at = now()
       WHERE id = $2 AND property_cl_id IS NULL`,
      [property_cl_id, web_id]
    )
    if (res.rowCount > 0) {
      linked += res.rowCount
      touched.add(property_cl_id)
    }
  }

  // Refresca los agregados de cada property_cl que recibió una ficha web nueva
  // (corredora_count, portals, source_types, listing_count, precio consolidado).
  for (const propertyClId of touched) {
    await refreshPropertyClAggregates(client, propertyClId)
  }

  return { candidates: pairs.length, linked, properties_touched: touched.size }
}
