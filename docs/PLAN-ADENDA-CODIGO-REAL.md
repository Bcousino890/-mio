# ADENDA AL PLAN MAESTRO — Adaptación al código real (SmartBC)

**v1.0 · 2026-06-15 · tras auditar `smartbc-main`**

Esta adenda corrige el plan maestro con lo que **realmente ya existe** en tu código, y redefine lo que falta. El plan maestro asumía Python/Scrapy/FastAPI desde cero; la realidad es **Next.js 15 + TypeScript + Supabase (Postgres self-hosted)** con scrapers en TS ya funcionando. **No se reescribe nada: se amplía.**

---

## 1. Qué YA tienes (y es bueno)

| Capacidad | Dónde | Estado |
|---|---|---|
| **Detección particular vs profesional** | `lib/sync/particulares/idealista-advertiser-detector.ts` | ✅ Producción. Usa `adProfessionalName` del HTML (vacío = particular). Salta DataDome con UA de WhatsApp + TLS de curl. |
| **Extracción de teléfono con scoring** | mismo archivo | ✅ Confianza high/medium/low, normaliza a `+34XXXXXXXXX`, descarta la referencia del anuncio como falso positivo. Fallback AJAX con cookie-jar para el botón "Ver teléfono". |
| **Tracking de cambios** | `app/api/cron/particulares/scrape/route.ts` + tabla `particulares_changes` | ✅ **YA registra:** `price_up`, `price_down`, `phone_added`, `phone_changed`, `photo_count_change`, `floor_plan_added`, `video_added`, `new_listing`, `reactivated`, `deleted`. |
| **Retención de retirados** | migración `0014` (`taken_down_at`) + `is_active` | ✅ Nunca borra. Marca `is_active=false` + `taken_down_at`. Si reaparece → `reactivated`. **Esto ya cumple "guardar todo aunque se retire".** |
| **Taxonomía de zonas de Madrid capital** | `lib/madrid-zones.ts` | ✅ 21 distritos + barrios, con normalización de zona "sucia" del scraper. |
| **Scrapers de agencias + import por link** | `lib/sync/scrapers/*`, `lib/sync/import-by-link/*` | ✅ Idealista, Fotocasa, Inmoweb, etc. + diff-engine con archivado. |
| **Watermark removal, geocoding, distancia** | `lib/sync/watermark*`, `lib/geo/geocode.ts`, `lib/distance/*` | ✅ |
| **CRM, roles, contactos con propietarios** | migraciones `0025`, `0033_particulares_contacts` | ✅ Pipeline comercial: llamada/whatsapp/visita + outcome. |
| **IA usada hoy** | — | ✅ **CERO.** Todo es regex/HTML/JSON parsing. Mantener así donde se pueda. |

**Conclusión:** "trackear subidas/bajadas/actualizaciones" y "guardar aunque se retire" **ya están hechos** para particulares. Lo que pediste como faltante en su mayoría existe — el verdadero gap es otro (abajo).

---

## 2. Los GAPS reales (lo que de verdad falta)

### 🔴 GAP 1 — Deduplicación cross-portal (el de verdad)
Hoy `particulares.external_id` es UNIQUE **por portal**. El mismo piso en Idealista + Fotocasa = **2 filas distintas**, sin vínculo. No hay clave canónica física.
→ **Solución:** motor de Referencia Catastral (RC14/RC20) del plan maestro. El RC20 es la clave que une las N apariciones del mismo inmueble. Es lo único que falta para tener "el Casafari".

### 🔴 GAP 2 — Solo se guardan PARTICULARES, no el mercado entero
El cron (`route.ts:29-31`) scrapea toda la provincia pero **descarta los profesionales**. Para análisis de mercado, comparables, AVM y **detección de exclusivas rotas** necesitas guardar TAMBIÉN los anuncios de agencia.
→ **Solución:** tabla `listings` market-wide (todos los anuncios, con `advertiser_type`), separada del catálogo propio `properties`. Los particulares siguen siendo una vista filtrada.

### 🟠 GAP 3 — Zonas: faltan municipios fuera de la capital
`madrid-zones.ts` solo cubre **Madrid capital**. Tus zonas de prueba incluyen **Pozuelo de Alarcón** y **La Moraleja** (Alcobendas) que son **municipios aparte**, no distritos. No están en la taxonomía.
→ **Solución:** extender la taxonomía a municipios del área metropolitana (nivel `municipio → distrito → barrio/urbanización`).

### 🟠 GAP 4 — El scraping por "provincia" se deja anuncios fuera
**Idealista solo expone ~60 páginas (~1.800 resultados) por búsqueda.** Una búsqueda de "madrid-provincia" con 100k+ anuncios solo te muestra los primeros 1.800. Por eso **hay que subdividir en zonas/subzonas** (y si hace falta, en bandas de precio) hasta que cada búsqueda devuelva <1.800. **Esta es la razón técnica de "que no se le escape ningún anuncio".**
→ **Solución:** orquestador que recorre zona×subzona×operación (×banda de precio si excede el tope) en vez de una sola URL de provincia.

### 🟡 GAP 5 — Histórico de precio reconstruible pero no en serie limpia
`particulares_changes` registra eventos (suficiente), pero no hay una serie temporal explícita por inmueble para análisis (mediana €/m² por barrio en el tiempo, time-on-market).
→ **Solución:** tabla `listing_price_history` (snapshot append-only por scrape) + vistas materializadas de mercado. Barato, alimenta toda la analítica.

### 🟡 GAP 6 — Sync de agencias SÍ sobrescribe (sin histórico)
`diff-engine.ts` hace UPDATE destructivo del precio en `properties` (catálogo propio). Para el catálogo propio puede bastar, pero si quieres histórico también ahí, aplicar el mismo patrón de `*_changes`.

### Otros que no se mencionaron pero faltan para "no escaparse nada"
- **AVM / valoración** (comparables por RC, informe PDF) — no existe.
- **Analítica de mercado** (mapas de calor, €/m², absorción) — no existe.
- **Alertas/watchlists** configurables por zona/precio para el equipo — parcial.
- **API tipo Lystos** para exponer datos — no existe (hoy es app interna).
- **Más portales para particulares**: hoy el cron es Idealista (la tabla admite fotocasa/kelify). Fotocasa/Habitaclia/Milanuncios para particulares aún no en el cron.
- **Proxies**: el código usa `proxyUrl` puntual; falta pool/rotación Geonode gestionado.

---

## 3. Arquitectura revisada (sobre TU stack, sin reescribir)

```
                    TU STACK ACTUAL (se conserva)            AMPLIACIÓN (lo nuevo)
   ┌─────────────────────────────────────────┐   ┌────────────────────────────────────┐
   │ Next.js 15 + TS                          │   │  MOTOR RC (TS, nuevo módulo)         │
   │  /api/cron/particulares/scrape  ◀────────┼───┤  lib/cadastre/                       │
   │  lib/sync/particulares/* (detector)      │   │   - resolve: círculo → RC14 (PostGIS)│
   │  lib/sync/scrapers/* (agencias)          │   │   - enrich: DNPRC/RCCOOR (cache)     │
   │  lib/madrid-zones.ts  ──(extender)──▶     │   │   - match: m²/planta → RC20 + score  │
   └───────────────┬──────────────────────────┘   └──────────────┬───────────────────────┘
                   │                                              │
                   ▼                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ Supabase Postgres (self-hosted) + AÑADIR EXTENSIÓN PostGIS                          │
   │  EXISTE: particulares · particulares_changes · properties · agency_feeds · ...      │
   │  NUEVO:  listings (market-wide) · property_canonical(rc20 UNIQUE) ·                 │
   │          listing_price_history · cadastre_parcel(geom) · cadastre_unit · cat_cache  │
   └──────────────────────────────────────────────────────────────────────────────────┘
                   │ vistas materializadas (pg_cron)
                   ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ PRODUCTO: Lead Flow (particular nuevo, exclusiva rota, bajada precio) · Mercado     │
   │ (€/m², heatmap, TOM) · AVM + PDF · API REST (Lystos) · alertas → CRM existente      │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

**Decisión de stack [REVISADA]:** seguir en **TypeScript/Node** para el motor RC y la API (reusa tus scrapers, detector y tipos). PostGIS se añade a tu Postgres de Supabase (es una extensión). **No Python/Scrapy** salvo que un cuello de botang lo exija — evita mantener dos ecosistemas.

---

## 4. IA: dónde SÍ y dónde NO (tu prioridad: ahorrar)

Hoy usas **cero IA** y funciona. Mantener esa filosofía:

| Tarea | ¿IA? | Cómo |
|---|---|---|
| Particular vs profesional | ❌ NO | Ya resuelto por regex (`adProfessionalName`). |
| Extracción de teléfono | ❌ NO | Ya resuelto por regex + AJAX. |
| Normalizar zona | ❌ NO | `madrid-zones.ts` + fold/match. |
| Point-in-polygon → RC14 | ❌ NO | PostGIS puro. |
| Match m²/planta → RC20 | ❌ NO (95%) | Reglas numéricas + scoring. |
| Parsear m²/planta de **texto libre** cuando no hay campo estructurado | ⚠️ SÍ (residuo ~) | Solo si regex falla. Gemini 2.5 Flash-Lite. |
| Desambiguar RC20 entre 2-4 candidatos idénticos | ⚠️ SÍ (~15%) | Elige entre candidatos que ya dio PostGIS; nunca inventa. |
| Texto del informe PDF de valoración | ⚠️ Opcional | 1 llamada corta o plantilla fija (0 IA). |

**Coste IA estimado: €2-8/mes** (muy por debajo de €30). El gateway con kill-switch del plan maestro sigue válido. **Regla: IA solo como fallback, nunca en el camino principal.**

---

## 5. Plan de arranque por zonas de prueba

Zonas pedidas y su encaje en la taxonomía:

| Zona prueba | Nivel | ¿En `madrid-zones.ts`? | URL Idealista (patrón) |
|---|---|---|---|
| **Barrio de Salamanca** | distrito (capital) | ✅ Sí | `/venta-viviendas/madrid/barrio-de-salamanca/` |
| **Almagro** | barrio (Chamberí) | ✅ Sí | `/venta-viviendas/madrid/chamberi/almagro/` |
| **Ibiza** | barrio (Retiro) | ✅ Sí | `/venta-viviendas/madrid/retiro/ibiza/` |
| **Pozuelo de Alarcón** | **municipio** | ❌ Falta | `/venta-viviendas/pozuelo-de-alarcon-madrid/` |
| **La Moraleja** | urbanización (Alcobendas) | ❌ Falta | `/venta-viviendas/alcobendas/la-moraleja/` |

**Pasos:**
1. Extender `madrid-zones.ts` → añadir nivel `municipio` con Pozuelo, Alcobendas/La Moraleja (y dejar la estructura lista para más municipios).
2. Cambiar el cron: de 1 URL de provincia → **recorrer cada zona/subzona de la lista de prueba**, venta + alquiler, paginando hasta agotar (con el tope de ~1.800 controlado por subzona).
3. Guardar **todos** los anuncios (particular + profesional) en `listings`; marcar tipo. Mantener `particulares` como hoy.
4. Validar tasa de resolución a RC20 en estas 5 zonas antes de escalar.
5. Cuando funcione → activar el resto de distritos/municipios.

---

## 6. Orden de trabajo recomendado

1. **PostGIS + carga INSPIRE** de las 5 zonas de prueba (no toda España).
2. **Tabla `listings` market-wide** + dejar de descartar profesionales.
3. **Extender zonas** (municipios) + **orquestador por zona/subzona** (resuelve GAP 3, 4, 2).
4. **Motor RC** (resolve→enrich→match) en `lib/cadastre/` (GAP 1).
5. **`property_canonical` (rc20)** + dedup cross-portal (GAP 1).
6. **`listing_price_history`** + vistas de mercado (GAP 5).
7. **Lead Flow** (exclusivas rotas usan RC20) + **AVM v1** + **API**.

Cada paso es incremental y deja el sistema funcionando.
