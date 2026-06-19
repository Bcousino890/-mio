-- ═════════════════════════════════════════════════════════════════════════════
-- EXEMPLOS DE QUERIES PARA EL FILTRO MEJORADO "PARTICULAR | AGENCIA"
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Este archivo contiene ejemplos de queries SQL para cada combinación posible
-- del filtro de anunciante (advertiser_type) con las nuevas sub-opciones.
--
-- ESTRUCTURA DEL FILTRO:
-- ├── OPERADOR PRINCIPAL (radio)
-- │   ├── Todo
-- │   ├── Particular (sub-opciones)
-- │   │   ├── Sólo particulares
-- │   │   ├── Listado como privado por agencia (TODO: BD)
-- │   │   └── Ex-Listado como privado por agencia (TODO: BD)
-- │   └── Agencias (sub-opciones)
-- │       ├── Con esta agencia (selector)
-- │       ├── Exclusivo/No exclusivo (radio)
-- │       └── Excluir esta agencia (selector)
--

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. TODO - Mostrar todos los anuncios (sin filtro de anunciante)
-- ═════════════════════════════════════════════════════════════════════════════

SELECT * FROM listings
WHERE is_active = true
ORDER BY last_seen_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. PARTICULAR - Opciones:
-- ═════════════════════════════════════════════════════════════════════════════

-- 2.1. Sólo particulares (advertiser_type = 'particular')
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'particular'
ORDER BY last_seen_at DESC;

-- 2.2. Sólo particulares + Listado como privado por agencia
-- TODO: Agregar columna is_private_by_agency a listings
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'particular'
  -- AND is_private_by_agency = true
ORDER BY last_seen_at DESC;

-- 2.3. Sólo particulares + Ex-Listado como privado por agencia
-- TODO: Agregar columna was_private_by_agency a listings
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'particular'
  -- AND was_private_by_agency = true
ORDER BY last_seen_at DESC;

-- 2.4. Particulares + privados + ex-privados (múltiples opciones)
-- TODO: Cuando se agreguen las columnas a BD
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'particular'
  -- AND (is_private_by_agency = true OR was_private_by_agency = true)
ORDER BY last_seen_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. AGENCIAS - Opciones:
-- ═════════════════════════════════════════════════════════════════════════════

-- 3.1. Todas las agencias (sin restricción de agencia específica)
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
ORDER BY last_seen_at DESC;

-- 3.2. Agencia específica (agency_id = X)
-- Ejemplo con agency_id = 'uuid-example'
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Nombre Agencia'  -- o usar agency_id si existe campo específico
ORDER BY last_seen_at DESC;

-- 3.3. Agencia específica + Solo exclusivos
-- TODO: Requiere columna 'exclusive' en listings
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Nombre Agencia'
  -- AND exclusive = true
ORDER BY last_seen_at DESC;

-- 3.4. Agencia específica + Solo no exclusivos
-- TODO: Requiere columna 'exclusive' en listings
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Nombre Agencia'
  -- AND exclusive = false
ORDER BY last_seen_at DESC;

-- 3.5. Agencia específica + Ambos (exclusivos y no exclusivos)
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Nombre Agencia'
ORDER BY last_seen_at DESC;

-- 3.6. Excluir una agencia específica
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name != 'Agencia a Excluir'
ORDER BY last_seen_at DESC;

-- 3.7. Con agencia X + excluir agencia Y
SELECT * FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name = 'Agencia X'
  AND advertiser_name != 'Agencia Y'
ORDER BY last_seen_at DESC;

-- ═════════════════════════════════════════════════════════════════════════════
-- QUERIES PARA CARGAR LISTA DE AGENCIAS (para los selectores)
-- ═════════════════════════════════════════════════════════════════════════════

-- Obtener lista DISTINCTA de agencias activas
SELECT DISTINCT
  advertiser_name as agency_name
  -- TODO: Si existe campo agency_id específico, agregarlo
FROM listings
WHERE is_active = true
  AND advertiser_type = 'professional'
  AND advertiser_name IS NOT NULL
  AND advertiser_name != ''
ORDER BY advertiser_name ASC;

-- ═════════════════════════════════════════════════════════════════════════════
-- NOTAS TÉCNICAS Y REQUISITOS DE BASE DE DATOS
-- ═════════════════════════════════════════════════════════════════════════════
--
-- 1. COLUMNAS EXISTENTES en `listings`:
--    - advertiser_type (text): 'particular' | 'professional' | 'unknown'
--    - advertiser_name (text): nombre de agencia/profesional
--    - is_active (boolean): estado del anuncio
--
-- 2. COLUMNAS A AGREGAR (futuro):
--    - is_private_by_agency (boolean): anuncio listado como privado por agencia
--    - was_private_by_agency (boolean): anuncio fue listado privado (pero ya no)
--    - exclusive (boolean): indica si es exclusiva
--    - agency_id (uuid): referencia a tabla agencies (si se crea)
--
-- 3. TABLA agencies (propuesta):
--    CREATE TABLE agencies (
--      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--      name text NOT NULL UNIQUE,
--      created_at timestamptz DEFAULT now(),
--      updated_at timestamptz DEFAULT now()
--    );
--
--    ALTER TABLE listings ADD COLUMN agency_id uuid REFERENCES agencies(id);
--
-- 4. VENTAJAS DE ESTA ESTRUCTURA:
--    - Mantener compatibilidad hacia atrás (advertiser_name sigue siendo útil)
--    - Permitir búsquedas futuras más eficientes por agency_id
--    - Facilitar relaciones con tabla de agencias completa
--

-- ═════════════════════════════════════════════════════════════════════════════
-- SCRIPT MIGRACIONES FUTURAS (cuando esté lista)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- TODO: Crear en archivo de migración separado (ej: 0018_add_advertiser_columns.sql)
--
-- -- Agregar columnas para las nuevas opciones
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_private_by_agency boolean DEFAULT false;
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS was_private_by_agency boolean DEFAULT false;
-- ALTER TABLE listings ADD COLUMN IF NOT EXISTS exclusive boolean DEFAULT false;
--
-- -- Crear índices para optimizar búsquedas
-- CREATE INDEX IF NOT EXISTS idx_listings_is_private_by_agency
--   ON listings(is_private_by_agency) WHERE is_private_by_agency = true;
-- CREATE INDEX IF NOT EXISTS idx_listings_was_private_by_agency
--   ON listings(was_private_by_agency) WHERE was_private_by_agency = true;
-- CREATE INDEX IF NOT EXISTS idx_listings_exclusive
--   ON listings(exclusive, advertiser_type) WHERE advertiser_type = 'professional';
--
