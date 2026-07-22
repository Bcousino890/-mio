-- ─────────────────────────────────────────────────────────────────────────────
-- 0066 · listing_snapshots_cl + snapshot_blobs_cl: snapshots crudos inmutables
-- (plan Anuncios CL · H13 + H18)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoy `listing_version_log_cl` (0034) registra CAMBIOS (nuevo precio, delisted,
-- etc.), pero no existe append-only del JSON crudo de cada scrape — el
-- principio "nunca sobrescribir datos crudos, guardar todo para retroalimentar"
-- que pidió el usuario. Estas dos tablas lo cubren, con el mismo mecanismo de
-- dedup por contenido que ya se diseñó para las fotos (H7):
--
--   snapshot_blobs_cl   — el dato PESADO, una vez por contenido único
--                          (content_hash sha256 del JSON normalizado como PK).
--   listing_snapshots_cl — el PUNTERO liviano: qué contenido tuvo un listing y
--                          durante qué rango de tiempo (first_captured_at →
--                          last_seen_at).
--
-- CÓMO SE EVITA QUE EXPLOTE (H18 "guardar todo, que pese poco"): un scrape que
-- no trajo cambios NO inserta una fila de snapshot nueva — solo actualiza
-- `last_seen_at` de la fila-puntero vigente (ver
-- scraper/lib/snapshot-cl.mjs::recordSnapshotCl). Resultado: 90 pasadas/mes
-- idénticas de un listing ≈ 1 blob + 1 fila-puntero con last_seen_at corrido,
-- no 90 filas ni 90 copias del JSON. Nada se pierde: el rango
-- [first_captured_at, last_seen_at] de cada fila-puntero YA prueba que el
-- listing existió sin cambios durante todo ese tramo.
--
-- Particionado mensual (mencionado en el plan como optimización de H18):
-- deliberadamente NO se implementa en esta migración — con volumen bajo
-- (Fase 1, solo Las Condes) el particionado nativo de Postgres solo añade
-- carga operativa (crear particiones futuras, riesgo de inserts fallidos si
-- se olvida) sin beneficio real todavía. Se deja `first_captured_at` indexado
-- para que particionar por rango sea un `ALTER` reversible el día que el
-- volumen lo justifique (Fase 6, al escalar de Las Condes al resto de la RM).

CREATE TABLE IF NOT EXISTS snapshot_blobs_cl (
  content_hash  text PRIMARY KEY,        -- sha256 hex del JSON normalizado (canonical stringify, ver snapshot-cl.mjs)
  raw_json      jsonb NOT NULL,
  bytes         integer,                 -- tamaño del JSON serializado, para monitoreo de capacidad (H20)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listing_snapshots_cl (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES listings_cl(id) ON DELETE CASCADE,
  content_hash       text NOT NULL REFERENCES snapshot_blobs_cl(content_hash),

  -- Rango de vigencia de este contenido: desde que se vio por primera vez
  -- hasta la última pasada que lo confirmó sin cambios. Cuando el contenido
  -- cambia, esta fila queda "cerrada" (last_seen_at ya no se toca) y nace una
  -- fila nueva con el content_hash nuevo — así el historial completo de
  -- estados de un listing es una secuencia de estas filas, sin huecos.
  first_captured_at  timestamptz NOT NULL,
  last_seen_at       timestamptz NOT NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (last_seen_at >= first_captured_at)
);

-- Localizar rápido la fila-puntero VIGENTE de un listing (la de
-- first_captured_at más reciente) — es la consulta que hace recordSnapshotCl
-- en cada scrape para decidir si el contenido cambió.
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_cl_current
  ON listing_snapshots_cl(listing_id, first_captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_cl_hash
  ON listing_snapshots_cl(content_hash);
-- Timeline de precio (H15) y reportes de cobertura (H17) filtran por rango de
-- tiempo global, no solo por listing.
CREATE INDEX IF NOT EXISTS idx_listing_snapshots_cl_first_captured
  ON listing_snapshots_cl(first_captured_at DESC);
