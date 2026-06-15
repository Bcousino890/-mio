-- ============================================================
-- 0025: Agent roles and permissions system
-- Adds agent_junior, agent_senior, agent_admin roles
-- Creates permissions table with role-based access matrix
-- ============================================================

-- Step 1: Ampliar el tipo user_role para incluir los nuevos roles de agente
-- Como es un ENUM de PostgreSQL, hay que usar ALTER TYPE
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_junior';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_senior';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent_admin';

-- Step 2: Crear tabla de permisos
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role        TEXT NOT NULL,
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  allowed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, resource, action)
);

-- Índice para consultas rápidas por rol
CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role);
-- Índice compuesto para lookups exactos
CREATE INDEX IF NOT EXISTS idx_permissions_role_resource_action ON permissions(role, resource, action);

COMMENT ON TABLE permissions IS 'Matriz de permisos por rol para el sistema de agentes inmobiliarios';
COMMENT ON COLUMN permissions.role IS 'Rol del usuario (agent_junior, agent_senior, agent_admin, etc.)';
COMMENT ON COLUMN permissions.resource IS 'Recurso al que se aplica el permiso (particulares, properties, mensajes, etc.)';
COMMENT ON COLUMN permissions.action IS 'Acción permitida o denegada (view, create, edit, delete, contact)';
COMMENT ON COLUMN permissions.allowed IS 'true = permitido, false = denegado';

-- ============================================================
-- Step 3: Seed - Matriz de permisos
-- Recursos: particulares, properties, mensajes, usuarios, reportes, configuracion, visitas
-- Acciones: view, create, edit, delete, contact
-- ============================================================

INSERT INTO permissions (role, resource, action, allowed) VALUES

-- ─── agent_junior ───────────────────────────────────────────
-- Puede VER particulares, contactar, ver teléfonos
('agent_junior', 'particulares',   'view',    true),
('agent_junior', 'particulares',   'create',  false),
('agent_junior', 'particulares',   'edit',    false),
('agent_junior', 'particulares',   'delete',  false),
('agent_junior', 'particulares',   'contact', true),
-- Puede VER propiedades (NO crear, NO editar, NO borrar)
('agent_junior', 'properties',     'view',    true),
('agent_junior', 'properties',     'create',  false),
('agent_junior', 'properties',     'edit',    false),
('agent_junior', 'properties',     'delete',  false),
('agent_junior', 'properties',     'contact', false),
-- Puede VER mensajes con clientes
('agent_junior', 'mensajes',       'view',    true),
('agent_junior', 'mensajes',       'create',  false),
('agent_junior', 'mensajes',       'edit',    false),
('agent_junior', 'mensajes',       'delete',  false),
('agent_junior', 'mensajes',       'contact', false),
-- NO puede gestionar usuarios
('agent_junior', 'usuarios',       'view',    false),
('agent_junior', 'usuarios',       'create',  false),
('agent_junior', 'usuarios',       'edit',    false),
('agent_junior', 'usuarios',       'delete',  false),
('agent_junior', 'usuarios',       'contact', false),
-- NO puede ver reportes
('agent_junior', 'reportes',       'view',    false),
('agent_junior', 'reportes',       'create',  false),
('agent_junior', 'reportes',       'edit',    false),
('agent_junior', 'reportes',       'delete',  false),
('agent_junior', 'reportes',       'contact', false),
-- NO puede acceder a configuración
('agent_junior', 'configuracion',  'view',    false),
('agent_junior', 'configuracion',  'create',  false),
('agent_junior', 'configuracion',  'edit',    false),
('agent_junior', 'configuracion',  'delete',  false),
('agent_junior', 'configuracion',  'contact', false),
-- Puede ver visitas pero no crear
('agent_junior', 'visitas',        'view',    true),
('agent_junior', 'visitas',        'create',  false),
('agent_junior', 'visitas',        'edit',    false),
('agent_junior', 'visitas',        'delete',  false),
('agent_junior', 'visitas',        'contact', false),

-- ─── agent_senior ───────────────────────────────────────────
-- Todo lo de agent_junior + crear propiedades desde particulares, editar propias, agendar visitas, actualizar teléfonos
('agent_senior', 'particulares',   'view',    true),
('agent_senior', 'particulares',   'create',  false),
('agent_senior', 'particulares',   'edit',    true),
('agent_senior', 'particulares',   'delete',  false),
('agent_senior', 'particulares',   'contact', true),
-- Puede crear y editar propiedades propias
('agent_senior', 'properties',     'view',    true),
('agent_senior', 'properties',     'create',  true),
('agent_senior', 'properties',     'edit',    true),
('agent_senior', 'properties',     'delete',  false),
('agent_senior', 'properties',     'contact', false),
-- Puede ver mensajes
('agent_senior', 'mensajes',       'view',    true),
('agent_senior', 'mensajes',       'create',  false),
('agent_senior', 'mensajes',       'edit',    false),
('agent_senior', 'mensajes',       'delete',  false),
('agent_senior', 'mensajes',       'contact', false),
-- NO puede gestionar usuarios
('agent_senior', 'usuarios',       'view',    false),
('agent_senior', 'usuarios',       'create',  false),
('agent_senior', 'usuarios',       'edit',    false),
('agent_senior', 'usuarios',       'delete',  false),
('agent_senior', 'usuarios',       'contact', false),
-- NO puede ver reportes
('agent_senior', 'reportes',       'view',    false),
('agent_senior', 'reportes',       'create',  false),
('agent_senior', 'reportes',       'edit',    false),
('agent_senior', 'reportes',       'delete',  false),
('agent_senior', 'reportes',       'contact', false),
-- NO puede acceder a configuración
('agent_senior', 'configuracion',  'view',    false),
('agent_senior', 'configuracion',  'create',  false),
('agent_senior', 'configuracion',  'edit',    false),
('agent_senior', 'configuracion',  'delete',  false),
('agent_senior', 'configuracion',  'contact', false),
-- Puede agendar visitas
('agent_senior', 'visitas',        'view',    true),
('agent_senior', 'visitas',        'create',  true),
('agent_senior', 'visitas',        'edit',    true),
('agent_senior', 'visitas',        'delete',  false),
('agent_senior', 'visitas',        'contact', false),

-- ─── agent_admin ────────────────────────────────────────────
-- Todo lo anterior + gestionar agentes, ver todos los reportes, acceso a configuración
('agent_admin',  'particulares',   'view',    true),
('agent_admin',  'particulares',   'create',  false),
('agent_admin',  'particulares',   'edit',    true),
('agent_admin',  'particulares',   'delete',  true),
('agent_admin',  'particulares',   'contact', true),
-- Acceso completo a propiedades
('agent_admin',  'properties',     'view',    true),
('agent_admin',  'properties',     'create',  true),
('agent_admin',  'properties',     'edit',    true),
('agent_admin',  'properties',     'delete',  true),
('agent_admin',  'properties',     'contact', false),
-- Acceso completo a mensajes
('agent_admin',  'mensajes',       'view',    true),
('agent_admin',  'mensajes',       'create',  false),
('agent_admin',  'mensajes',       'edit',    false),
('agent_admin',  'mensajes',       'delete',  false),
('agent_admin',  'mensajes',       'contact', false),
-- Puede gestionar usuarios (asignar roles a agentes)
('agent_admin',  'usuarios',       'view',    true),
('agent_admin',  'usuarios',       'create',  true),
('agent_admin',  'usuarios',       'edit',    true),
('agent_admin',  'usuarios',       'delete',  false),
('agent_admin',  'usuarios',       'contact', false),
-- Puede ver todos los reportes
('agent_admin',  'reportes',       'view',    true),
('agent_admin',  'reportes',       'create',  false),
('agent_admin',  'reportes',       'edit',    false),
('agent_admin',  'reportes',       'delete',  false),
('agent_admin',  'reportes',       'contact', false),
-- Acceso a configuración
('agent_admin',  'configuracion',  'view',    true),
('agent_admin',  'configuracion',  'create',  false),
('agent_admin',  'configuracion',  'edit',    true),
('agent_admin',  'configuracion',  'delete',  false),
('agent_admin',  'configuracion',  'contact', false),
-- Puede gestionar visitas
('agent_admin',  'visitas',        'view',    true),
('agent_admin',  'visitas',        'create',  true),
('agent_admin',  'visitas',        'edit',    true),
('agent_admin',  'visitas',        'delete',  true),
('agent_admin',  'visitas',        'contact', false)

ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;
