-- ─────────────────────────────────────────────────────────────────────────────
-- 0062 · Deduplicar sii_construcciones_cl (re-ingestas duplicaron líneas)
-- ─────────────────────────────────────────────────────────────────────────────
-- Los roles se cargan con UPSERT (ON CONFLICT), pero las construcciones se
-- cargaban con INSERT plano, sin borrado previo ni constraint único
-- (web/lib/sii-catastro-ingest.ts, flushConstruccionesBatch). Cada vez que se
-- re-ingería una comuna, TODAS sus líneas de construcción se volvían a
-- insertar → duplicados exactos. Efecto visible: la ficha del rol mostraba la
-- misma construcción repetida (ej. DEL CANDIL 690 DP 201 A: dos filas
-- idénticas de 140 m²) y el trigger de superficie sumaba ambas (280 m² en vez
-- de 140). El fix de código (delete-antes-de-insert scoped por serie) evita
-- que vuelva a pasar; esta migración limpia lo ya duplicado.
--
-- Clave de deduplicado = la fila completa INCLUYENDO `linea` (correlativo de
-- la línea dentro del rol, poblado desde el archivo SII). Dos líneas
-- legítimas de un mismo rol tienen `linea` distinto y se conservan; una
-- re-ingesta produce filas byte-idénticas (mismo `linea`) que se colapsan.
-- Se conserva la fila más antigua (created_at, luego id) de cada grupo.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Filas sobrantes de cada grupo de duplicados exactos.
CREATE TEMP TABLE _dups_construcciones ON COMMIT DROP AS
SELECT id, rol_id
FROM (
  SELECT id, rol_id,
         ROW_NUMBER() OVER (
           PARTITION BY rol_id, linea, material_code, calidad_code, anio_construccion,
                        superficie_m2, destino_code, condicion_especial, numero_pisos,
                        codigo_suelo, superficie_suelo_ha
           ORDER BY created_at, id
         ) AS rn
  FROM sii_construcciones_cl
) t
WHERE rn > 1;

-- Se desactiva el trigger por-fila durante el borrado masivo (recalcularía la
-- superficie del rol por cada fila eliminada) y se recomputa una sola vez al
-- final, solo para los roles afectados.
ALTER TABLE sii_construcciones_cl DISABLE TRIGGER trg_update_sii_superficie_construida;

DELETE FROM sii_construcciones_cl WHERE id IN (SELECT id FROM _dups_construcciones);

ALTER TABLE sii_construcciones_cl ENABLE TRIGGER trg_update_sii_superficie_construida;

UPDATE sii_roles_cl r
SET superficie_construida_m2 = COALESCE((
      SELECT SUM(c.superficie_m2)
      FROM sii_construcciones_cl c
      WHERE c.rol_id = r.id AND c.superficie_m2 IS NOT NULL
    ), 0),
    updated_at = now()
WHERE r.id IN (SELECT DISTINCT rol_id FROM _dups_construcciones);

COMMIT;
