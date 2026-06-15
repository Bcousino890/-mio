-- Script SQL manual para aplicar todas las migraciones en el VPS
-- Ejecutar en psql: psql -U postgres -d postgres -f scripts/apply-migrations-manual.sql

-- ============================================================
-- MIGRACIÓN 0025: Agregar nuevos roles (agent_junior, agent_senior, agent_admin)
-- ============================================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_junior';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_senior';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_admin';

-- ============================================================
-- MIGRACIÓN 0029: Tabla de overrides de permisos por usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id);

ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_permission_overrides_admin_all"
  ON user_permission_overrides FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ============================================================
-- Verificar que todo está bien
-- ============================================================
SELECT 'Migraciones aplicadas exitosamente ✅' as estado;

-- Ver los roles disponibles
SELECT enum_range(NULL::user_role) as roles_disponibles;

-- Ver si la tabla de overrides existe
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'user_permission_overrides'
) as tabla_overrides_existe;
