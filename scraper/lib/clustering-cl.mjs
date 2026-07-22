// ─────────────────────────────────────────────────────────────────────────────
// Deduplicación chilena — Nivel 2 (probabilístico): clustering de pares
// confirmados en propiedades canónicas `property_cl`.
//
// Ver docs/PLAN-ANUNCIOS-CL.md §2 (dedup en 2 niveles) y §4 H3.
//
// Este es el paso que dedup-cl.mjs (Nivel 1) DELIBERADAMENTE no implementa: la
// FUSIÓN de property_cl. El Nivel 1 crea un property_cl por cada
// (property_code, advertiser_id) — es decir, la MISMA corredora re-publicando su
// propiedad. El caso difícil es la MISMA propiedad física publicada por N
// corredoras DISTINTAS, cada una con su propio property_code y por tanto su
// propio property_cl de Nivel 1. Aquí se resuelve:
//
//   1. Se leen los pares `listing_match_cl.status='confirmed'` (los que
//      identity-resolution-cl.mjs + revisión humana dieron por buenos).
//   2. Se arma un grafo (graphology, mismo patrón que clustering.mjs de España)
//      y se sacan las componentes conexas.
//   3. Cada componente = una propiedad física. Todos sus listings se consolidan
//      en UN property_cl, FUSIONANDO los property_cl de Nivel 1 preexistentes de
//      las distintas corredoras en uno solo (el "superviviente"), y borrando los
//      property_cl que quedan huérfanos (0 listings) tras la reasignación.
//
// FUSIÓN vs. datos crudos: property_cl es una entidad DERIVADA (se recalcula a
// partir de listings_cl), no un snapshot crudo — el principio "nunca se
// sobrescribe un snapshot crudo" (plan §8.1) aplica a listings_cl /
// listing_snapshots_cl / listing_version_log_cl, NO a property_cl. Por eso aquí
// SÍ se puede borrar un property_cl huérfano: no se pierde ninguna verdad, se
// re-derivaría idéntico. El borrado solo ocurre cuando el property_cl perdedor
// ya no tiene ningún listing apuntándolo (garantía verificada antes de borrar).
//
// Idempotente: re-ejecutar sobre las mismas confirmaciones no duplica ni vuelve
// a fusionar lo ya fusionado (una componente cuyos listings ya comparten un
// único property_cl y sin perdedores que borrar es un no-op, salvo el refresco
// de agregados, que es inocuo).
//
// Testeable sin Postgres: toda la lógica de decisión (componentes conexas,
// elección de superviviente, plan de reasignación/borrado) vive en funciones
// PURAS (planClusterMerges y auxiliares); runNivel2ClusteringCl solo hace de
// adaptador entre esas funciones y la BD. Ver clustering-cl.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import Graph from 'graphology';
import { connectedComponents } from 'graphology-components';
import { CL_IDENTITY_THRESHOLDS } from './identity-resolution-cl.mjs';
import {
  consolidateFields,
  refreshPropertyClAggregates,
  LISTING_FIELDS_FOR_CONSOLIDATION,
} from './dedup-cl.mjs';

// Techo de tamaño de componente antes de sospechar de un "black hole" (una
// cadena de matches débiles que traga propiedades que no son la misma). Mismo
// mecanismo que clustering.mjs de España: si se supera, se re-particiona la
// componente con un umbral de score más estricto en vez de fusionar a ciegas.
const DEFAULT_MAX_COMPONENT_SIZE = 20;
// Al re-particionar, exigir score alto de verdad (no solo "confirmed").
const STRICT_EDGE_SCORE = 0.9;

/**
 * Construye las componentes conexas a partir de una lista de aristas
 * confirmadas. Cada arista es { a, b, score } con a/b = listing ids.
 *
 * @param {{a:string,b:string,score:number}[]} edges
 * @returns {string[][]} listas de listing ids, una por componente
 */
export function connectedComponentsFromEdges(edges) {
  const graph = new Graph({ type: 'undirected', multi: false });
  for (const { a, b } of edges) {
    if (!graph.hasNode(a)) graph.addNode(a);
    if (!graph.hasNode(b)) graph.addNode(b);
    if (a !== b && !graph.hasEdge(a, b)) graph.addEdge(a, b);
  }
  return connectedComponents(graph);
}

/**
 * Máximo score de arista incidente a cada nodo (su vínculo MÁS fuerte con el
 * cluster). Se usa como match_confidence de ese listing en el Nivel 2.
 *
 * @param {{a:string,b:string,score:number}[]} edges
 * @returns {Map<string, number>}
 */
export function maxIncidentScoreByNode(edges) {
  const byNode = new Map();
  for (const { a, b, score } of edges) {
    if (score == null) continue;
    if (!(byNode.get(a) >= score)) byNode.set(a, Math.max(byNode.get(a) ?? -Infinity, score));
    if (!(byNode.get(b) >= score)) byNode.set(b, Math.max(byNode.get(b) ?? -Infinity, score));
  }
  return byNode;
}

/**
 * Elige el property_cl "superviviente" de una fusión, de forma determinista
 * (para que re-ejecutar dé el mismo resultado):
 *   1. el que más listings tiene hoy (menos reasignación = menos churn),
 *   2. desempate por el creado antes (más "asentado"),
 *   3. desempate final por id lexicográfico (estable).
 *
 * @param {{id:string, listing_count:number, created_at:string|number|Date}[]} candidates
 * @returns {string|null} id del superviviente, o null si no hay candidatos
 */
export function chooseSurvivorPropertyCl(candidates) {
  if (!candidates || candidates.length === 0) return null;
  const sorted = [...candidates].sort((x, y) => {
    if ((y.listing_count ?? 0) !== (x.listing_count ?? 0)) return (y.listing_count ?? 0) - (x.listing_count ?? 0);
    const xc = x.created_at ? new Date(x.created_at).getTime() : Infinity;
    const yc = y.created_at ? new Date(y.created_at).getTime() : Infinity;
    if (xc !== yc) return xc - yc;
    return String(x.id) < String(y.id) ? -1 : 1;
  });
  return sorted[0].id;
}

/**
 * LÓGICA PURA de la fusión de UNA componente. No toca la BD: recibe el estado ya
 * cargado y devuelve un plan de escritura que el runner aplica.
 *
 * @param {object} params
 * @param {string[]} params.componentNodes - listing ids que la arista confirmada conectó.
 * @param {Map<string, string|null>} params.propertyClIdByListing - property_cl_id actual de CADA
 *   listing relevante (de la familia expandida), null si aún sin agrupar.
 * @param {Map<string, string[]>} params.listingsByPropertyCl - todos los listings de cada property_cl.
 * @param {Array} params.propertyClMeta - [{id, listing_count, created_at}] de los property_cl involucrados.
 * @param {Map<string, number>} params.incidentScoreByNode - score Nivel 2 por nodo del grafo.
 * @returns {{
 *   survivorId: string|null,
 *   createSurvivor: boolean,
 *   familyListingIds: string[],
 *   reassign: {listingId:string, confidence:number|null}[],
 *   deletePropertyClIds: string[]
 * }}
 */
export function planComponentMerge({
  componentNodes,
  propertyClIdByListing,
  listingsByPropertyCl,
  propertyClMeta,
  incidentScoreByNode,
}) {
  // 1. property_cl distintos que tocan los nodos de la componente.
  const involvedPropertyClIds = new Set();
  for (const node of componentNodes) {
    const pid = propertyClIdByListing.get(node) ?? null;
    if (pid) involvedPropertyClIds.add(pid);
  }

  // 2. Familia COMPLETA: todos los listings de esos property_cl (no solo los
  //    nodos puente), más los propios nodos sin property_cl todavía.
  const familyListingIds = new Set(componentNodes);
  for (const pid of involvedPropertyClIds) {
    for (const lid of listingsByPropertyCl.get(pid) ?? []) familyListingIds.add(lid);
  }

  // 3. Superviviente (o crear uno nuevo si ningún nodo tenía property_cl).
  const candidates = propertyClMeta.filter((m) => involvedPropertyClIds.has(m.id));
  const survivorId = chooseSurvivorPropertyCl(candidates);
  const createSurvivor = survivorId == null;

  // 4. Reasignaciones: cada listing de la familia → superviviente. A los nodos
  //    del grafo se les fija match_confidence = su mejor arista (Nivel 2); a los
  //    demás (arrastrados por compartir property_cl de Nivel 1) NO se les toca
  //    la confianza — su vínculo determinista por property_code sigue siendo 1.
  const reassign = [];
  for (const lid of familyListingIds) {
    const isGraphNode = incidentScoreByNode.has(lid);
    reassign.push({
      listingId: lid,
      confidence: isGraphNode ? incidentScoreByNode.get(lid) : null,
    });
  }

  // 5. Los property_cl involucrados que NO son el superviviente quedan huérfanos.
  const deletePropertyClIds = [...involvedPropertyClIds].filter((pid) => pid !== survivorId);

  return {
    survivorId,
    createSurvivor,
    familyListingIds: [...familyListingIds],
    reassign,
    deletePropertyClIds,
  };
}

/**
 * Re-particiona una componente demasiado grande (posible "black hole") usando
 * solo las aristas de score alto. Devuelve las sub-componentes resultantes.
 * Si tras el filtro estricto no queda ninguna arista, devuelve cada nodo como su
 * propia sub-componente (se prefiere NO fusionar antes que fusionar de más).
 *
 * @param {string[]} nodes
 * @param {{a:string,b:string,score:number}[]} edges - aristas globales
 * @param {number} strictScore
 * @returns {string[][]}
 */
export function repartitionComponent(nodes, edges, strictScore = STRICT_EDGE_SCORE) {
  const nodeSet = new Set(nodes);
  const strictEdges = edges.filter(
    (e) => e.score >= strictScore && nodeSet.has(e.a) && nodeSet.has(e.b)
  );
  if (strictEdges.length === 0) return nodes.map((n) => [n]);
  const sub = connectedComponentsFromEdges(strictEdges);
  // Nodos que ninguna arista estricta tocó quedan solos (no se fusionan).
  const covered = new Set(sub.flat());
  for (const n of nodes) if (!covered.has(n)) sub.push([n]);
  return sub;
}

/**
 * Nivel 2 de dedup (H3): clusteriza los pares confirmados de listing_match_cl en
 * property_cl, fusionando los property_cl de Nivel 1 de corredoras distintas.
 *
 * @param {import('pg').Client} client
 * @param {object} [options]
 * @param {number} [options.min_score_for_edge] - umbral de score para tomar una arista (default: CL_IDENTITY_THRESHOLDS.confirmed).
 * @param {number} [options.max_component_size] - techo antes de re-particionar (default 20).
 * @returns {Promise<{edges:number, components:number, merged:number, created:number, deleted:number, relinked:number}>}
 */
export async function runNivel2ClusteringCl(client, options = {}) {
  const {
    min_score_for_edge = CL_IDENTITY_THRESHOLDS.confirmed,
    max_component_size = DEFAULT_MAX_COMPONENT_SIZE,
  } = options;

  // 1. Aristas confirmadas.
  const { rows: edgeRows } = await client.query(
    `SELECT listing_a AS a, listing_b AS b, score
     FROM listing_match_cl
     WHERE status = 'confirmed' AND score >= $1`,
    [min_score_for_edge]
  );
  const edges = edgeRows.map((r) => ({ a: r.a, b: r.b, score: Number(r.score) }));
  if (edges.length === 0) {
    return { edges: 0, components: 0, merged: 0, created: 0, deleted: 0, relinked: 0 };
  }

  const incidentScoreByNode = maxIncidentScoreByNode(edges);

  // 2. Componentes conexas, con protección black-hole.
  const rawComponents = connectedComponentsFromEdges(edges);
  const components = [];
  for (const comp of rawComponents) {
    if (comp.length > max_component_size) {
      for (const sub of repartitionComponent(comp, edges)) components.push(sub);
    } else {
      components.push(comp);
    }
  }

  let merged = 0;
  let created = 0;
  let deleted = 0;
  let relinked = 0;

  for (const componentNodes of components) {
    // 3. Estado actual de los nodos: su property_cl_id (si alguno).
    const { rows: nodeRows } = await client.query(
      `SELECT id, property_cl_id FROM listings_cl WHERE id = ANY($1::uuid[])`,
      [componentNodes]
    );
    const propertyClIdByListing = new Map(nodeRows.map((r) => [r.id, r.property_cl_id]));
    const involvedPropertyClIds = [
      ...new Set(nodeRows.map((r) => r.property_cl_id).filter(Boolean)),
    ];

    // 4. Familias completas de esos property_cl + metadatos para elegir superviviente.
    const listingsByPropertyCl = new Map();
    let propertyClMeta = [];
    if (involvedPropertyClIds.length > 0) {
      const { rows: familyRows } = await client.query(
        `SELECT id, property_cl_id FROM listings_cl WHERE property_cl_id = ANY($1::uuid[])`,
        [involvedPropertyClIds]
      );
      for (const r of familyRows) {
        if (!listingsByPropertyCl.has(r.property_cl_id)) listingsByPropertyCl.set(r.property_cl_id, []);
        listingsByPropertyCl.get(r.property_cl_id).push(r.id);
        propertyClIdByListing.set(r.id, r.property_cl_id);
      }
      const { rows: metaRows } = await client.query(
        `SELECT id, listing_count, created_at FROM property_cl WHERE id = ANY($1::uuid[])`,
        [involvedPropertyClIds]
      );
      propertyClMeta = metaRows;
    }

    const plan = planComponentMerge({
      componentNodes,
      propertyClIdByListing,
      listingsByPropertyCl,
      propertyClMeta,
      incidentScoreByNode,
    });

    // Nada que fusionar (todos ya en el mismo property_cl y sin huérfanos): solo
    // refrescamos agregados si hay superviviente y seguimos.
    const alreadyUnified =
      !plan.createSurvivor &&
      plan.deletePropertyClIds.length === 0 &&
      plan.familyListingIds.every((lid) => propertyClIdByListing.get(lid) === plan.survivorId);

    // 5. Superviviente: crear si ningún nodo tenía property_cl.
    let survivorId = plan.survivorId;
    if (plan.createSurvivor) {
      const { rows: familyRows } = await client.query(
        `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION} FROM listings_cl WHERE id = ANY($1::uuid[])`,
        [plan.familyListingIds]
      );
      const c = consolidateFields(familyRows);
      const { rows: ins } = await client.query(
        `INSERT INTO property_cl (
           operation, property_type, canonical_price, canonical_price_uf, uf_rate, uf_rate_date,
           square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
           location_confidence, exact_address, listing_count, corredora_count,
           portals, source_types, advertiser_kinds, is_active, first_seen_at, last_seen_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING id`,
        [
          c.operation, c.property_type, c.canonical_price, c.canonical_price_uf, c.uf_rate, c.uf_rate_date,
          c.square_meters, c.bedrooms, c.bathrooms, c.comuna_id, c.localidad, c.latitude, c.longitude,
          c.location_confidence, c.exact_address, c.listing_count, c.corredora_count,
          c.portals, c.source_types, c.advertiser_kinds, c.is_active, c.first_seen_at, c.last_seen_at,
        ]
      );
      survivorId = ins[0].id;
      created++;
    }

    // 6. Reasignar toda la familia al superviviente. A los nodos del grafo se
    //    les fija la confianza Nivel 2; a los arrastrados NO se les toca.
    const nodeReassign = plan.reassign.filter((r) => r.confidence != null);
    const dragReassign = plan.reassign.filter((r) => r.confidence == null).map((r) => r.listingId);

    for (const { listingId, confidence } of nodeReassign) {
      const { rowCount } = await client.query(
        `UPDATE listings_cl
         SET property_cl_id = $1, match_confidence = $2, updated_at = now()
         WHERE id = $3 AND (property_cl_id IS DISTINCT FROM $1 OR match_confidence IS DISTINCT FROM $2)`,
        [survivorId, confidence, listingId]
      );
      relinked += rowCount;
    }
    if (dragReassign.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE listings_cl
         SET property_cl_id = $1, updated_at = now()
         WHERE id = ANY($2::uuid[]) AND property_cl_id IS DISTINCT FROM $1`,
        [survivorId, dragReassign]
      );
      relinked += rowCount;
    }

    // 7. Borrar property_cl huérfanos (garantía: 0 listings apuntándolos).
    if (plan.deletePropertyClIds.length > 0) {
      const { rows: orphanCheck } = await client.query(
        `SELECT p.id
         FROM property_cl p
         WHERE p.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM listings_cl l WHERE l.property_cl_id = p.id)`,
        [plan.deletePropertyClIds]
      );
      const trulyOrphan = orphanCheck.map((r) => r.id);
      if (trulyOrphan.length > 0) {
        const { rowCount } = await client.query(
          `DELETE FROM property_cl WHERE id = ANY($1::uuid[])`,
          [trulyOrphan]
        );
        deleted += rowCount;
      }
    }

    if (survivorId) await refreshPropertyClAggregates(client, survivorId);
    if (!alreadyUnified) merged++;
  }

  return { edges: edges.length, components: components.length, merged, created, deleted, relinked };
}
