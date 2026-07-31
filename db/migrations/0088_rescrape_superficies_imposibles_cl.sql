-- Re-encola las fichas con una superficie imposible, para que el parser
-- corregido las vuelva a leer.
--
-- Arreglar el parser solo sirve para lo que se scrapee de aquí en adelante: las
-- filas ya guardadas se quedan con el dato malo hasta que les toque la rotación
-- de re-scrapeo, que tarda casi un día en dar la vuelta al catálogo. Y a
-- diferencia de las fotos (migración 0087), esto NO se puede arreglar
-- transformando el texto guardado: el valor bueno no está en la base, hay que
-- volver a leer la ficha.
--
-- Qué se corrige al re-leerlas (las dos verificadas contra el portal):
--   · MLC-4029240828 → el blob trae "1.505 m² totales" y "1,5 m²" (el mismo
--     dato abreviado). Al caer al valor destacado se guardaba 1 m².
--   · MLC-1958761199 → publica "Superficie total: 1 m²" junto a "Superficie
--     útil: 160 m²". La precedencia se quedaba con el 1 por venir del campo con
--     más prioridad, teniendo el dato bueno al lado.
--
-- Prioridad 100, la misma que los anuncios que aún no están en la base: son 14
-- fichas, se resuelven en menos de un minuto y hasta entonces muestran una casa
-- de 1 m². Idempotente: no encola lo que ya está pendiente o ejecutándose.

INSERT INTO pgboss.job (name, data, priority)
SELECT 'detail-cl',
       jsonb_build_object('externalId', l.external_id, 'sourceUrl', l.source_url),
       100
FROM listings_cl l
WHERE l.portal = 'portalinmobiliario'
  AND l.is_active
  AND l.source_url IS NOT NULL
  AND l.square_meters IS NOT NULL
  AND l.square_meters < 10
  AND NOT EXISTS (
    SELECT 1 FROM pgboss.job j
    WHERE j.name = 'detail-cl' AND j.state IN ('created', 'active')
      AND j.data->>'externalId' = l.external_id
  );
