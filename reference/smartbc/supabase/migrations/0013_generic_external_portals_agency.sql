-- Agencia genérica "Portales externos" para pisos importados por link
-- desde Idealista / Fotocasa / Inmoweb / webs sueltas. Esos pisos no
-- vienen de una agencia colaboradora real, así que necesitan un
-- propietario común en el catálogo. El slug es estable
-- (`portales-externos`) — la UI del importador lo usa para autocompletar
-- el campo `agency_id` sin que el usuario tenga que elegir.

insert into agencies (slug, name, notes)
values (
  'portales-externos',
  'Portales externos',
  'Agencia genérica para propiedades importadas por link (Idealista, Fotocasa, Inmoweb, otros portales). Sin relación comercial específica con BC; cada anuncio mantiene su `external_id` y `source_url` para trazabilidad.'
)
on conflict (slug) do nothing;
