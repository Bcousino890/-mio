-- ─────────────────────────────────────────────────────────────────────────────
-- 0073 · property_cl.ref_code: prefijo PI- en vez de BC- (evita confusión con smartbc)
-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 generó el código interno con prefijo "BC-" (BC-2607-00042). Pero smartbc
-- (el CRM de captaciones, base de datos aparte) YA usa exactamente ese patrón
-- para sus propias referencias en producción: "BC-XXXX" (properties.bc_reference,
-- migración 0011) y "PART-YYYY-NNNN" para particulares (migración 0024). Sin
-- colisión técnica (son BDs distintas), pero en pantalla los códigos se ven
-- idénticos y el equipo no puede distinguir "captación manual del CRM" de
-- "anuncio canónico scrapeado/deduplicado de Portal Inmobiliario".
--
-- Se cambia el prefijo a "PI-" (Portal Inmobiliario): mismo formato AAMM-secuencial,
-- inconfundible con los de smartbc a simple vista. Solo cambia el prefijo — se
-- preserva la fecha y el número de secuencia de cada código ya asignado.
-- ─────────────────────────────────────────────────────────────────────────────

-- Renombra el prefijo de los códigos ya asignados, preservando fecha+secuencial.
UPDATE property_cl
  SET ref_code = 'PI-' || substring(ref_code FROM 4)
  WHERE ref_code LIKE 'BC-%';

-- Nuevas propiedades: el default debe generar PI- de aquí en adelante.
ALTER TABLE property_cl
  ALTER COLUMN ref_code SET DEFAULT
    ('PI-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('property_cl_ref_seq')::text, 5, '0'));
