-- ─────────────────────────────────────────────────────────────────────────────
-- 0059 · cbr_indice_cl — Índice de Propiedad del CBR (foja/número/año, SIN precio)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fuente: el "Índice de Propiedad" público de los Conservadores de Bienes Raíces
-- (conservadoresdigitales.cl y portales por jurisdicción). Búsqueda por
-- comuna/nombre/año → devuelve FOJA, NÚMERO y AÑO de la inscripción, y a veces la
-- fecha y el tipo de acto. NO trae el MONTO de la operación.
--
-- Por eso vive en tabla SEPARADA de sii_transacciones_cl (que sí es para precios),
-- con el mismo criterio con que sii_mapasui_predios_cl se separó de sii_roles_cl:
-- procedencia distinta (scraping best-effort, cada CBR varía, algunos con
-- captcha/límites) → no mezclar con datos de precio ni redistribuir.
--
-- Uso previsto: enriquecer foja_numero_anio / cbr_nombre de una compraventa real
-- cuando calce por rol, y como capa informativa "historial registral" en la ficha.

CREATE TABLE IF NOT EXISTS cbr_indice_cl (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sii_comuna_code   text NOT NULL,
  -- rol puede ser null: el índice se busca por nombre del titular, no por rol,
  -- así que la vinculación a un rol es posterior (por dirección/nombre).
  rol               text,
  nombre_titular    text,
  foja              text,
  numero            text,
  anio              integer,
  fecha_inscripcion date,
  tipo_acto         text,                       -- ej. "Compraventa", "Herencia"
  cbr_nombre        text,                       -- ej. "CBR Santiago"
  raw_source        text,                       -- portal/jurisdicción de origen
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- foja+número+año identifica una inscripción dentro de un CBR; evita duplicar
-- la misma inscripción en reprocesos del scraper.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cbr_indice_cl_inscripcion
  ON cbr_indice_cl(cbr_nombre, foja, numero, anio)
  WHERE foja IS NOT NULL AND numero IS NOT NULL AND anio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cbr_indice_cl_rol
  ON cbr_indice_cl(sii_comuna_code, rol) WHERE rol IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cbr_indice_cl_titular
  ON cbr_indice_cl(nombre_titular);
