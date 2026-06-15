# Diseño completo de la plataforma — casafari-mio

**v1.0 · 2026-06-15** · Documento maestro de módulos. Infra: **solo VPS (Hetzner) + proxies (Geonode); sin Supabase ni Vercel.**

---

## 1. Visión y principios

Plataforma de **captación + análisis** del mercado inmobiliario (Madrid primero). Convierte el flujo de anuncios de los portales en:
- **Anuncios deduplicados** (el mismo piso en varios portales = una ficha).
- **Histórico completo** de cada anuncio (precios, cambios, bajas), aunque se retire.
- **Leads de captación** (particulares, exclusivas rotas).
- **Oportunidades de inversión** (precio/m² muy por debajo de la zona).
- **Dirección exacta bajo demanda** (RC14/RC20) por anuncio.

**Principios:**
1. **Cobertura total** — no se nos escapa ningún anuncio (scraping por zona/subzona).
2. **Sin IA en el camino principal** — regex/reglas/PostGIS; IA solo fallback.
3. **Retención total** — nunca se borra nada.
4. **Dedup por matching de anuncios**, no por catastro. RC = enriquecimiento opcional.

---

## 2. Mapa de módulos

```
[1 Ingesta/Scraping] → [2 Normalización] → [3 Dedup matching] → [4 Histórico/tracking]
                                                   │
        ┌──────────────────────────────────────────┼───────────────────────────────┐
        ▼                  ▼                        ▼                ▼                ▼
 [5 RC on-demand]   [6 Captación]          [7 Mercado]      [8 Oportunidades]   [9 AVM*]
   dirección exacta   lead flow             €/m², heatmap     inversión          *futuro
        └──────────────────────────────────┬──────────────────────────────────────────┘
                                            ▼
                              [10 API] ── [11 UI] ── [12 IA mínima] ── [13 Infra/cron/proxies]
```

---

## 3. Módulo 1 — Ingesta / Scraping (cobertura total)

**Portales:** Idealista, Fotocasa, Habitaclia, Milanuncios, pisos.com (+ webs de agencia más adelante). **Todo el mercado: particulares Y agencias.**

**El problema de cobertura:** los portales exponen ~1.800 resultados (~60 páginas) por búsqueda. Una búsqueda de "Madrid provincia" deja fuera el 90%. **Solución — recorrer por zona:**

```
para cada zona objetivo (zones.is_scrape_target):
  para cada operación (venta, alquiler):
    para cada portal:
      contar resultados de la búsqueda
      SI conteo > search_result_cap (1.800):
          subdividir → usar subzonas (barrios) de esa zona
          SI aún > cap (un barrio muy denso):
              trocear por BANDAS DE PRECIO hasta que cada tramo < cap
      paginar hasta agotar; registrar hit_result_cap en scrape_runs
```

- **Descubrimiento barato:** el listado (no la ficha) ya da precio, m², zona, foto y nuevo/retirado → el 90% de cambios se detectan sin bajar a ficha (ahorra GB de proxy).
- **Ficha completa:** solo para anuncios nuevos o que cambian, y para extraer teléfono/particular.
- **Detección de bajas:** lo que estaba y ya no aparece en la búsqueda de su zona → `gone` + `taken_down_at` (no borrar).
- **Anti-bot:** Idealista = DataDome (UA de WhatsApp + TLS de curl + cookie-jar, ya resuelto en `reference/smartbc`). Resto = HTTP directo con proxy.
- **Proxies:** Geonode residential (ES) vía env. Tracking de GB en `proxy_usage`. Reutilizar el patrón `proxyUrl` de smartbc.
- **Cola:** `scrape_jobs` (un job por zona×portal×operación), consumida con `FOR UPDATE SKIP LOCKED`.

## 4. Módulo 2 — Normalización
Mapear cada portal a un esquema único (`listings`): operación, tipo, m² (construidos vs útiles), planta, habitaciones, precio, zona→`zone_id` (taxonomía + `unaccent`), coordenadas, fotos, energía. Detector particular/profesional + teléfono (reusar de smartbc). **Cero IA**; IA solo si un campo libre no se puede parsear.

## 5. Módulo 3 — Deduplicación por matching (clave del producto)
**No usa RC. Agrupa la MISMA propiedad venga de la fuente que venga:** portales (Idealista, Fotocasa…), webs de agencia, web propia y webs externas, y particulares. Da igual el origen — si es el mismo piso, va al mismo `property`. (`listings.source_type` distingue el origen; el matcher lo ignora para agrupar.)

Señales del anuncio:
- **Blocking:** candidatos = misma operación + nº habitaciones + m² (±8%) + cercanía geográfica (≤150 m, por el círculo difuso). → `find_match_candidates()` (PostGIS).
- **Scoring 0..1:** distancia geo + Δm² + Δhabitaciones/baños + similitud de precio + **distancia de phash de fotos** (Hamming) + similitud de texto (pg_trgm) + mismo tipo.
- **Decisión:** score ≥ umbral → unir al mismo `property` (transitivo). Zona gris → `listing_match.status='candidate'` para revisión.
- Tablas: `property` (grupo deduplicado), `listings.property_id`, `listing_match` (pares + señales). Ver `0008_dedup_matching.sql`.

## 6. Módulo 4 — Histórico y tracking (de TODOS los anuncios)
- `listing_price_history` — serie temporal (snapshot por scrape).
- `listing_changes` — eventos: `price_up/down`, `reactivated`, `deleted`, `phone_added`, `photo_count_change`, etc.
- **Retención total:** retirados → `is_active=false` + `taken_down_at`; jamás se borran. Aplica a particulares Y agencias, todos los portales.

## 7. Módulo 5 — RC bajo demanda ("¿quieres la dirección exacta?")
Por anuncio, el usuario pide **RC14** (edificio → calle y número) o **RC20** (vivienda exacta). Motor:
1. PIP del punto del anuncio ∩ `cadastre_parcel` (INSPIRE en PostGIS) → RC14 candidatos.
2. Enriquecer vía Catastro (DNPRC/RCCOOR, cacheado en `cat_cache`, 1 rps).
3. Match m²/planta → RC20 + confianza. Ambigüedad → lista de candidatos.
Resultado en `listings.rc14/rc20/rc_status` + log en `rc_resolution_request`. Ver `0009`.

## 8. Módulo 6 — Captación / Lead Flow
- **Particulares activos** (`v_leads_particulares`): contacto directo, teléfono, multi-portal.
- **Exclusivas rotas** (`mv_broken_exclusives`): mismo `property` anunciado por ≥2 agencias = sin exclusiva = oportunidad de captación.
- **Señales:** particular nuevo, bajada de precio, reaparición, "particular tras agencia".
- Pipeline comercial: contactos/outcomes (reusar `particulares_contacts`).

## 9. Módulo 7 — Análisis de mercado
`mv_market_area`: €/m² mediano, stock activo, time-on-market mediano, % particulares, por zona y operación. Mapas de calor (PostGIS → GeoJSON/tiles). Absorción y descuentos.

## 10. Módulo 8 — Oportunidades de inversión ⭐ (nuevo)
`mv_opportunities` (ver `0010`): anuncios con **precio/m² ≥15% por debajo de la mediana de su zona**, ordenados por descuento. Señales extra: nº de bajadas de precio, días en mercado (motivación), particular (sin comisión). Filtros en UI por **ubicación** y **€/m²**. Es el "radar" de inversión.

## 11. Módulo 9 — Valoración AVM (futuro, Fase 2)
Comparables del mismo `property`/zona + modelo hedónico €/m² por barrio. Informe PDF. Marca claramente "precio de oferta" (sesgo al alza), no tasación oficial.

## 12. Módulo 10 — API
REST propia (Node, en el VPS): `/listings`, `/properties`, `/areas/insights`, `/opportunities`, `/leads`, `/listings/:id/exact-address`. Auth por API-key, rate-limit. Webhooks al CRM existente.

## 13. Módulo 11 — UI / pantallas
1. **Dashboard** — resumen: nuevos, bajadas, oportunidades top, stock.
2. **Anuncios** — tabla + mapa, filtros (zona, precio, €/m², operación, particular/agencia), ficha con histórico de precio y botón **"Ver dirección exacta (RC14/RC20)"**.
3. **Oportunidades** — radar de inversión, ranking por descuento, filtros ubicación/€/m².
4. **Captación (Leads)** — particulares + exclusivas rotas, contacto, pipeline.
5. **Mercado** — mapas de calor, €/m² por zona, evolución.
6. **Zonas/Scraping** — estado de cobertura por zona (señal `hit_result_cap`).

## 14. Módulo 12 — IA mínima
Solo fallback (OpenRouter, <€30/mes, gateway con kill-switch): (a) extraer m²/planta de texto libre cuando el parser falla; (b) desambiguar RC entre candidatos. Nunca en el camino principal.

## 15. Módulo 13 — Infra / cron / proxies
- **1× Hetzner CX33** (IP `204.168.174.0`, ref #123878962): Postgres+PostGIS, Redis (cola), workers de scrape, API/UI (Node), reverse proxy (Caddy). Docker Compose. Ver [`infra/deploy.md`](../infra/deploy.md). ⚠️ Más pequeño que el CX43 del plan; OK para las 5 zonas de prueba, vigilar RAM/disco al escalar.
- Cron: scrape por zona (cada X h), refresco de `mv_*` nocturno, warm-up de RC.
- Proxies: Geonode por env; `proxy_usage` para control de GB. Backups del Postgres.

---

## 16. Análisis "que no falte nada" — checklist

| # | Capacidad | ¿Cubierto? | Dónde |
|---|---|---|---|
| 1 | Scraping multi-portal (Idealista, Fotocasa, Habitaclia, Milanuncios, pisos) | ✅ Diseño | Mód.1 |
| 2 | Cobertura total por zona/subzona (tope 1.800) | ✅ | Mód.1 · `zones`, `scrape_jobs` |
| 3 | Particulares + agencias (todo el mercado) | ✅ | `listings` |
| 4 | Detección particular/profesional + teléfono | ✅ (reuso smartbc) | Mód.2 |
| 5 | **Dedup por matching de duplicados (sin RC)** | ✅ | Mód.3 · `0008` |
| 6 | Histórico de precios + cambios de TODOS los anuncios | ✅ | Mód.4 · `0005` |
| 7 | Retención de retirados (no borrar) | ✅ | `listings.taken_down_at` |
| 8 | RC14/RC20 bajo demanda (dirección exacta por anuncio) | ✅ | Mód.5 · `0009` |
| 9 | Captación: particulares + exclusivas rotas | ✅ | Mód.6 · `0007` |
| 10 | Análisis de mercado (€/m², heatmap, TOM) | ✅ | Mód.7 · `0007` |
| 11 | **Oportunidades de inversión (precio/m² bajo)** | ✅ | Mód.8 · `0010` |
| 12 | Alertas/watchlists | ⏳ Pendiente | (migración futura) |
| 13 | AVM / valoración + PDF | ⏳ Fase 2 | Mód.9 |
| 14 | API + webhooks al CRM | ✅ Diseño | Mód.10 |
| 15 | UI (dashboard, anuncios, oportunidades, leads, mercado) | 🟡 Prototipo | Mód.11 · `/prototype` |
| 16 | IA mínima con presupuesto | ✅ | Mód.12 |
| 17 | Proxies Geonode + control de GB | ✅ | `.env`, `proxy_usage` |
| 18 | Infra VPS + cron + backups | ✅ Diseño | Mód.13 |
| 19 | Geocoding de anuncios sin coordenadas | 🟡 | reuso `geocode.ts` |
| 20 | Cumplimiento RGPD (PII de particulares) | ⚠️ Legal | revisar antes de comercializar |

**Pendientes reales a planificar:** alertas/watchlists (12), AVM (13), geocoding robusto (19), y la validación legal RGPD (20). Todo lo demás está en el diseño/esquema.

---

## 17. Roadmap de construcción

- **F0 (hecho):** repo + esquema de datos (`db/migrations` 0001–0010) + diseño.
- **F1:** Postgres+PostGIS en VPS + aplicar migraciones + cargar INSPIRE de las 5 zonas. UI scaffold (Next.js, self-host) con datos mock → **URL temporal de preview**.
- **F2:** Orquestador de scraping por zona (Idealista) + normalización + import de los 2.500 legacy. Dedup matching v1.
- **F3:** Multi-portal (Fotocasa/Habitaclia/Milanuncios) + histórico + Oportunidades + Captación en UI.
- **F4:** RC bajo demanda + Mercado/heatmaps + API + alertas. AVM (Fase 2).
