-- ─────────────────────────────────────────────────────────────────────────────
-- 0061 · Desbloquear los códigos SII reales de la RM (0049 vs guard IS NULL)
--        y confirmar 14 comunas nuevas identificadas por dirección exclusiva
-- ─────────────────────────────────────────────────────────────────────────────
-- Continuación directa de 0060. Auditoría completa contra producción
-- (2026-07-13, /api/chile/sii-coverage): 347 códigos con roles reales en
-- sii_roles_cl (9,66M roles) pero solo 72 resolvían vía chile_comunas —
-- 5,29M de roles (54,8%) invisibles para /api/chile/zones y el visor.
--
-- BLOQUE 1 — La misma causa raíz de 0060 a escala completa: 0022 asignó
-- guesses INE a las 56 comunas de la RM; 0049 traía los códigos reales
-- (extraídos de los nombres de archivo parquet de catastral.cl) pero su
-- guard `WHERE sii_comuna_code IS NULL OR = ''` fue no-op para todas las
-- comunas que 0022 ya había pisado. Aquí se re-aplican SIN guard los valores
-- de 0049. Casos especiales:
--   · Santiago NO se toca: el guess de 0022 (13101) resultó correcto y
--     resuelve 272k roles; el 13135 de 0049 queda pendiente de investigación
--     (posible segundo upload pericentral, ver PENDIENTES).
--   · Til Til: 0049 escribió "Tiltil", nombre que no existe en el catálogo
--     ('Til Til' con espacio, sembrado en 0020) — ni siquiera fue un no-op
--     por guard, fue un UPDATE de 0 filas.
--
-- BLOQUE 2 — Comunas RM sin entrada en 0049, identificadas ahora contra
-- producción por calles/sectores exclusivos (sii-search):
--   · La Florida  15128: "ROJAS MAGALLANES", "AV LA FLORIDA", "TOBALABA 9775"
--   · La Cisterna 16110: "FERNANDEZ ALBANO" exclusivo del código
--   · Lo Espejo   16164: "LO SIERRA" urbano (la auditoría inicial los tenía
--     invertidos; el par 16110/16164 se resolvió con estas dos calles)
--   · Peñaflor    14504: "PELVIN" exclusivo + único hueco de la secuencia
--     14501-14505 (provincia de Talagante en el orden de los parquet)
--
-- BLOQUE 3 — Fuera de la RM, verificadas una a una con sectores inequívocos:
--   · Antofagasta          2201: "HUANCHACA" (ruinas/sector) exclusivo
--   · Copiapó              3201: "PAIPOTE" + "PIEDRA COLGADA"
--   · Coquimbo             4103: "SINDEMPART" exclusivo + "GUAYACAN"
--   · Ovalle               4201: "SOTAQUI" exclusivo
--   · Curicó               7101: "RAUQUEN" dominante
--   · Talcahuano           8206: "CALETA TUMBES" + "CALETA PUERTO INGLES"
--   · Coronel              8207: "CALETA LO ROJAS" exclusivo
--   · San Pedro de la Paz  8210: "MICHAIHUE" exclusivo + "BALN LAGUNA CHICA"
--   · Ancud               10406: "PUPELDE" exclusivo
--   · Coyhaique           11401: "KM-3 TENIENTE VIDAL" (aeródromo)
--
-- PENDIENTES (documentados, NO incluidos por evidencia insuficiente):
--   · 13134 (62k roles) y 13135 (81k roles): direcciones pericentrales de
--     Santiago ("BEAUCHEFF", "REPUBLICA", "MAPOCHO") — posible doble upload
--     de Santiago Centro; investigar antes de mapear.
--   · 1101 (81k roles, Tarapacá): candidato Alto Hospicio sin confirmar.
--   · Toltén: evidencia contradictoria ("QUEULE" reparte 9213/9220).
--   · ~200 comunas rurales del catálogo siguen sin código; mecanizable con
--     una pasada scripteada código-por-código contra sii-stats.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Bloque 1 · RM: re-aplicar los códigos reales de 0049 sin el guard ──────
UPDATE chile_comunas SET sii_comuna_code = '14109' WHERE name = 'Maipú';
UPDATE chile_comunas SET sii_comuna_code = '14157' WHERE name = 'Estación Central';
UPDATE chile_comunas SET sii_comuna_code = '16401' WHERE name = 'San Bernardo';
UPDATE chile_comunas SET sii_comuna_code = '16301' WHERE name = 'Puente Alto';
UPDATE chile_comunas SET sii_comuna_code = '16106' WHERE name = 'San Miguel';
UPDATE chile_comunas SET sii_comuna_code = '13167' WHERE name = 'Independencia';
UPDATE chile_comunas SET sii_comuna_code = '13159' WHERE name = 'Recoleta';
UPDATE chile_comunas SET sii_comuna_code = '15152' WHERE name = 'Peñalolén';
UPDATE chile_comunas SET sii_comuna_code = '15151' WHERE name = 'Macul';
UPDATE chile_comunas SET sii_comuna_code = '14111' WHERE name = 'Pudahuel';
UPDATE chile_comunas SET sii_comuna_code = '14114' WHERE name = 'Quilicura';
UPDATE chile_comunas SET sii_comuna_code = '16154' WHERE name = 'La Pintana';
UPDATE chile_comunas SET sii_comuna_code = '16165' WHERE name = 'El Bosque';
UPDATE chile_comunas SET sii_comuna_code = '14158' WHERE name = 'Huechuraba';
UPDATE chile_comunas SET sii_comuna_code = '14113' WHERE name = 'Renca';
UPDATE chile_comunas SET sii_comuna_code = '14107' WHERE name = 'Quinta Normal';
UPDATE chile_comunas SET sii_comuna_code = '16163' WHERE name = 'San Joaquín';
UPDATE chile_comunas SET sii_comuna_code = '16403' WHERE name = 'Buin';
UPDATE chile_comunas SET sii_comuna_code = '14156' WHERE name = 'Cerro Navia';
UPDATE chile_comunas SET sii_comuna_code = '14127' WHERE name = 'Conchalí';
UPDATE chile_comunas SET sii_comuna_code = '16131' WHERE name = 'La Granja';
UPDATE chile_comunas SET sii_comuna_code = '16153' WHERE name = 'San Ramón';
UPDATE chile_comunas SET sii_comuna_code = '14601' WHERE name = 'Melipilla';
UPDATE chile_comunas SET sii_comuna_code = '14505' WHERE name = 'Padre Hurtado';
UPDATE chile_comunas SET sii_comuna_code = '14501' WHERE name = 'Talagante';
UPDATE chile_comunas SET sii_comuna_code = '14155' WHERE name = 'Lo Prado';
UPDATE chile_comunas SET sii_comuna_code = '14166' WHERE name = 'Cerrillos';
UPDATE chile_comunas SET sii_comuna_code = '16162' WHERE name = 'Pedro Aguirre Cerda';
UPDATE chile_comunas SET sii_comuna_code = '14202' WHERE name = 'Lampa';
UPDATE chile_comunas SET sii_comuna_code = '14603' WHERE name = 'Curacaví';
UPDATE chile_comunas SET sii_comuna_code = '14502' WHERE name = 'Isla de Maipo';
UPDATE chile_comunas SET sii_comuna_code = '14503' WHERE name = 'El Monte';
UPDATE chile_comunas SET sii_comuna_code = '14203' WHERE name = 'Til Til';
UPDATE chile_comunas SET sii_comuna_code = '16402' WHERE name = 'Calera de Tango';
UPDATE chile_comunas SET sii_comuna_code = '16404' WHERE name = 'Paine';
UPDATE chile_comunas SET sii_comuna_code = '16302' WHERE name = 'Pirque';
UPDATE chile_comunas SET sii_comuna_code = '16303' WHERE name = 'San José de Maipo';
UPDATE chile_comunas SET sii_comuna_code = '14604' WHERE name = 'San Pedro';
UPDATE chile_comunas SET sii_comuna_code = '14602' WHERE name = 'María Pinto';
UPDATE chile_comunas SET sii_comuna_code = '14605' WHERE name = 'Alhué';

-- ── Bloque 2 · RM nuevas (identificadas por calle exclusiva) ────────────────
UPDATE chile_comunas SET sii_comuna_code = '15128' WHERE name = 'La Florida';
UPDATE chile_comunas SET sii_comuna_code = '16110' WHERE name = 'La Cisterna';
UPDATE chile_comunas SET sii_comuna_code = '16164' WHERE name = 'Lo Espejo';
UPDATE chile_comunas SET sii_comuna_code = '14504' WHERE name = 'Peñaflor';

-- ── Bloque 3 · Regiones (identificadas por sector inequívoco) ───────────────
UPDATE chile_comunas SET sii_comuna_code = '2201'  WHERE name = 'Antofagasta';
UPDATE chile_comunas SET sii_comuna_code = '3201'  WHERE name = 'Copiapó';
UPDATE chile_comunas SET sii_comuna_code = '4103'  WHERE name = 'Coquimbo';
UPDATE chile_comunas SET sii_comuna_code = '4201'  WHERE name = 'Ovalle';
UPDATE chile_comunas SET sii_comuna_code = '7101'  WHERE name = 'Curicó';
UPDATE chile_comunas SET sii_comuna_code = '8206'  WHERE name = 'Talcahuano';
UPDATE chile_comunas SET sii_comuna_code = '8207'  WHERE name = 'Coronel';
UPDATE chile_comunas SET sii_comuna_code = '8210'  WHERE name = 'San Pedro de la Paz';
UPDATE chile_comunas SET sii_comuna_code = '10406' WHERE name = 'Ancud';
UPDATE chile_comunas SET sii_comuna_code = '11401' WHERE name = 'Coyhaique';
