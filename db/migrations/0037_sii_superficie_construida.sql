-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 · Agregar superficie construida a sii_roles_cl y sincronizar desde
-- sii_construcciones_cl para matching de propiedades de alta efectividad
-- ─────────────────────────────────────────────────────────────────────────────

-- Agregar columna superficie_construida_m2 si no existe
ALTER TABLE sii_roles_cl ADD COLUMN IF NOT EXISTS superficie_construida_m2 INTEGER;

-- Crear índice para búsquedas rápidas por superficie construida
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_superficie_construida
  ON sii_roles_cl(superficie_construida_m2)
  WHERE superficie_construida_m2 IS NOT NULL;

-- Llenar retroactivamente: suma de construcciones por rol
-- Esta query sumariza todas las líneas de construcción de cada rol
UPDATE sii_roles_cl r
SET superficie_construida_m2 = (
  SELECT COALESCE(SUM(c.superficie_m2), 0)
  FROM sii_construcciones_cl c
  WHERE c.rol_id = r.id
    AND c.superficie_m2 IS NOT NULL
)
WHERE superficie_construida_m2 IS NULL;

-- Función para mantener superficie_construida_m2 actualizada cuando
-- se insertan/actualizan/eliminan líneas de construcción
CREATE OR REPLACE FUNCTION update_sii_superficie_construida()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalcular suma para el rol afectado (NEW.rol_id o OLD.rol_id)
  UPDATE sii_roles_cl
  SET
    superficie_construida_m2 = (
      SELECT COALESCE(SUM(c.superficie_m2), 0)
      FROM sii_construcciones_cl c
      WHERE c.rol_id = sii_roles_cl.id
        AND c.superficie_m2 IS NOT NULL
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.rol_id, OLD.rol_id);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger anterior si existe (para idempotencia)
DROP TRIGGER IF EXISTS trg_update_sii_superficie_construida ON sii_construcciones_cl;

-- Crear trigger que se ejecuta después de insert/update/delete
CREATE TRIGGER trg_update_sii_superficie_construida
AFTER INSERT OR UPDATE OR DELETE ON sii_construcciones_cl
FOR EACH ROW
EXECUTE FUNCTION update_sii_superficie_construida();

-- Verificación: contar cuántos roles tienen superficie_construida_m2 > 0
-- SELECT COUNT(*), COUNT(*) FILTER (WHERE superficie_construida_m2 > 0)
-- FROM sii_roles_cl;
