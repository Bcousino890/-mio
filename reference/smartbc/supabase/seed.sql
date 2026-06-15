-- ============================================================
-- SmartBC · Seed inicial (catálogo de tags + agencias ejemplo)
-- ============================================================
-- Aplicar DESPUÉS de 0001_init.sql.
-- Idempotente: usa "on conflict do nothing".
-- ============================================================

-- Catálogo de tags (la pieza central que el admin asigna a clientes)
insert into client_tags (name, category, color) values
  ('Estudiante', 'profile', '#A78BFA'),
  ('Trabajador', 'profile', '#60A5FA'),
  ('Empresa', 'profile', '#34D399'),
  ('Familia', 'profile', '#F59E0B'),
  ('Inversor', 'profile', '#EF4444'),
  ('Corta estancia', 'stay_type', '#06B6D4'),
  ('Larga estancia', 'stay_type', '#8B5CF6'),
  ('Premium', 'budget', '#D4AF37'),
  ('Lujo', 'budget', '#B91C1C'),
  ('VIP', 'priority', '#000000')
on conflict (name) do nothing;

-- Agencias colaboradoras reales — añadir según vayas confirmando acuerdos.
-- (Hasta hoy: solo Level Real Estate confirmada oficialmente.)
insert into agencies (name, slug, website, contact_name, contact_email, contact_phone)
values (
  'Level Real Estate',
  'level',
  'https://levelrealestate.es',
  'Carmen Braojos',
  'carmen@levelrealestate.es',
  '+34 619 66 65 67'
)
on conflict (slug) do update
  set name = excluded.name,
      contact_name = excluded.contact_name,
      contact_email = excluded.contact_email,
      contact_phone = excluded.contact_phone,
      website = excluded.website;

-- Condiciones reales con Level: 50% de nuestra comisión en alquiler (desde
-- 3.000 €/mes) y 50% de la comisión acordada con el vendedor en venta
-- (acordada por defecto 4% → efectiva 2%). Editable desde el panel.
insert into agency_partnerships (
  agency_id,
  commission_pct,
  rent_commission_pct,
  sale_commission_pct,
  sale_agreed_commission_pct,
  rent_commission_min_price,
  sale_commission_min_price,
  agreement_signed_at,
  watermark_required,
  attribution_visible
)
select
  a.id,
  50,                 -- legacy
  50,                 -- alquiler efectivo
  2,                  -- venta efectiva (4% acordada / 2)
  4,                  -- venta acordada
  3000,               -- alquiler desde 3.000 €/mes
  0,                  -- venta sin umbral mínimo
  date '2022-01-01',
  true,
  false
from agencies a
where a.slug = 'level'
on conflict (agency_id) do update
  set rent_commission_pct = excluded.rent_commission_pct,
      sale_commission_pct = excluded.sale_commission_pct,
      sale_agreed_commission_pct = excluded.sale_agreed_commission_pct,
      rent_commission_min_price = excluded.rent_commission_min_price,
      sale_commission_min_price = excluded.sale_commission_min_price,
      agreement_signed_at = excluded.agreement_signed_at;

-- App settings iniciales
insert into app_settings (key, value) values
  ('personal_shopper_terms_version', '"1.0"'::jsonb),
  ('default_sync_frequency_hours', '6'::jsonb)
on conflict (key) do nothing;
