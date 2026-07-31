-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 · Limpiar los "propietario actual/histórico" de la tabla Relacionados
-- ─────────────────────────────────────────────────────────────────────────────
-- El parser de DealerNet (`extractRelacionados`) recorría el payload ENTERO
-- del producto y tomaba como relacionado del titular cualquier nodo que
-- tuviera un campo de relación junto a un RUT o un nombre. El informe trae
-- más bloques con esa forma — la titularidad de cada dirección/predio, con
-- relación "propietario actual" / "propietario histórico" — así que la ficha
-- del dueño terminaba mezclando su familia y sus sociedades con decenas de
-- dueños de OTROS inmuebles (rol 03858-00010 de Lo Barnechea: 97
-- "relacionados" para un titular que en DealerNet tiene ~30).
--
-- El parser ya no las extrae. Esta migración borra las que quedaron guardadas,
-- porque tanto la caché compartida (dealernet_relacionados_cl, se reusa sin
-- volver a consultar) como la copia por captación (captaciones_cl.relacionados)
-- las seguirían mostrando.
--
-- Solo se tocan las filas cuya relación empieza por "propietario" (sin tilde en
-- esa primera palabra, venga "actual" o "histórico" detrás): los vínculos
-- reales (Titular, Sociedad, Socio, Cónyuge, Hijo, Padre, Hermana, Empleador,
-- ...) quedan intactos.

-- 1) Caché compartida por RUT
DELETE FROM dealernet_relacionados_cl
 WHERE relacion ~* '^\s*propietari[oa]s?\M';

-- 2) Copia por captación (jsonb)
UPDATE captaciones_cl SET relacionados = (
  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(relacionados) r
   WHERE COALESCE(r->>'relacion', '') !~* '^\s*propietari[oa]s?\M'
)
WHERE jsonb_typeof(relacionados) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(relacionados) r
     WHERE COALESCE(r->>'relacion', '') ~* '^\s*propietari[oa]s?\M'
  );
