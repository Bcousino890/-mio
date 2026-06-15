-- El cron de scraping (app/api/cron/particulares/scrape/route.ts) registra
-- change_type = 'phone_changed' cuando un anuncio cambia de teléfono, pero el
-- CHECK de 0024 no lo incluía: el INSERT del lote de cambios fallaba entero
-- (se perdían también los cambios de precio/fotos del mismo anuncio).
ALTER TABLE particulares_changes
  DROP CONSTRAINT IF EXISTS particulares_changes_change_type_check;

ALTER TABLE particulares_changes
  ADD CONSTRAINT particulares_changes_change_type_check
  CHECK (change_type IN (
    'price_change',
    'photo_added',
    'description_updated',
    'deleted',
    'reactivated',
    'price_up',
    'price_down',
    'photo_count_change',
    'phone_added',
    'phone_changed',
    'new_listing'
  ));
