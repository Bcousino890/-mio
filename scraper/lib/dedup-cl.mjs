// ─────────────────────────────────────────────────────────────────────────────
// Deduplicación chilena — Nivel 1 (determinista) + consolidación de corredoras.
//
// Ver docs/PLAN-ANUNCIOS-CL.md §2 (dedup en 2 niveles) y §4 H3/H4/H22.
//
// Este archivo cubre SOLO lo que no depende de matches probabilísticos:
//   - runNivel1DedupCl: agrupa listings_cl por (property_code, advertiser_id)
//     → property_cl. Dos anuncios con el mismo property_code son la MISMA
//     propiedad de la MISMA corredora (o su re-publicación tras expirar,
//     el caso de los ~45 días) — match seguro, sin score.
//   - runCorredoraConsolidationCl: agrupa listings_cl por advertiser_id
//     (seller_id de Mercado Libre, clave estable) → corredoras_cl, con sus
//     métricas derivadas.
//
// El Nivel 2 (probabilístico, componentes conexos sobre listing_match_cl
// confirmados) vive en clustering-cl.mjs (Fase 3, H3) — ese SÍ puede fusionar
// dos property_cl ya existentes (creados aquí en Nivel 1 por corredoras
// distintas) en uno solo, y por eso necesita lógica de merge que este archivo
// deliberadamente no implementa: mientras solo corre Nivel 1, cada
// (property_code, advertiser_id) es dueño exclusivo de su property_cl y no
// hay colisiones que reconciliar.
//
// Ambas funciones son IDEMPOTENTES y re-ejecutables sin duplicar: se pueden
// llamar tanto para el backfill único de Fase 1 (ver scraper/backfill-anuncios-cl.mjs)
// como periódicamente desde worker-cl.mjs (jobs `dedup-cluster`/`broker-enrich`,
// Fase 2) sobre lo que vaya entrando nuevo.
// ─────────────────────────────────────────────────────────────────────────────

// Ranking de confianza para ELEGIR qué listing aporta las coordenadas/atributos
// "ganadores" del property_cl. OJO: 'pin_suspect' NO es "mejor que candidate" —
// es una señal explícita de que el pin declarado parece sospechoso (ver
// identity-resolution-cl.mjs línea ~409); para decidir de QUIÉN nos fiamos para
// las coords, un pin marcado sospechoso es peor que uno sin intentar todavía.
const LOCATION_CONFIDENCE_RANK = { confirmed: 3, candidate: 2, none: 1, pin_suspect: 0 };

function rankOf(confidence) {
  return LOCATION_CONFIDENCE_RANK[confidence] ?? -1;
}

/**
 * Elige, dentro de un grupo de listings_cl, el "mejor" valor para cada campo
 * canónico de property_cl. Reglas (ver docs/PLAN-ANUNCIOS-CL.md §4 H3):
 *   - coords/comuna/location_confidence: del listing con mayor confianza.
 *   - m²/dormitorios/baños/tipo/operación: moda (valor más repetido); ante
 *     empate, el del listing más reciente (last_seen_at).
 *   - precio: mínimo vigente entre los listings ACTIVOS del grupo (si ninguno
 *     está activo, el mínimo histórico) — "precio de mercado" tal como lo
 *     definió el usuario en la estrategia original.
 */
export function consolidateFields(rows) {
  const best = rows.reduce((a, b) => (rankOf(b.location_confidence) > rankOf(a.location_confidence) ? b : a));

  const mode = (key) => {
    const counts = new Map();
    for (const r of rows) {
      const v = r[key];
      if (v == null) continue;
      const entry = counts.get(v) ?? { count: 0, lastSeen: r.last_seen_at };
      entry.count += 1;
      if (r.last_seen_at > entry.lastSeen) entry.lastSeen = r.last_seen_at;
      counts.set(v, entry);
    }
    let winner = null;
    for (const [v, e] of counts) {
      if (!winner || e.count > winner.e.count || (e.count === winner.e.count && e.lastSeen > winner.e.lastSeen)) {
        winner = { v, e };
      }
    }
    return winner?.v ?? null;
  };

  const activeRows = rows.filter((r) => r.is_active);
  const priceSource = activeRows.length > 0 ? activeRows : rows;
  const cheapest = priceSource.reduce((a, b) => {
    if (a.price == null) return b;
    if (b.price == null) return a;
    return b.price < a.price ? b : a;
  }, priceSource[0]);

  const portals = [...new Set(rows.map((r) => r.portal).filter(Boolean))];
  const sourceTypes = [...new Set(rows.map((r) => r.source_type).filter(Boolean))];
  const advertiserKinds = [...new Set(rows.map((r) => r.advertiser_type).filter((v) => v === 'particular' || v === 'professional'))];
  const distinctAdvertisers = new Set(rows.map((r) => r.advertiser_id).filter(Boolean));
  // Sin advertiser_id (webs propias sin ML aún, o dato faltante) cuentan como
  // "una corredora" cada una si no hay forma de saber si se repiten — mejor
  // subestimar corredora_count a 1 que a 0 cuando SÍ hay al menos un anuncio.
  const corredoraCount = distinctAdvertisers.size > 0 ? distinctAdvertisers.size : (rows.length > 0 ? 1 : 0);

  return {
    operation: mode('operation'),
    property_type: mode('property_type'),
    canonical_price: cheapest?.price ?? null,
    canonical_price_uf: cheapest?.price_uf ?? null,
    uf_rate: cheapest?.uf_rate ?? null,
    uf_rate_date: cheapest?.uf_rate_date ?? null,
    square_meters: mode('square_meters'),
    bedrooms: mode('bedrooms'),
    bathrooms: mode('bathrooms'),
    comuna_id: best.comuna_id,
    localidad: best.localidad,
    latitude: best.latitude,
    longitude: best.longitude,
    location_confidence: best.location_confidence,
    exact_address: best.exact_address ?? null,
    listing_count: rows.length,
    corredora_count: corredoraCount,
    portals,
    source_types: sourceTypes,
    advertiser_kinds: advertiserKinds,
    is_active: rows.some((r) => r.is_active),
    first_seen_at: rows.reduce((min, r) => (r.first_seen_at < min ? r.first_seen_at : min), rows[0].first_seen_at),
    last_seen_at: rows.reduce((max, r) => (r.last_seen_at > max ? r.last_seen_at : max), rows[0].last_seen_at),
    // Antigüedad REAL del inmueble en el mercado: el MÍNIMO entre las
    // corredoras que lo publican — el mercado lo vio desde que la PRIMERA
    // corredora lo puso, no desde la última. Ignora nulls (portal_first_seen_at
    // depende de que el subtitle se haya podido parsear, ver 0076).
    portal_first_seen_at: rows.reduce((min, r) => {
      if (r.portal_first_seen_at == null) return min;
      return min == null || r.portal_first_seen_at < min ? r.portal_first_seen_at : min;
    }, null),
  };
}

export const LISTING_FIELDS_FOR_CONSOLIDATION = `
  id, external_id, property_cl_id, operation, property_type, price, price_uf, uf_rate, uf_rate_date,
  square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
  location_confidence, exact_address, portal, source_type, advertiser_type,
  advertiser_id, is_active, first_seen_at, last_seen_at, portal_first_seen_at
`;

/**
 * Re-sincroniza los agregados DERIVADOS de property_cl con la realidad de sus
 * anuncios, para TODAS las fichas de golpe.
 *
 * Por qué hace falta: `is_active`, `listing_count` y `corredora_count` se
 * calculan al consolidar un grupo (consolidateFields) y nadie los vuelve a tocar
 * cuando un anuncio se da de BAJA (markDelisted del discovery) o se REACTIVA (el
 * upsert) — esos caminos escriben en listings_cl y no pasan por el dedup. Así
 * que la ficha se desincroniza y, como /chile/propiedades filtra por
 * `is_active`, quedan fichas VIVAS invisibles en el CRM.
 *
 * Medido en producción: 780 fichas marcadas inactivas cuando solo 179 anuncios
 * lo estaban de verdad — 780 propiedades reales que no aparecían en la lista.
 *
 * Son campos derivables al 100% por SQL, así que se recalculan en una sentencia
 * barata que solo escribe las filas que difieren: idempotente, y se cura tanto
 * del desfase ya acumulado como del que aparezca después.
 */
export async function reconcilePropertyClDerivedCl(client) {
  const { rowCount } = await client.query(`
    UPDATE property_cl p
    SET is_active = d.activo,
        listing_count = d.n_anuncios,
        corredora_count = d.n_corredoras,
        updated_at = now()
    FROM (
      SELECT p2.id,
             EXISTS (SELECT 1 FROM listings_cl l WHERE l.property_cl_id = p2.id AND l.is_active) AS activo,
             (SELECT count(*) FROM listings_cl l WHERE l.property_cl_id = p2.id) AS n_anuncios,
             GREATEST(
               (SELECT count(DISTINCT l.advertiser_id) FROM listings_cl l
                 WHERE l.property_cl_id = p2.id AND l.advertiser_id IS NOT NULL),
               -- Sin advertiser_id no se puede saber si se repiten: se cuenta
               -- como 1 mientras haya algún anuncio (mismo criterio que
               -- consolidateFields), nunca 0.
               CASE WHEN EXISTS (SELECT 1 FROM listings_cl l WHERE l.property_cl_id = p2.id) THEN 1 ELSE 0 END
             ) AS n_corredoras
      FROM property_cl p2
    ) d
    WHERE d.id = p.id
      AND (p.is_active IS DISTINCT FROM d.activo
        OR p.listing_count IS DISTINCT FROM d.n_anuncios
        OR p.corredora_count IS DISTINCT FROM d.n_corredoras)
  `);
  return { reconciled: rowCount ?? 0 };
}

/**
 * Recalcula los campos agregados de un property_cl existente a partir de TODOS
 * sus listings_cl actuales (no solo el lote que disparó la corrida) — para que
 * quede correcto aunque Nivel 2 (Fase 3) ya haya sumado listings de otras
 * corredoras a este mismo grupo.
 */
export async function refreshPropertyClAggregates(client, propertyClId) {
  const { rows } = await client.query(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION} FROM listings_cl WHERE property_cl_id = $1`,
    [propertyClId]
  );
  if (rows.length === 0) return;
  const c = consolidateFields(rows);
  await client.query(
    `UPDATE property_cl SET
       operation = $2, property_type = $3, canonical_price = $4, canonical_price_uf = $5,
       uf_rate = $6, uf_rate_date = $7, square_meters = $8, bedrooms = $9, bathrooms = $10,
       comuna_id = $11, localidad = $12, latitude = $13, longitude = $14,
       location_confidence = $15, exact_address = $16, listing_count = $17,
       corredora_count = $18, portals = $19, source_types = $20, advertiser_kinds = $21,
       is_active = $22, first_seen_at = $23, last_seen_at = $24, portal_first_seen_at = $25, updated_at = now()
     WHERE id = $1`,
    [
      propertyClId, c.operation, c.property_type, c.canonical_price, c.canonical_price_uf,
      c.uf_rate, c.uf_rate_date, c.square_meters, c.bedrooms, c.bathrooms,
      c.comuna_id, c.localidad, c.latitude, c.longitude,
      c.location_confidence, c.exact_address, c.listing_count,
      c.corredora_count, c.portals, c.source_types, c.advertiser_kinds,
      c.is_active, c.first_seen_at, c.last_seen_at, c.portal_first_seen_at,
    ]
  );
}

export async function createPropertyCl(client, rows) {
  const c = consolidateFields(rows);
  const { rows: inserted } = await client.query(
    `INSERT INTO property_cl (
       operation, property_type, canonical_price, canonical_price_uf, uf_rate, uf_rate_date,
       square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
       location_confidence, exact_address, listing_count, corredora_count,
       portals, source_types, advertiser_kinds, is_active, first_seen_at, last_seen_at, portal_first_seen_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [
      c.operation, c.property_type, c.canonical_price, c.canonical_price_uf, c.uf_rate, c.uf_rate_date,
      c.square_meters, c.bedrooms, c.bathrooms, c.comuna_id, c.localidad, c.latitude, c.longitude,
      c.location_confidence, c.exact_address, c.listing_count, c.corredora_count,
      c.portals, c.source_types, c.advertiser_kinds, c.is_active, c.first_seen_at, c.last_seen_at, c.portal_first_seen_at,
    ]
  );
  const propertyClId = inserted[0].id;

  // Restaura el pin manual si esta propiedad ya tenía uno corregido a mano antes
  // de rehacer los grupos (respaldo por external_id, migración 0079). Sin esto,
  // reconstruir el dedup borraría las correcciones de ubicación del equipo.
  const externalIds = rows.map((r) => r.external_id).filter(Boolean);
  if (externalIds.length > 0) {
    await client.query(
      `UPDATE property_cl p SET manual_latitude = b.manual_latitude,
                                manual_longitude = b.manual_longitude,
                                updated_at = now()
         FROM property_cl_manual_pin_backup b
        WHERE p.id = $1 AND b.external_id = ANY($2::text[])
          AND b.manual_latitude IS NOT NULL`,
      [propertyClId, externalIds]
    );
  }

  return propertyClId;
}

/**
 * Nivel 1 de dedup: agrupa listings_cl por (property_code, advertiser_id) en
 * property_cl. Procesa por lotes de grupos pendientes (con al menos un listing
 * sin property_cl_id todavía) — idempotente: re-ejecutar no duplica ni
 * pisa property_cl ya creados, y una fila nueva que aparezca después bajo un
 * property_code ya visto se suma sola al property_cl existente.
 *
 * @param {import('pg').Client} client
 * @param {{ batch_size?: number }} options
 * @returns {Promise<{ groups_processed: number, created: number, linked: number }>}
 */
export async function runNivel1DedupCl(client, options = {}) {
  const { batch_size = 2000 } = options;

  // ── REGLA DE DEDUPLICACIÓN (decisión del usuario) ─────────────────────────
  // Dos anuncios son la MISMA propiedad SOLO si coinciden la corredora
  // (advertiser_id) Y su código interno (seller_reference, ej. "BV3535"). Si no
  // coinciden ambos, NO se deduplica: cada anuncio queda como su propia ficha.
  //
  // Antes se agrupaba por `property_code` (el id de propiedad de Mercado Libre),
  // que fusionaba fichas que no eran la misma propiedad.
  //
  // Venta y arriendo NO se separan a propósito: una misma propiedad publicada en
  // ambas operaciones por la misma corredora, con el mismo código interno, es UNA
  // ficha con sus dos anuncios (cada anuncio conserva su propia operación).
  const pending = await client.query(
    `SELECT DISTINCT advertiser_id, seller_reference
     FROM listings_cl
     WHERE advertiser_id IS NOT NULL
       AND seller_reference IS NOT NULL AND btrim(seller_reference) <> ''
       AND property_cl_id IS NULL
       AND NOT manual_property_lock
     LIMIT $1`,
    [batch_size]
  );

  let created = 0;
  let linked = 0;

  for (const { advertiser_id, seller_reference } of pending.rows) {
    // Familia completa (incluye filas ya agrupadas en una corrida previa, para
    // sumar altas nuevas al mismo grupo en vez de crear uno duplicado).
    // Comparación del código interno sin distinguir mayúsculas ni espacios.
    // `manual_property_lock` marca los anuncios que una PERSONA movió a mano
    // desde /chile/propiedades (unir/separar, migración 0079).
    const { rows: family } = await client.query(
      `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION}, manual_property_lock FROM listings_cl
       WHERE advertiser_id = $1 AND lower(btrim(seller_reference)) = lower(btrim($2))`,
      [advertiser_id, seller_reference]
    );
    // Los anuncios fijados a mano no se reasignan, pero SÍ cuentan para saber a
    // qué property_cl pertenece el grupo: una republicación nueva bajo el mismo
    // código interno debe caer en la ficha curada, no abrir una paralela. Se
    // prefiere el property_cl de un anuncio NO fijado (la rama automática) y
    // solo se cae al fijado cuando es el único que hay.
    const unlocked = family.filter((r) => !r.manual_property_lock);
    if (unlocked.length === 0) continue;

    const existingId =
      unlocked.find((r) => r.property_cl_id)?.property_cl_id ??
      family.find((r) => r.property_cl_id)?.property_cl_id ??
      null;
    let propertyClId = existingId;
    if (!propertyClId) {
      propertyClId = await createPropertyCl(client, unlocked);
      created++;
    }

    const listingIds = unlocked.map((r) => r.id);
    await client.query(
      `UPDATE listings_cl SET property_cl_id = $1, match_confidence = 1, updated_at = now()
       WHERE id = ANY($2::uuid[]) AND property_cl_id IS DISTINCT FROM $1
         AND NOT manual_property_lock`,
      [propertyClId, listingIds]
    );
    linked += listingIds.length;

    if (existingId) await refreshPropertyClAggregates(client, propertyClId);
  }

  // ── Segunda pasada: SIN deduplicar ────────────────────────────────────────
  // Todo anuncio que no quedó en un grupo (sin código interno, o único con ese
  // código) pasa a ser SU PROPIA propiedad, 1 anuncio = 1 ficha. Sin esto, los
  // anuncios sin `seller_reference` —que son muchos— nunca tendrían property_cl
  // y desaparecerían de la vista de Propiedades.
  const { rows: singles } = await client.query(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION} FROM listings_cl
     WHERE property_cl_id IS NULL
     LIMIT $1`,
    [batch_size]
  );
  let standalone = 0;
  for (const row of singles) {
    const propertyClId = await createPropertyCl(client, [row]);
    await client.query(
      `UPDATE listings_cl SET property_cl_id = $1, match_confidence = 1, updated_at = now()
       WHERE id = $2 AND property_cl_id IS NULL`,
      [propertyClId, row.id]
    );
    standalone++;
    linked++;
  }

  return { groups_processed: pending.rows.length, created: created + standalone, linked, standalone };
}

/**
 * Consolidación de corredoras (H4): agrupa listings_cl por advertiser_id
 * (seller_id de ML, clave estable) en corredoras_cl y refresca sus métricas
 * derivadas (stock activo, comunas de operación, rotación, exclusividad).
 * Idempotente por el mismo motivo que runNivel1DedupCl.
 *
 * `exclusivity_ratio` depende de `property_cl.corredora_count` — por eso este
 * paso debe correr DESPUÉS de runNivel1DedupCl (y, en Fase 3+, después del
 * clustering Nivel 2) en la misma pasada del job.
 *
 * @param {import('pg').Client} client
 * @param {{ batch_size?: number }} options
 * @returns {Promise<{ advertisers_processed: number, created: number, linked: number }>}
 */
export async function runCorredoraConsolidationCl(client, options = {}) {
  const { batch_size = 2000 } = options;

  const pending = await client.query(
    `SELECT DISTINCT advertiser_id FROM listings_cl
     WHERE advertiser_id IS NOT NULL AND corredora_id IS NULL
     LIMIT $1`,
    [batch_size]
  );

  let created = 0;
  let linked = 0;

  for (const { advertiser_id } of pending.rows) {
    const { rows: family } = await client.query(
      `SELECT id, corredora_id, advertiser_name, advertiser_logo, phone, comuna_id, is_active,
              first_seen_at, last_seen_at, taken_down_at, property_cl_id
       FROM listings_cl WHERE advertiser_id = $1`,
      [advertiser_id]
    );
    if (family.length === 0) continue;

    // Logo canónico = el más reciente no nulo entre sus anuncios (mismo criterio
    // que el nombre). Se usa tanto al crear la corredora como para rellenarlo en
    // una ya existente que quedó sin logo (backfill, ver abajo).
    const latestLogoed = [...family]
      .filter((r) => r.advertiser_logo)
      .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))[0];

    let corredoraId = family.find((r) => r.corredora_id)?.corredora_id ?? null;
    if (!corredoraId) {
      // Nombre normalizado = el más reciente no vacío entre sus anuncios.
      const latestNamed = [...family]
        .filter((r) => r.advertiser_name)
        .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1))[0];
      const { rows: inserted } = await client.query(
        `INSERT INTO corredoras_cl (advertiser_id, name_normalized, name_raw, logo_url, first_seen_at, last_seen_at)
         VALUES ($1, $2, $2, $3, $4, $5)
         ON CONFLICT (advertiser_id) WHERE advertiser_id IS NOT NULL
         DO UPDATE SET last_seen_at = GREATEST(corredoras_cl.last_seen_at, EXCLUDED.last_seen_at)
         RETURNING id`,
        [
          advertiser_id,
          latestNamed?.advertiser_name ?? null,
          latestLogoed?.advertiser_logo ?? null,
          family.reduce((min, r) => (r.first_seen_at < min ? r.first_seen_at : min), family[0].first_seen_at),
          family.reduce((max, r) => (r.last_seen_at > max ? r.last_seen_at : max), family[0].last_seen_at),
        ]
      );
      corredoraId = inserted[0].id;
      created++;
    } else if (latestLogoed?.advertiser_logo) {
      // Corredora ya existente (creada antes de que el logo se persistiera, o
      // sin logo visto todavía): rellena solo si sigue en null — no pisa un
      // logo ya guardado en cada corrida.
      await client.query(
        `UPDATE corredoras_cl SET logo_url = $2, updated_at = now() WHERE id = $1 AND logo_url IS NULL`,
        [corredoraId, latestLogoed.advertiser_logo]
      );
    }

    const listingIds = family.map((r) => r.id);
    await client.query(
      `UPDATE listings_cl SET corredora_id = $1, updated_at = now()
       WHERE id = ANY($2::uuid[]) AND corredora_id IS DISTINCT FROM $1`,
      [corredoraId, listingIds]
    );
    linked += listingIds.length;

    await refreshCorredoraMetrics(client, corredoraId);
  }

  return { advertisers_processed: pending.rows.length, created, linked };
}

/**
 * Refresca las métricas derivadas de una corredora (H4) a partir de TODOS sus
 * listings_cl actuales: stock activo, teléfonos vistos, comunas de operación,
 * rotación media (días hasta delisted) y % de exclusividad aparente (property_cl
 * donde ella es la ÚNICA corredora, sobre el total de property_cl con al menos
 * un listing activo suyo).
 */
async function refreshCorredoraMetrics(client, corredoraId) {
  const { rows } = await client.query(
    `SELECT l.phone, l.is_active, l.first_seen_at, l.taken_down_at, l.property_cl_id,
            c.name AS comuna_name, pc.corredora_count
     FROM listings_cl l
     LEFT JOIN chile_comunas c ON c.id = l.comuna_id
     LEFT JOIN property_cl pc ON pc.id = l.property_cl_id
     WHERE l.corredora_id = $1`,
    [corredoraId]
  );
  if (rows.length === 0) return;

  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))];
  const comunas = [...new Set(rows.map((r) => r.comuna_name).filter(Boolean))];
  const activeCount = rows.filter((r) => r.is_active).length;

  const rotationDays = rows
    .filter((r) => r.taken_down_at)
    .map((r) => (new Date(r.taken_down_at) - new Date(r.first_seen_at)) / 86400000)
    .filter((d) => d >= 0);
  const avgDaysOnMarket = rotationDays.length > 0
    ? rotationDays.reduce((a, b) => a + b, 0) / rotationDays.length
    : null;

  const groupedProperties = new Set(rows.filter((r) => r.property_cl_id).map((r) => r.property_cl_id));
  let exclusiveCount = 0;
  const seenForExclusivity = new Set();
  for (const r of rows) {
    if (!r.property_cl_id || seenForExclusivity.has(r.property_cl_id)) continue;
    seenForExclusivity.add(r.property_cl_id);
    if ((r.corredora_count ?? 1) <= 1) exclusiveCount++;
  }
  const exclusivityRatio = groupedProperties.size > 0 ? exclusiveCount / groupedProperties.size : null;

  await client.query(
    `UPDATE corredoras_cl SET
       phones = $2, active_listings_count = $3, total_listings_seen = $4,
       comunas_operated = $5, avg_days_on_market = $6, exclusivity_ratio = $7,
       metrics_updated_at = now(), updated_at = now(),
       last_seen_at = GREATEST(last_seen_at, $8)
     WHERE id = $1`,
    [
      corredoraId, phones, activeCount, rows.length,
      comunas, avgDaysOnMarket, exclusivityRatio,
      rows.reduce((max, r) => (r.taken_down_at ?? r.first_seen_at) > max ? (r.taken_down_at ?? r.first_seen_at) : max, rows[0].first_seen_at),
    ]
  );
}

export const _internal = { consolidateFields, refreshPropertyClAggregates, refreshCorredoraMetrics };
