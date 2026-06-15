# Esquema de datos — casafari-mio

Modelo de la plataforma nueva (Supabase/Postgres + PostGIS). Migraciones en
[`supabase/migrations/`](../supabase/migrations). SRID canónico: **4326 (WGS84)**.

## Mapa de capas

```
                 zones (municipio→distrito→barrio→urbanización)
                   │  dirige el scraping (is_scrape_target, idealista_slug)
                   ▼
 scrape_jobs ──▶ [WORKERS] ──▶ listings (CRUDO: 1 anuncio por portal, todo tipo)
 scrape_runs                        │  motor RC: PIP → RC14 → RC20
 proxy_usage                        ▼
                cadastre_parcel(RC14) + cadastre_unit(RC20) + cat_cache
                                    │  rc20 = clave canónica
                                    ▼
                            property (1 inmueble físico, rc20 UNIQUE)
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
 listing_price_history       listing_changes          vistas de producto
 (serie temporal)            (eventos)                v_leads_particulares
                                                      mv_broken_exclusives
                                                      mv_market_area
```

## Tablas

| Tabla | Rol | Clave |
|---|---|---|
| `zones` | Taxonomía jerárquica. Dirige el scraping para no dejarse anuncios (tope ~1.800/búsqueda de Idealista). | `idealista_slug` único |
| `cadastre_parcel` | Geometría INSPIRE por edificio. | `rc14` |
| `cadastre_unit` | Vivienda concreta (enriquecida via Catastro). | `rc20` |
| `cat_cache` | Cache de servicios Catastro (escudo rate-limit). | `cache_key` |
| `listings` | **Anuncios crudos**, todo portal y todo anunciante (particular + agencia). Nunca se borra (retención). | `(portal, external_id)` único |
| `property` | **Inmueble canónico**. Une las N apariciones del mismo piso. | `rc20` único (parcial) |
| `listing_price_history` | Serie temporal de precio/estado (append-only). | — |
| `listing_changes` | Eventos: `price_up/down`, `deleted`, `reactivated`, etc. | — |
| `scrape_jobs` / `scrape_runs` | Cola + log de cobertura (señala `hit_result_cap`). | — |
| `proxy_usage` | Consumo de GB Geonode por día/portal (control de presupuesto). | — |

## Decisiones clave

1. **RC20 = deduplicación.** Dos anuncios con el mismo `rc20` → la misma `property`. El matching difuso (trigram, `idx_listings_desc_trgm`) es solo *fallback* cuando no hay RC.
2. **`listings` guarda TODO el mercado** (no solo particulares, como hacía smartbc). Imprescindible para comparables, AVM y exclusivas rotas.
3. **Retención total.** Los anuncios retirados se marcan `is_active=false` + `taken_down_at`; jamás se borran.
4. **Geometría 4326 en todo.** La cartografía INSPIRE (origen 25830) se reproyecta en la importación (`ogr2ogr -t_srs EPSG:4326`). Sin `ST_Transform` por consulta. `listings.geom`/`property.geom` son columnas GENERADAS desde lat/lng.
5. **RLS activado** en todas las tablas; acceso desde el backend con `service_role`. Las políticas de lectura por usuario se añadirán con el modelo de auth.

## Importar los 2500 legacy

Ver [`supabase/etl/import_legacy_particulares.sql`](../supabase/etl/import_legacy_particulares.sql).
Resumen: `pg_dump` de las tablas `particulares*` del VPS viejo → `pg_restore` en
la BD nueva (no colisiona, los nombres no existen) → ejecutar el ETL (mapea a
`listings` + `listing_changes` + `listing_price_history`, preservando histórico)
→ resolver RC sobre ellos cuando el motor esté listo.

## Pendiente (siguientes migraciones)

- Motor RC: funciones de resolución (PIP, matcher RC14→RC20) — lógica en `lib/`.
- Watchlists / alertas configurables.
- AVM: tabla de comparables + modelo hedónico.
- Particionado mensual de `listing_price_history` cuando crezca.
