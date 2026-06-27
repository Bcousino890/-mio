-- ─────────────────────────────────────────────────────────────────────────────
-- 0045 · Certificados de deuda TGR (Tesorería General de la República, Chile)
-- ─────────────────────────────────────────────────────────────────────────────
-- Espejo en Postgres del esquema SQLite que ya usa scraper/tgr/tgr_scraper.py
-- en el VPS (tablas `certificados`/`certificado_detalle`). El scraper sigue
-- escribiendo también en su SQLite local (no se toca esa lógica); esta tabla
-- es el destino de producción que alimenta la página /chile/tgr-dueno del CRM.

CREATE TABLE IF NOT EXISTS tgr_certificados (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol                         text NOT NULL UNIQUE,  -- "CCC-NNNNN-SSS" (comuna TGR-numero-subrol)
  comuna                      text NOT NULL,
  nombre                      text,
  direccion                   text,
  total_deuda_no_vencida      numeric,
  total_deuda_morosa          numeric,
  total_acogido_art_196_197   numeric,
  tiene_deuda                 boolean,
  fecha_emision_certificado   text,
  liquidada_al                text,
  emitido_a_las                text,
  codigo_verificacion         text,
  estado                      text NOT NULL DEFAULT 'pendiente', -- pendiente|exitosa|sin_deuda|error|bloqueado
  intentos                    integer NOT NULL DEFAULT 0,
  error                       text,
  fecha_consulta              timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tgr_certificados_comuna ON tgr_certificados(comuna);
CREATE INDEX IF NOT EXISTS idx_tgr_certificados_estado ON tgr_certificados(estado);

CREATE TABLE IF NOT EXISTS tgr_certificado_detalle (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificado_id  uuid NOT NULL REFERENCES tgr_certificados(id) ON DELETE CASCADE,
  tipo_deuda      text,
  formulario      text,
  tipo            text,
  folio           text,
  fecha_vcto      text,
  deuda_neta      numeric,
  reajuste        numeric,
  interes         numeric,
  multa           numeric,
  total           numeric
);

CREATE INDEX IF NOT EXISTS idx_tgr_certificado_detalle_cert ON tgr_certificado_detalle(certificado_id);
