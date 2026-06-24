-- ─────────────────────────────────────────────────────────────────────────────
-- 0035 · Contactabilidad DealerNet (Chile) — teléfonos/direcciones/correos
-- ─────────────────────────────────────────────────────────────────────────────
-- DealerNet (proveedor contratado) expone un único web service SOAP
-- ("CentralDeInformacion") que consulta por RUT chileno y devuelve, según el
-- producto pedido, teléfonos/direcciones/correos clasificados en "probable"
-- vs "alternativo" con scores de ranking/calidad. No existe búsqueda inversa
-- por dirección en el protocolo documentado — por eso el RUT del propietario
-- se ingresa manualmente (el SII no lo entrega, solo el nombre) o se reusa
-- uno ya guardado.
--
-- Productos consultados (ver web/lib/dealernet.ts): 3407 Contactabilidad,
-- 3408 Verificación Múltiple, 3410 Directorio Teléfonos.
--
-- dealernet_contacts_cl: 1 fila por RUT consultado (upsert — la consulta más
-- reciente reemplaza el `raw_response`, pero los hijos se acumulan por
-- product_code para no perder histórico de qué producto trajo qué dato).

CREATE TABLE IF NOT EXISTS dealernet_contacts_cl (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rut_num           bigint NOT NULL,
  rut_dv            text NOT NULL,
  sii_rol           text,            -- rol catastral que originó la búsqueda (si aplica)
  sii_comuna_code   text,
  nombre_titular    text,            -- nombre devuelto por DealerNet para el RUT
  products_requested text[] NOT NULL DEFAULT '{}',
  retcode           int,
  retmsg            text,
  raw_response      jsonb,           -- respuesta completa normalizada, para auditoría
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rut_num, rut_dv)
);

CREATE INDEX IF NOT EXISTS idx_dealernet_contacts_cl_sii_rol
  ON dealernet_contacts_cl (sii_comuna_code, sii_rol)
  WHERE sii_rol IS NOT NULL;

CREATE OR REPLACE FUNCTION dealernet_contacts_cl_touch_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealernet_contacts_cl_touch ON dealernet_contacts_cl;
CREATE TRIGGER trg_dealernet_contacts_cl_touch
  BEFORE UPDATE ON dealernet_contacts_cl
  FOR EACH ROW EXECUTE FUNCTION dealernet_contacts_cl_touch_updated_at();

-- Teléfonos: se guardan TODOS los devueltos (probable + alternativo),
-- normalizados a formato internacional "+56..." (ver normalizePhoneCl en
-- web/lib/dealernet.ts). UNIQUE evita duplicar el mismo número si se vuelve
-- a consultar el mismo RUT con el mismo producto.
CREATE TABLE IF NOT EXISTS dealernet_phones_cl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES dealernet_contacts_cl(id) ON DELETE CASCADE,
  phone_e164      text NOT NULL,     -- normalizado, ej. "+56995429258"
  phone_raw       text NOT NULL,     -- tal cual lo devolvió DealerNet, ej. "56 (9) 95429258"
  categoria       text NOT NULL CHECK (categoria IN ('probable', 'alternativo')),
  clasificacion   text,              -- "C" celular, "F" fijo (según DealerNet)
  ind_whatsapp    boolean,
  idimagen        text,              -- referencia interna de DealerNet (no es una imagen descargable)
  ranking         numeric,
  calidad         numeric,
  product_code    text NOT NULL,     -- "3407" | "3408" | "3410"
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, phone_e164, product_code)
);

CREATE INDEX IF NOT EXISTS idx_dealernet_phones_cl_contact
  ON dealernet_phones_cl (contact_id);

CREATE TABLE IF NOT EXISTS dealernet_addresses_cl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES dealernet_contacts_cl(id) ON DELETE CASCADE,
  direccion       text NOT NULL,
  ubicacion       text,              -- "Comuna, Provincia, Región"
  rol             text,              -- rol de avalúo fiscal asociado, si DealerNet lo entrega
  categoria       text NOT NULL CHECK (categoria IN ('probable', 'alternativo')),
  ranking         numeric,
  calidad         numeric,
  product_code    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, direccion, product_code)
);

CREATE INDEX IF NOT EXISTS idx_dealernet_addresses_cl_contact
  ON dealernet_addresses_cl (contact_id);

CREATE TABLE IF NOT EXISTS dealernet_emails_cl (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES dealernet_contacts_cl(id) ON DELETE CASCADE,
  email           text NOT NULL,
  categoria       text NOT NULL CHECK (categoria IN ('probable', 'alternativo')),
  ranking         numeric,
  calidad         numeric,
  product_code    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, email, product_code)
);

CREATE INDEX IF NOT EXISTS idx_dealernet_emails_cl_contact
  ON dealernet_emails_cl (contact_id);
