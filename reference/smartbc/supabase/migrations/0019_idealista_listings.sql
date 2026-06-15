-- Fase 2: expandir idealista_listings para la ficha completa
-- Compatible con la tabla ya existente (migración 0017) — usa solo ALTER TABLE.

-- Quitar CHECKs que bloquean nuevos valores (condition, rental_type)
ALTER TABLE idealista_listings DROP CONSTRAINT IF EXISTS idealista_listings_condition_check;
ALTER TABLE idealista_listings DROP CONSTRAINT IF EXISTS idealista_listings_rental_type_check;

-- Hacer property_id nullable: los listados "inspo" no tienen propiedad en el sistema
ALTER TABLE idealista_listings ALTER COLUMN property_id DROP NOT NULL;

-- Cambiar foto/video/plan IDs de uuid[] a text[] (IDs de Idealista tras subida manual)
ALTER TABLE idealista_listings
  ALTER COLUMN photo_ids TYPE text[] USING COALESCE(photo_ids::text[], '{}');
ALTER TABLE idealista_listings
  ALTER COLUMN video_ids TYPE text[] USING COALESCE(video_ids::text[], '{}');
ALTER TABLE idealista_listings
  ALTER COLUMN plan_ids TYPE text[] USING COALESCE(plan_ids::text[], '{}');
ALTER TABLE idealista_listings ALTER COLUMN photo_ids SET DEFAULT '{}';
ALTER TABLE idealista_listings ALTER COLUMN video_ids SET DEFAULT '{}';
ALTER TABLE idealista_listings ALTER COLUMN plan_ids SET DEFAULT '{}';

-- Soporte listados inspo (creados desde cero, sin propiedad en el sistema)
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS is_inspo boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS inspo_title text;

-- Tipo de inmueble
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS property_type text DEFAULT 'flat';

-- Localización
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_street text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_number text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_postal_code text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_city text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_block text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_door text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS address_visibility text DEFAULT 'exact';
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS reference_code text UNIQUE;

-- Características adicionales
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS bedrooms integer DEFAULT 0;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS bathrooms integer DEFAULT 0;

-- Precio / alquiler
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS max_tenants integer DEFAULT 0;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS pets_allowed boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS children_recommended boolean DEFAULT false;

-- Equipamiento
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS equipment_type text DEFAULT 'unknown';
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS windows_location text DEFAULT 'exterior';

-- Orientación
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS orientation_north boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS orientation_south boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS orientation_east boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS orientation_west boolean DEFAULT false;

-- Extras
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_terrace boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_balcony boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_parking boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_storage boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_pool boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_garden boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_wardrobes boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS has_ac boolean DEFAULT false;

-- Tipos especiales
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS is_penthouse boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS is_studio boolean DEFAULT false;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS is_duplex boolean DEFAULT false;

-- Eficiencia energética (ampliación)
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS energy_performance numeric;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS emission_rating text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS emission_value numeric;

-- Contacto y notas
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS contact_id text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS notes text;

-- Estado en Idealista
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS idealista_property_id text;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS idealista_state text DEFAULT 'draft';

-- Descripción del anuncio (sin el footer fijo — este se agrega siempre al publicar)
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS description text;

-- Coordenadas GPS para el mapa
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE idealista_listings ADD COLUMN IF NOT EXISTS longitude numeric;
