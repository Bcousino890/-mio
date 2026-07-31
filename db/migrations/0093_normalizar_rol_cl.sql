-- ─────────────────────────────────────────────────────────────────────────────
-- 0093 · Un solo formato de Rol de Avalúo en toda la base
-- ─────────────────────────────────────────────────────────────────────────────
-- El rol chileno "manzana-predio" se guardaba en DOS formatos según el camino
-- que lo hubiera confirmado:
--
--   · SIN ceros a la izquierda — "3810-21" — cuando venía del match contra
--     `sii_roles_cl` (matchRol, selectRolManual, verificación visual). Es el
--     formato de `sii_roles_cl.rol` y el que documenta 0047 para
--     `captaciones_cl.sii_rol` ("manzana-predio, ej. 795-198").
--   · CON ceros — "03810-00021" — cuando venía del catastro GRÁFICO
--     (`cadastre_parcels_cl.rol`), que es de donde sale el rol al soltar el pin
--     real sobre el predio en la ficha del inmueble.
--
-- Convivir con los dos rompía cosas que comparan el rol literalmente:
--
--   1. La ficha no reconocía su propia captación (`findCrmCaptacionByRol`):
--      decía "aún no está en el CRM" y volvía a captar el mismo inmueble por
--      duplicado.
--   2. La dirección exacta del SII no aparecía nunca para los roles fijados por
--      pin: se buscaba en `sii_roles_cl` con el rol con padding y no hay fila.
--   3. La caché de certificados TGR fallaba SIEMPRE para esos roles. El scraper
--      masivo construye su clave desde `sii_roles_cl`
--      (`scraper/tgr/run-tgr.sh`: `r.sii_comuna_code || '-' || r.rol`), o sea
--      sin padding; una captación por pin pedía "13114-03810-00021" y no
--      encontraba el "13114-3810-21" que ya estaba descargado. Cada una de esas
--      consultas levanta Chromium contra un sitio con historial de bloqueo WAF.
--   4. El backfill de enlaces ficha↔captación de la 0083 (`cap.sii_rol =
--      p.rol_matriz`) se saltó todos los pares de formato distinto.
--
-- Esta migración deja el formato SIN ceros a la izquierda —el de `sii_roles_cl`,
-- el documentado en 0047 y el que ya usan los endpoints del catastro vía
-- `normalizeClRol()`— y rehace los enlaces que se habían perdido.
--
-- Idempotente: normalizar algo ya normalizado no lo cambia.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Quita los ceros a la izquierda de cada tramo de un rol "manzana-predio".
-- Solo actúa sobre roles puramente numéricos: cualquier otra forma (un
-- `rol_padre` "comuna-manzana-predio", un texto libre) se devuelve intacta, que
-- es exactamente lo que hace normalizeClRol() en el código.
CREATE OR REPLACE FUNCTION normalizar_rol_cl(rol text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN rol IS NULL THEN NULL
    WHEN btrim(rol) ~ '^\d+-\d+$'
      THEN regexp_replace(btrim(rol), '(^|-)0+(\d)', '\1\2', 'g')
    ELSE rol
  END
$$;

COMMENT ON FUNCTION normalizar_rol_cl(text) IS
  'Rol de avalúo "manzana-predio" sin ceros a la izquierda (formato de sii_roles_cl.rol). Espejo SQL de normalizeClRol() en web/lib/rol-format.ts.';

-- ── 1. Captaciones ──────────────────────────────────────────────────────────
UPDATE captaciones_cl
   SET sii_rol = normalizar_rol_cl(sii_rol),
       updated_at = now()
 WHERE sii_rol IS NOT NULL
   AND sii_rol IS DISTINCT FROM normalizar_rol_cl(sii_rol);

-- ── 2. Ficha canónica del inmueble ──────────────────────────────────────────
UPDATE property_cl
   SET rol_matriz = normalizar_rol_cl(rol_matriz),
       updated_at = now()
 WHERE rol_matriz IS NOT NULL
   AND rol_matriz IS DISTINCT FROM normalizar_rol_cl(rol_matriz);

-- ── 3. Anuncios (el rol que les copia syncListingIdentity) ──────────────────
UPDATE listings_cl
   SET rol_matriz_candidate = normalizar_rol_cl(rol_matriz_candidate),
       updated_at = now()
 WHERE rol_matriz_candidate IS NOT NULL
   AND rol_matriz_candidate IS DISTINCT FROM normalizar_rol_cl(rol_matriz_candidate);

-- ── 4. Contactos DealerNet (trazabilidad de qué rol originó la consulta) ────
UPDATE dealernet_contacts_cl
   SET sii_rol = normalizar_rol_cl(sii_rol)
 WHERE sii_rol IS NOT NULL
   AND sii_rol IS DISTINCT FROM normalizar_rol_cl(sii_rol);

-- ── 5. Certificados TGR ─────────────────────────────────────────────────────
-- Aquí la clave es "comuna-manzana-predio" y tiene UNIQUE, así que hay dos
-- cuidados:
--   · El código de comuna NO se toca: hay comunas cuyo código empieza por cero
--     (05101 Valparaíso), y quitárselo inventaría una comuna distinta. Se
--     normaliza solo lo que va DESPUÉS del primer guion.
--   · Normalizar puede hacer que dos filas colisionen (la que bajó el scraper
--     masivo y la que pidió una captación por pin). Se conserva la que de
--     verdad sirve —certificado exitoso, con nombre, más reciente— y se borran
--     las demás; su detalle se va en cascada (FK ON DELETE CASCADE).
WITH normalizados AS (
  SELECT id,
         rol,
         split_part(rol, '-', 1) || '-' ||
           normalizar_rol_cl(substring(rol from position('-' in rol) + 1)) AS rol_norm
    FROM tgr_certificados
   WHERE position('-' in rol) > 0
),
ranking AS (
  SELECT id,
         rol_norm,
         row_number() OVER (
           PARTITION BY rol_norm
           ORDER BY (estado IN ('exitosa','sin_deuda')) DESC,
                    (nombre IS NOT NULL) DESC,
                    fecha_consulta DESC
         ) AS puesto
    FROM normalizados n
    JOIN tgr_certificados t USING (id)
)
DELETE FROM tgr_certificados t
 USING ranking r
 WHERE t.id = r.id AND r.puesto > 1;

UPDATE tgr_certificados t
   SET rol = split_part(t.rol, '-', 1) || '-' ||
             normalizar_rol_cl(substring(t.rol from position('-' in t.rol) + 1)),
       updated_at = now()
 WHERE position('-' in t.rol) > 0
   AND t.rol IS DISTINCT FROM (
     split_part(t.rol, '-', 1) || '-' ||
     normalizar_rol_cl(substring(t.rol from position('-' in t.rol) + 1))
   );

-- ── 6. Enlaces ficha ↔ captación que la 0083 no pudo hacer ──────────────────
-- Mismo criterio que findCrmCaptacionByRol: la captación más completa del rol.
-- Ahora que los dos lados hablan el mismo formato, los pares que se habían
-- quedado fuera se enlazan y las fichas recuperan su etiqueta "captada".
UPDATE property_cl p
   SET captacion_id = (
     SELECT cap.id
       FROM captaciones_cl cap
       JOIN chile_comunas c ON c.id = p.comuna_id
      WHERE cap.sii_rol = p.rol_matriz
        AND cap.sii_comuna_code = c.sii_comuna_code
      ORDER BY (cap.owner_name IS NOT NULL) DESC,
               (cap.phones IS NOT NULL) DESC,
               cap.updated_at DESC
      LIMIT 1
   ),
   updated_at = now()
 WHERE p.captacion_id IS NULL
   AND p.rol_matriz IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM captaciones_cl cap
       JOIN chile_comunas c ON c.id = p.comuna_id
      WHERE cap.sii_rol = p.rol_matriz
        AND cap.sii_comuna_code = c.sii_comuna_code
   );

COMMIT;
