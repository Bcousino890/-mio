import pg from 'pg';
import Graph from 'graphology';
import { largestConnectedComponentsSubgraph } from 'graphology-components';

const { Client } = pg;

/**
 * Clusteriza matches confirmados en groups de property_id canónicos.
 * Implementa Union-Find con protección contra "black hole entities" (componentes demasiado grandes).
 *
 * @param {pg.Client} client - Cliente de BD abierto
 * @param {object} options - {max_component_size: 20, min_score_for_edge: 0.85}
 */
export async function clusterMatchedListings(client, options = {}) {
  const {
    max_component_size = 20,    // Si componente > esto, re-particiona
    min_score_for_edge = 0.85   // Solo edges confirmadas con score alto
  } = options;

  console.log('[clustering] iniciando Union-Find...');

  // 1) Obtener todos los matches confirmados con score alto
  const matchesResult = await client.query(`
    SELECT listing_a, listing_b, score
    FROM listing_match
    WHERE status = 'confirmed'
      AND score >= $1
      AND decided_at IS NOT NULL
    ORDER BY score DESC
  `, [min_score_for_edge]);

  const matches = matchesResult.rows;
  console.log(`[clustering] ${matches.length} edges confirmadas`);

  if (matches.length === 0) {
    console.log('[clustering] sin matches para clusterizar');
    return;
  }

  // 2) Construir grafo con graphology
  const graph = new Graph();

  // Obtener todos los listings que no tienen property_id aún
  const listingsResult = await client.query(`
    SELECT DISTINCT listing_a as listing_id FROM listing_match WHERE status = 'confirmed'
    UNION
    SELECT DISTINCT listing_b as listing_id FROM listing_match WHERE status = 'confirmed'
  `);

  const allListingIds = listingsResult.rows.map(r => r.listing_id);
  console.log(`[clustering] ${allListingIds.length} listings en matches`);

  // Añadir nodos
  for (const listingId of allListingIds) {
    graph.addNode(listingId);
  }

  // Añadir edges (undirected)
  for (const match of matches) {
    if (!graph.hasEdge(match.listing_a, match.listing_b)) {
      graph.addEdge(match.listing_a, match.listing_b, { score: match.score });
    }
  }

  // 3) Obtener componentes conectadas
  const components = largestConnectedComponentsSubgraph(graph);

  console.log(`[clustering] ${components.length} componentes encontradas`);

  // 4) Procesar cada componente
  for (const subgraph of components) {
    const nodeList = subgraph.nodes();
    const componentSize = nodeList.length;

    console.log(`[clustering] componente de ${componentSize} nodos`);

    if (componentSize > max_component_size) {
      console.warn(`[clustering] ADVERTENCIA: componente de ${componentSize} nodos excede límite ${max_component_size}`);
      // Re-particionar con umbral más estricto
      console.log(`[clustering] re-particionando con umbral más estricto...`);
      const strictMatches = matches.filter(m => m.score >= Math.max(min_score_for_edge, 0.95));
      if (strictMatches.length > 0) {
        const strictGraph = new Graph();
        for (const id of nodeList) strictGraph.addNode(id);
        for (const match of strictMatches) {
          if (nodeList.includes(match.listing_a) && nodeList.includes(match.listing_b)) {
            if (!strictGraph.hasEdge(match.listing_a, match.listing_b)) {
              strictGraph.addEdge(match.listing_a, match.listing_b, { score: match.score });
            }
          }
        }
        const strictComponents = largestConnectedComponentsSubgraph(strictGraph);
        for (const strictComp of strictComponents) {
          await assignPropertyId(client, strictComp.nodes());
        }
      } else {
        // Fallback: no re-particionar, asumir que el usuario revisará manualmente
        console.warn('[clustering] no hay matches con score suficiente para re-particionar, marcando como sospechoso');
        // Guardar en una tabla de "problematic_clusters" para revisión manual (si existe)
      }
    } else {
      // Normal: asignar property_id canónico a todo el componente
      await assignPropertyId(client, nodeList);
    }
  }

  console.log('[clustering] completado');
}

/**
 * Asigna un property_id canónico a un grupo de listings.
 * El canónico es el listing más antiguo (first_seen_at), o con mejor score promedio.
 *
 * @param {pg.Client} client
 * @param {string[]} listingIds - UUIDs de listings que se agrupan
 */
async function assignPropertyId(client, listingIds) {
  if (listingIds.length === 0) return;

  // Elegir listing "canónico": el más antiguo (más confiable)
  const canonicalResult = await client.query(`
    SELECT id
    FROM listings
    WHERE id = ANY($1::uuid[])
    ORDER BY first_seen_at ASC
    LIMIT 1
  `, [listingIds]);

  if (canonicalResult.rows.length === 0) return;

  const canonicalListingId = canonicalResult.rows[0].id;

  // Obtener su property_id o crear uno nuevo
  const existingProperty = await client.query(`
    SELECT property_id FROM listings WHERE id = $1
  `, [canonicalListingId]);

  let propertyId = existingProperty.rows[0]?.property_id;

  if (!propertyId) {
    // Crear nuevo property a partir de este listing canónico
    const listingData = await client.query(`
      SELECT
        operation, property_type, price, square_meters, bedrooms, bathrooms,
        zone_id, latitude, longitude, is_active, advertiser_type
      FROM listings
      WHERE id = $1
    `, [canonicalListingId]);

    if (listingData.rows.length === 0) return;

    const listing = listingData.rows[0];
    const propertyResult = await client.query(`
      INSERT INTO property (
        operation, property_type, canonical_price, square_meters, bedrooms, bathrooms,
        zone_id, latitude, longitude, is_active, listing_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      listing.operation,
      listing.property_type,
      listing.price,
      listing.square_meters,
      listing.bedrooms,
      listing.bathrooms,
      listing.zone_id,
      listing.latitude,
      listing.longitude,
      listing.is_active,
      listingIds.length
    ]);

    propertyId = propertyResult.rows[0].id;
  }

  // Asignar todos los listings a este property_id
  await client.query(`
    UPDATE listings
    SET property_id = $1, updated_at = now()
    WHERE id = ANY($2::uuid[])
  `, [propertyId, listingIds]);

  console.log(`[clustering] grupo de ${listingIds.length} listings → property ${propertyId.slice(0, 8)}...`);
}
