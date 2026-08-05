# Plan — Localizador de Propiedades con IA (Chile)

**v1.4 · 2026-08-05** · Estado: aprobado, pendiente de implementación
*(v1.1: aprendizaje continuo, límite Open Buildings, Dedup 2.0, departamentos · v1.2: números reales, pestaña "Entrenar", aprendizaje desde uniones manuales · v1.3: cuadro maestro con modelo y esfuerzo, F0 "bases sólidas" · v1.4: §10 Orquestación — 4 puestos paralelos con cuentas de Claude, propiedad exclusiva de archivos, contratos congelados y orden de integración)*

Anuncio de Portal Inmobiliario → propiedad exacta → **ROL SII**, al estilo Lystos (ES) / PropertyRadar (US), con presupuesto mínimo.

---

## 1. Problema y objetivo

Hoy el matching anuncio→ROL es manual y se apoya casi solo en distancia y m²: el pin del portal viene difuminado o corrido hasta 1-2 km y el resultado tiene muchos errores. Objetivo: localizador **automático** para **toda la RM** con >90% de acierto medible, usando Computer Vision, OCR, NLP, geocodificación, deduplicación, embeddings, matching probabilístico y un grafo de señales por propiedad.

**Restricciones acordadas:**
- Catastro: SOLO lo ya cargado (`sii_roles_cl` ~9,6M roles; `cadastre_parcels_cl` con polígonos en Las Condes 15108, Vitacura 15160, Lo Barnechea 15161, Colina 14201). Datos abiertos NO catastrales sí permitidos (aprobado: Google Open Buildings).
- Presupuesto APIs: hasta $50/mes. El diseño cuesta **<$1 por 1.000 anuncios** (≈$5/mes al volumen actual).
- **Nada de entrenar modelos propios en el MVP** — el embudo con APIs baratas/gratis lo cubre.

## 2. Cómo lo hacen Lystos/PropertyRadar (y por qué esto funciona)

No existe un "modelo mágico": es un **embudo de candidatos + señales múltiples + scoring**. Base parcelaria indexada → filtros baratos (zona, superficie, texto) reducen a decenas de candidatos → señales caras (visión) solo para desempatar → umbral de auto-confirmación + revisión humana del residuo. La deduplicación es un multiplicador: varios anuncios de la misma propiedad (corredoras distintas) = más fotos, más pistas de texto y **varios pins difuminados que triangulan**.

Todo eso ya tiene cimientos en este repo:

| Pieza existente | Dónde | Qué hace |
|---|---|---|
| Candidatos SII por radios [100→2500 m] + trigram dirección + superficie | `web/lib/captar-pipeline.ts` (`findSiiCandidatesV3`) | El generador de candidatos |
| Scoring log-odds con auto-confirm ≥0.92 + margen | `web/lib/sii-match-cl-v2.ts` (`scoreCandidateV3`, `decideMatch`) | El matcher probabilístico |
| Fotos del anuncio vs tile satelital con VLM | `web/lib/visual-match-cl.ts` (gemini-2.5-flash-lite, temperature 0) | La visión comparativa (hoy solo manual) |
| Dedup 3 niveles → clúster canónico | `scraper/lib/{dedup-cl,score-pair-cl,clustering-cl}.mjs` → `property_cl` | El multiplicador de evidencia |
| Geocoding Nominatim 1 req/s | `scraper/lib/geocode-cl.mjs` | Gratis |
| pHash + storage dedupeado de fotos | `scraper/lib/media-sync-cl.mjs`, `media_assets_cl` | La base del cache por foto |

**El hueco que cierra este plan**: `property_cl.rol_matriz`/`rol_confidence` existen y están **vacíos** (era la "Fase 7/H11" de `PLAN-ANUNCIOS-CL.md`). El pipeline nuevo vive en `web/lib` (TypeScript, donde está todo lo reutilizable); el worker lo dispara por HTTP — precedente exacto: `scraper/process-uploads.mjs` → `POST /api/admin/process-uploads-worker`.

Última migración actual: `0099` → las nuevas empiezan en `0100`.

---

## 3. Arquitectura: el embudo

```
Clúster property_cl (1..N anuncios de la misma propiedad)
 │
 ├─ F1 FUSIÓN DE EVIDENCIA (gratis): pins por corredora → triangulación,
 │    mejor dirección, física consensuada (medianas/modas), fotos dedupeadas
 ├─ F2 NLP texto (LLM barato): calle, nº, condominio, hitos, orientación, rol mencionado
 ├─ F3 VISIÓN fotos (VLM, cache por foto): piscina+forma, pisos, techo, estilo,
 │    número de casa (OCR), cerros, quincho, paneles
 ├─ F4 HUELLA DE TECHO (Open Buildings, gratis): área/forma/orientación por parcela
 │
 ├─ CANDIDATOS: findSiiCandidatesV3 (radios + trigram + filtros físicos SII)
 ├─ RANKING: scoreCandidateV3 + señales nuevas (footprint, atributos visuales, pistas)
 ├─ F5 DESEMPATE top-2 cercanos: visual-match fotos↔satélite (ya existe)
 │
 ├─ ≥0.92 + margen → AUTO-CONFIRMADO → property_cl.rol_matriz → SmartBC (address_real)
 └─ resto → cola de revisión humana (/chile/localizador) → dataset etiquetado
```

Principio de costes: **señales gratis primero, visión al final, todo cacheado** (`ai_cache_cl` por hash de contenido — una foto republicada por 3 corredoras se paga al VLM una sola vez).

---

## 4. Fases

### Cuadro maestro — orden de ejecución, modelo por tarea y esfuerzo

| Orden | Fase | Qué entrega | Modelo que lo ejecuta en producción | Esfuerzo dev | Depende de |
|---|---|---|---|---|---|
| 1º | **F0 Bases sólidas** | Nada roto: pHash encendido, S3 verificado, tests | Ninguno (dHash con `sharp`, determinista) | **S** (1-2 días) | — |
| 2º | **F1 Localizador determinista** | `rol_matriz` automático por clúster, RM completa | Ninguno (SQL/PostGIS + log-odds) | **L** (3-5 días) | F0 |
| 3º | **F7a+b Etiquetas + pestaña Entrenar** | Corpus de entrenamiento creciendo desde el día 1 | Ninguno (UI + SQL) | **M** (3-4 días) | F1 |
| 4º | **F2 NLP de texto** | Calle/nº/condominio/hitos desde descripciones | `qwen3-8b` (AI_MODEL_CHEAP), temperature 0 | **M** (2-3 días) | F1 |
| 5º | **F3 Visión + OCR de fotos** | Piscina/techo/estilo/nº de casa por anuncio, cacheado | `gemini-2.5-flash-lite` (AI_MODEL_WORKHORSE) | **M** (2-3 días) | F1, cache |
| 6º | **F4 Huellas de techo** | Footprint por parcela (área/forma/orientación) | Ninguno (PostGIS + Open Buildings) | **M** (2-3 días) | F1 |
| 7º | **F5 Desempate visual + cola revisión** | Foto↔satélite en empates; UI de revisión | `gemini-2.5-flash-lite` | **L** (3-4 días) | F2-F4 |
| 8º | **F7c Calibración continua** | Pesos aprendidos de tus decisiones (cron semanal) | Regresión logística local (CPU, sin API) | **M** (2-3 días) | F7a+b, >300 etiquetas |
| 9º | **F8 Dedup 2.0** | Señales nuevas de par (ROL, OCR, NLP, visual) | Reutiliza cache de F2/F3 (coste $0) | **M** (2-3 días) | F2, F3, F5 |
| 10º | **F6 Embeddings pgvector** | Near-dups que el pHash pierde; fachada↔Street View | SigLIP/CLIP por lotes nocturnos (CPU VPS) | **M** (2-3 días) | corpus >1.500 |
| 11º | **F9 Departamentos** | >95% a nivel edificio + lista corta de unidades | Los mismos de F2/F3/F5 | **L** (4-5 días) | F1-F5 estables |

Esfuerzo: S = pequeño, M = medio, L = grande (días de desarrollo con Claude). **Regla transversal de calidad**: cada fase entrega con (a) su test `.test.mjs`/unitario con deps inyectadas — patrón ya usado en el repo —, (b) migraciones idempotentes (`IF NOT EXISTS`, re-ejecutables), (c) su gate de precisión medido con `eval-locator-cl.mjs` antes de pasar a la siguiente, y (d) sin tocar decisiones humanas existentes (`decided_by='human'` y `manual_property_lock` siempre se respetan — mismo principio que ya rige el dedup).

### Desarrollo con Claude — qué modelo desarrolla cada fase y con qué esfuerzo

Criterio: **Sonnet 5** para trabajo con patrón claro a seguir (rápido y barato); **Opus 5** para integración con lógica existente delicada; **Fable 5 con esfuerzo alto** solo donde un error cuesta caro (scoring, calibración, merges — un peso mal puesto une propiedades que no son la misma o confirma ROLes equivocados). Regla fija: **`/code-review` antes de cada push** en las fases marcadas 🔴.

| Fase | Qué se programa | Modelo de desarrollo | Esfuerzo de razonamiento | Riesgo |
|---|---|---|---|---|
| F0 Bases sólidas | Fix upsert, backfill pHash, tests S3 | Sonnet 5 | Medio | 🟢 patrón existente |
| F1 Localizador | `property-locator-cl.ts`: fusión de evidencia, integración con `captar-pipeline`/`decideMatch`, propagación a `property_cl` | **Fable 5** | **Alto** | 🔴 corazón del sistema; escribe ROLes |
| F7a Semilla etiquetas | Migración 0104 + `seed-locator-labels-cl.mjs` | Sonnet 5 | Medio | 🟢 ETL directo |
| F7b Pestaña Entrenar | UI + endpoint + selección active learning | Sonnet 5 (UI) / Opus 5 (selección de casos) | Medio | 🟡 UX simple, query de duda con criterio |
| F2 NLP texto | Prompt + parser + inyección en candidatos | Opus 5 | Medio | 🟡 un prompt malo mete direcciones falsas |
| F3 Visión+OCR | Prompt VLM + cache + agregación anti-alucinación | Opus 5 | Medio | 🟡 ídem; la agregación acota el daño |
| F4 Footprints | Ingesta streaming (Sonnet) + señal `footprintEvidence` en scoring (Fable) | Sonnet 5 / **Fable 5** | Medio / **Alto** | 🔴 la señal toca el scoring |
| F5 Desempate+cola | UI revisión (Sonnet) + re-score con `visual_score` (Fable) | Sonnet 5 / **Fable 5** | Medio / **Alto** | 🔴 re-score decide confirmaciones |
| F7c Calibración | Regresión logística + reporte de pesos | **Fable 5** | **Alto** | 🔴 matemática que gobierna todo |
| F8 Dedup 2.0 | Señales de par nuevas + guardarraíles | **Fable 5** | **Alto** | 🔴 falsos merges = fichas contaminadas |
| F6 Embeddings | Batch SigLIP + pgvector + búsqueda | Sonnet 5 | Medio | 🟢 aislado, no decide nada solo |
| F9 Departamentos | Generador de candidatos edificio/unidad (Fable) + UI (Sonnet) | **Fable 5** / Sonnet 5 | **Alto** / Medio | 🔴 lógica nueva de matching |

En producción **ningún paso usa modelos caros**: el más costoso es flash-lite. El gasto en modelos de desarrollo se concentra una sola vez en las 6 piezas 🔴; todo lo demás es Sonnet.

### Fase 0 — Bases sólidas: nada roto antes de construir encima (sin migración)

`scraper/lib/upsert-listing-cl.mjs:196-239` no escribe `cover_phash`/`photo_phashes` (columnas de `0028`), por lo que la señal `photos_match: 0.50` del dedup (`score-pair-cl.mjs:114`) llega siempre vacía y la triangulación por pHash de `identity-resolution-cl.mjs` no aporta.

- Modificar `scraper/lib/media-sync-cl.mjs`: su UPDATE final ya tiene los pHash calculados en `storedPhotos` — añadir `cover_phash`/`photo_phashes` sin pisar valores ya poblados.
- Nuevo `scraper/lib/phash-backfill-cl.mjs` (fallback si `HETZNER_S3_*` no está configurado — hoy `worker-cl.mjs:390` deshabilita media-sync sin credenciales): lotes de ~50 listings activos con `photo_phashes = '{}'`, máx 12 fotos c/u con `calculatePhashBatch()` de `phash.mjs`, escribe hashes y descarta buffers (cero almacenamiento). + test `.test.mjs` con deps inyectadas.
- Registrar en `worker-cl.mjs`: cola `phash-backfill-cl`, cron `*/20 * * * *` (patrón `dedup-cluster-cl`).

**Además, saneamiento de la base (todo lo detectado como roto o nunca probado):**
- **Credenciales `HETZNER_S3_*` en el VPS** (acción del usuario, guiada): sin ellas `media-sync-cl` está deshabilitado y las fotos quedan solo como URLs — el cache por `content_hash` de F3 y los embeddings de F6 las necesitan persistidas.
- **`hetzner-s3.mjs` probado contra el bucket real** (la capa de I/O nunca se validó, solo con cliente simulado): subir/leer/borrar un objeto de prueba y verificar dedup por `content_hash` end-to-end.
- **Verificación de `listing_match_cl`**: confirmar con datos reales que la señal `photos_match` empieza a llegar poblada tras el fix (query de control en `/chile/anuncios-health`).
- Smoke test de los cimientos que el plan reutiliza: `normalizar_rol_cl()` (formatos con/sin ceros), `resolveRolAtPoint()` en las 4 comunas con polígonos, y `findSiiCandidatesV3()` con un anuncio conocido.

**Valor propio**: el dedup fusiona anuncios cross-corredora por foto → clústeres más ricos para todas las fases siguientes, y ninguna fase posterior se construye sobre algo roto.
**Verificación**: >90% de listings activos con phashes en 1 semana; delta de merges de `property_cl`; muestra manual de 20 pares nuevos; media-sync subiendo fotos reales al bucket.

### Fase 1 — Localizador determinista a nivel clúster (cierra H11, coste $0)

**Migración `0100_property_locator_cl.sql`:**

```sql
CREATE TABLE property_locator_cl (
  property_cl_id uuid PRIMARY KEY REFERENCES property_cl(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN
    ('pending','clues','candidates','auto_confirmed','needs_review','no_match','error')),
  evidence jsonb NOT NULL DEFAULT '{}',  -- grafo de señales: pins, dispersión, pistas, atributos
  candidates jsonb,                       -- top-N con señales V3 (auditable en UI)
  best_rol text, best_probability numeric, decision_reason text,
  nlp_done boolean DEFAULT false, vlm_done boolean DEFAULT false,
  visual_tiebreak_done boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_property_locator_cl_status ON property_locator_cl(status);
ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS rol_match_method text,
  ADD COLUMN IF NOT EXISTS rol_matched_at timestamptz;
```

**Nuevo `web/lib/property-locator-cl.ts`** (núcleo):
- `buildClusterEvidence(propertyClId)`:
  - **Pins**: uno por corredora (mediana si tiene varios anuncios); centroide = mediana geométrica; `pin_dispersion_m` = distancia máx. entre corredoras. `manual_latitude/longitude` manda (dispersión 0). <150 m ⇒ pin confiable; >800 m ⇒ difuminado, pesa más dirección/física.
  - **Dirección**: `exact_address` si existe; si no, la más larga con número entre los miembros → `address_full` (activa el camino log-odds 4.2 de `addressEvidence`).
  - **Física**: mediana `sqm_terreno`/`sqm_construida`, moda dorms/baños, `floors`, piscina/condominio/orientación por regex sobre `features`+`description`.
  - **Fotos**: unión dedupeada por pHash/`content_hash`.
- `locateProperty(propertyClId)`: evidence → `findSiiCandidatesV3()` → `decideMatch()` (umbrales existentes). Auto-confirmado ⇒ `property_cl.rol_matriz = normalizar_rol_cl(...)`, `rol_confidence`, `location_confidence='confirmed'`, `exact_address` = dirección SII, `rol_match_method='locator_v1'`; propaga a los `listings_cl` miembros sin pisar confirmaciones mayores. **SmartBC se beneficia sin cambios** (`address_real` ya viaja desde la dirección SII).

**Nuevo `web/app/api/chile/property-locator/route.ts`**: `POST {limit}` — clústeres pendientes priorizando `listing_count DESC, corredora_count DESC` (más evidencia primero). Auth por token interno.
**Nuevo `scraper/lib/locator-feeder-cl.mjs`** + cola `locator-feeder-cl` cron `37 * * * *` en `worker-cl.mjs` → `fetch(APP_URL + '/api/chile/property-locator')`.
**Nuevo `scraper/eval-locator-cl.mjs`**: evaluación contra el gold set que ya existe — captaciones con `sii_rol` confirmado (link `0083`) y clústeres con pin manual (`resolveRolAtPoint(manual_lat,lng)` = rol esperado). Precisión/cobertura por comuna; se re-corre en cada fase.

**Cobertura RM completa**: el matcher opera en toda la RM desde el día 1 — por radios donde hay coordenadas, por dirección trigram donde no. Calibración inicial en las 4 comunas con polígonos; en paralelo, geocoding del stock SII comuna a comuna (infra existente `geocode-roles/start-all` + Nominatim) priorizando comunas activas en `scrape_targets_cl`.

**Gate de fase: precisión de auto_confirmed ≥95%** en el gold set, o se suben umbrales antes de avanzar.

### Fase 2 — Pistas de texto con LLM barato + geocoding de pistas

**Migración `0101_ai_cache_cl.sql`:**

```sql
CREATE TABLE ai_cache_cl (
  kind text NOT NULL,        -- 'text_clues' | 'photo_attrs' | 'geocode_clue'
  cache_key text NOT NULL,   -- sha256(texto+versión prompt) o content_hash de foto
  model text, result jsonb NOT NULL,
  prompt_tokens int, completion_tokens int, cost_usd numeric,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (kind, cache_key)
);
```

**Nuevo `web/lib/text-clues-cl.ts`**: 1 llamada por clúster (títulos+descripciones+features, ~6k chars) a `AI_MODEL_CHEAP` (qwen3-8b), temperature 0, cacheada. Prompt (esbozo):

> "Extrae SOLO datos explícitos del texto de estos anuncios inmobiliarios chilenos (misma propiedad). JSON: `{calle, numero, condominio, esquina_con, hitos:[{nombre, relacion}], sector, orientacion, pisos, piscina, rol_sii_mencionado, confianza:0-1}`. Si un dato no aparece textualmente, null. NO infieras ni inventes."

Integración en `locateProperty()` (antes de generar candidatos):
- `rol_sii_mencionado` → lookup directo en `sii_roles_cl` (jackpot: algunos anuncios de parcelas lo publican).
- `calle+numero` → `address_full` del mergedListing (señal más fuerte del V3).
- `condominio`/`sector` → trigram sobre `sii_roles_cl.direccion` en la comuna + geocode Nominatim del hito cacheado (`geocode_clue`, 1 req/s).
- `hitos` ("a pasos de Av. X") → punto auxiliar OSM: si el pin está difuminado, re-centrar la búsqueda por radios ahí.

**Verificación**: muestra de 50 descripciones (Colina/Lo Barnechea, abundan condominios) — precisión ≥90% de calle/condominio extraídos; delta de auto_confirmed en `eval-locator-cl.mjs`. Coste <$0.10/1.000 anuncios.

### Fase 3 — Atributos visuales por VLM (CV + OCR, cache por foto)

**Nuevo `web/lib/photo-attrs-cl.ts`**: hasta 10 fotos por clúster a `AI_MODEL_WORKHORSE` (gemini-2.5-flash-lite, temperature 0, `usage.include` — patrón HTTP de `visual-match-cl.ts:110-130`). **Cache por foto**: `cache_key = content_hash` (de `stored_photos`/`media_assets_cl`; fallback sha256 de URL). Prompt (esbozo):

> "Para cada foto: `es_exterior` (bool). Solo si es exterior: `{piscina:{presente, forma: rectangular|rinon|oval|L|irregular, posicion_relativa}, pisos_visibles, techo:{material: teja_roja|plano|zinc|otro, color}, estilo: mediterranea|moderna|rustica|otro, numero_casa_ocr:{valor, confianza}, cerros_visibles:{presente, cercania}, quincho, cancha, paneles_solares}`. null si no se distingue. NO adivines."

- Agregación por clúster con **regla anti-alucinación**: un atributo es "señal fuerte" solo si aparece en ≥2 fotos o con confianza alta. → `evidence.visual_attrs`.
- Integración sin tocar firmas: `pisos` → `floorsEvidence` (log-odds 1.2); `piscina` → `has_pool`; **`numero_casa_ocr` + calle (F2) fabrican `address_full`** (log-odds 4.2). Estilo/techo → Fases 5-6.
- Con el presupuesto aprobado: corre para **todos** los clústeres nuevos de RM; el gating (solo `needs_review`) queda como palanca si el volumen crece.

### Fase 4 — Huellas de techo Google Open Buildings V3

La señal "cómo se ve desde arriba" sin pagar visión por candidato. **Dato confirmado** (sitio oficial): descarga por celda S2 nivel 4; la celda de Santiago/RM es **`967_buildings.csv.gz` (~950 MB comprimido)** — `https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/967_buildings.csv.gz` (también vía HDX). Columnas: `latitude, longitude, area_in_meters, confidence, geometry` (WKT), `full_plus_code`.

**Migración `0102_building_footprints_cl.sql`:**

```sql
CREATE TABLE building_footprints_cl (
  id bigserial PRIMARY KEY,
  geom geometry(Polygon, 4326) NOT NULL,
  area_m2 numeric, confidence numeric, plus_code text,
  source text NOT NULL DEFAULT 'google-open-buildings-v3'
);
CREATE INDEX idx_building_footprints_cl_geom ON building_footprints_cl USING gist(geom);

CREATE MATERIALIZED VIEW parcel_footprint_stats_cl AS
SELECT p.id AS parcel_id, p.rol, p.comuna_id,
       count(b.id)      AS building_count,
       sum(b.area_m2)   AS footprint_total_m2,
       max(b.area_m2)   AS footprint_main_m2
FROM cadastre_parcels_cl p
JOIN building_footprints_cl b ON ST_Intersects(p.geom, b.geom)
GROUP BY p.id, p.rol, p.comuna_id;
-- + índice (comuna_id, rol); orientación/elongación vía ST_OrientedEnvelope si rinde
```

**Nuevo `scraper/ingest-open-buildings-cl.mjs`**: descarga HTTPS en **streaming sin descomprimir a disco** (VPS limitado): `zlib.createGunzip()` → CSV línea a línea → filtro **bbox RM** + `confidence ≥ 0.7` + `area ≥ 15 m²` → `COPY` con `pg-copy-streams`. Reanudable (checkpoint por línea) e idempotente. Tabla resultante ~1-2 GB: deja lista la expansión de comunas.

**⚠️ Límite temporal (confirmado por el usuario): la inferencia de Open Buildings v3 es de mayo 2023** — construcciones posteriores no aparecen. Mitigaciones obligatorias:
- Si `anio_construccion` SII > 2022, el anuncio dice "nueva/a estrenar" o la comuna tiene mucha obra nueva ⇒ `building_count = 0` **NO penaliza** (la señal se anula, no resta).
- Complemento donde falte: footprints de **OSM** (Chile tiene buena cobertura urbana) y **Microsoft South America Building Footprints** (ODbL, imágenes 2020-2021) — mismo esquema de tabla, columna `source` los distingue.
- Opcional: dataset **Open Buildings 2.5D Temporal** (series 2016-2023 con altura estimada de edificio) — útil además como proxy de nº de pisos para la señal de footprint.
- El desempate visual (F5) usa tiles satelitales actuales, así que las construcciones post-2023 siempre tienen un camino de verificación.

**Integración**: extender `SiiCandidateRow` (`sii-match-cl-v2.ts:43-62`) con las stats (LEFT JOIN a la MV por `normalizar_rol_cl(rol)`+comuna, poblado en `findSiiCandidatesV3`); nueva señal `footprintEvidence()` en `scoreCandidateV3`: huella esperada ≈ `sqm_construida / pisos` (pisos del anuncio, del VLM o de `sii_construcciones_cl`), tope **±0.9 log-odds** (Open Buildings tiene error de segmentación); `building_count=0` con casa construida ⇒ −0.8; forma/orientación vs `visual_attrs` como bonus leve. Jubila el `buildingFootprintRatio` débil de `aerial-signature-cl.mjs` (post-MVP).

**Verificación**: correlación `footprint_main_m2` vs `superficie_construida_m2/pisos` SII en roles ya confirmados (esperable r>0.7 en casas); delta de separación log-odds top1-top2.

### Fase 5 — Desempate visual + cola de revisión humana

- Reusar `verifyCandidatesVisually()` (`visual-match-cl.ts:71`) dentro de `locateProperty()`: solo cuando queda `needs_review` con top-2 cercanos — 4-8 mejores fotos **exteriores** (según `es_exterior` de F3) vs tiles de los top-4; inyectar `visual_score` y re-puntuar (camino de rescore existente en `captar-pipeline.ts`); veredictos cacheados en `evidence`.
- **Nueva página `web/app/chile/localizador/page.tsx`**: cola de `needs_review` — fotos del clúster, pins por corredora (colores de `corredora-pin-colors.ts`), candidatos sobre parcelas (endpoints existentes `parcels-bbox`/`cadastre-geojson`/`sii-rol-detail`), confirmar/rechazar.
- **Nuevo `web/app/api/chile/property-locator/[id]/confirm/route.ts`**: escribe `rol_matriz` (con `normalizeClRol`), `rol_confidence=1`, `location_confidence='confirmed'` y registra la decisión humana → **dataset etiquetado que se autoacumula**.

### Fase 6 — Embeddings (pgvector) + verificación de fachada

- **Migración `0103_pgvector_embeddings_cl.sql`**: extensión `vector`; `media_assets_cl.embedding vector(512)` + embedding de descripciones.
- Embeddings de imagen SigLIP/CLIP: en VPS 8 GB sin GPU es viable pero lento → API barata u offline por lotes nocturnos. Usos: dedup mejorado (near-duplicates que el pHash pierde: recortes, marcas de agua), búsqueda "fotos parecidas" cross-corredora, y **matching fachada ↔ Street View Static / Mapillary** (free tier) del candidato top-1 cruzando `numero_casa_ocr` + estilo/techo.
- **Criterio de activación**: cuando el corpus etiquetado autoacumulado (captaciones confirmadas + decisiones de la cola + `listing_match_cl` decididos) supere **~1.500-2.000 casos** — ahí también se recalibran los log-odds con datos reales. Antes aporta poco frente a su coste.

### Fase 7 — Aprendizaje continuo + pestaña "Entrenar" (etiquetado rápido con active learning)

**Punto de partida real**: hoy hay **~73 captadas confirmadas** (y subiendo) sobre ~15.000 anuncios/propiedades totales. El gold set inicial es pequeño — por eso el mecanismo para **crecer el corpus etiquetado rápido es parte del MVP**, no una fase tardía. Tres piezas:

**a) Semilla de etiquetas — lo que ya existe se importa como entrenamiento (migración `0104_locator_labels_cl.sql`):**

```sql
CREATE TABLE locator_labels_cl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('rol_match','pair_match')),
  -- rol_match: ¿este clúster/anuncio es este ROL?  pair_match: ¿estos 2 anuncios son la misma propiedad?
  property_cl_id uuid REFERENCES property_cl(id) ON DELETE CASCADE,
  rol text, sii_comuna_code text,            -- para rol_match
  listing_a uuid, listing_b uuid,            -- para pair_match
  label text NOT NULL CHECK (label IN ('yes','no','unsure')),
  source text NOT NULL CHECK (source IN
    ('entrenar_tab','review_queue','captacion_confirmada','manual_merge','manual_split','pin_manual')),
  signals jsonb,                             -- snapshot de señales al momento de etiquetar
  created_at timestamptz DEFAULT now()
);
```

Script de importación inicial (una vez): las ~73 captaciones con `sii_rol` confirmado (`source='captacion_confirmada'`), los pins manuales (`pin_manual` vía `resolveRolAtPoint`), **todas las uniones manuales de corredoras distintas ya hechas** (`property_merge_log_cl` action merge → pares `yes`; action split → pares `no`; `source='manual_merge'/'manual_split'`) y los pares de `listing_match_cl` con `decided_by='human'`. Con eso el corpus arranca en varios cientos de etiquetas, no en 73.

**Y las futuras, automáticamente**: los endpoints existentes de unir/separar (`/api/chile/property-cl/merge` y `/split`, `web/lib/property-cl-merge.ts`) se extienden para que **cada unión o separación manual nueva escriba su etiqueta en `locator_labels_cl` en el momento** — el usuario entrena al sistema con su trabajo normal de todos los días, sin paso extra.

**b) Pestaña "Entrenar" — confirmación rápida de casas y direcciones** (`web/app/chile/localizador/page.tsx`, pestañas "Revisión" y "Entrenar"):
- Muestra **un caso por pantalla**: fotos del anuncio (carrusel) + mapa con la parcela candidata resaltada + dirección SII propuesta + comparación física (m² anuncio vs SII, dorms, año) → botones grandes **"✅ Es exacta" / "❌ No es" / "➡️ Ver otro candidato" / "Saltar"**, con atajos de teclado (1/2/3/espacio) para etiquetar en segundos.
- **Active learning**: prioriza los casos donde el modelo duda (probabilidad del top-1 entre 0.5-0.9) — cada clic ahí enseña lo máximo. Intercala ~1 de cada 10 casos de alta confianza para auditar la precisión de los auto-confirmados.
- Modo pares: cuando hay pares dedup en la zona gris (0.45-0.75), muestra dos anuncios lado a lado — "¿Son la misma propiedad?" — y alimenta `pair_match`.
- Cada "✅ Es exacta" hace doble trabajo: guarda la etiqueta Y confirma el ROL en `property_cl` (mismo camino que la cola de revisión). Ritmo realista: 20-30 etiquetas en 5 minutos diarios ⇒ >1.000 etiquetas en un mes.

**c) Calibración y ciclo virtuoso:**
- Nuevo `scraper/calibrate-locator-cl.mjs` (cron semanal): regresión logística sobre `locator_labels_cl.signals` → propone pesos log-odds recalibrados para `scoreCandidateV3`, `footprintEvidence` y los pesos de par del dedup, con datos chilenos reales en vez de los pesos a ojo actuales. Corre en el VPS en segundos (álgebra, no deep learning); los pesos se aplican tras revisar el reporte, nunca en caliente. Con <300 etiquetas solo reporta; la calibración automática se activa al superar ~300 por tipo.
- Cada decisión en "Entrenar", cada confirmación de la cola y cada unión/separación manual nueva escribe en `locator_labels_cl` → el corpus crece solo → recalibra → sube la precisión → más auto-confirmaciones. Con >2.000 etiquetas: modelo ligero (regresión regularizada o gradient boosting pequeño, CPU) como scorer A/B contra el de reglas — se adopta solo si gana en el gold set.

Entrenar una red neuronal propia sigue fuera del plan: con este volumen el calibrado estadístico rinde más y cuesta $0.

### Fase 8 — Dedup 2.0: el mismo stack aplicado a la deduplicación

La dedup actual (`score-pair-cl.mjs`) usa pHash + trigram + teléfono/agencia. Con las piezas del localizador ya construidas, se enriquece gratis:

| Señal nueva de par | Origen | Peso propuesto |
|---|---|---|
| **Mismo ROL localizado** (dos anuncios que resuelven al mismo `rol_matriz` con confianza alta) | F1-F5 — cierra el círculo localizador→dedup | +0.70 (casi decisoria) |
| Mismo condominio/calle+nº extraídos por NLP | `text_clues` (F2), cacheado | +0.35 |
| Mismo `numero_casa_ocr` | `photo_attrs` (F3) | +0.45 |
| Atributos visuales compatibles (piscina forma, techo, estilo) / incompatibles | F3 | +0.10 / **−0.40** (guardarraíl) |
| Embeddings de foto near-dup (recortes, marcas de agua, reencuadres que el pHash pierde) | F6 pgvector, umbral coseno | +0.45 |
| Pistas geocodificadas cercanas (<100 m) | F2 geocoding | +0.15 |

- Implementación: extender `CL_PAIR_WEIGHTS`/`CL_HARD_SIGNALS` en `score-pair-cl.mjs` leyendo de `ai_cache_cl`/`property_locator_cl` (señales ya calculadas — coste marginal $0); los pesos definitivos los calibra la Fase 7 con `locator_labels_cl` — que incluye **todas las uniones y separaciones manuales ya hechas** (`property_merge_log_cl` importado como pares etiquetados) y los pares decididos por humanos en `listing_match_cl`: el sistema aprende directamente de cómo el usuario empareja props de corredoras distintas.
- **Grafo de conocimiento**: extender el grafo `graphology` de `clustering-cl.mjs` (hoy solo anuncio↔anuncio) a nodos heterogéneos — anuncio, propiedad, ROL, corredora, teléfono, condominio/edificio — persistido como vistas sobre las tablas existentes. Usos: detectar corredoras que republican bajo varios `advertiser_id`, condominios con numeración interna propia, y consultas tipo "todas las corredoras que han publicado esta propiedad" para trazabilidad de exclusividad.

### Fase 9 — Departamentos y edificios (meta >95% a nivel edificio)

Hoy el piloto son casas; los departamentos (que ~duplicarán el stock hacia ~30.000 props) son en realidad **más fáciles a nivel edificio** — la dirección del edificio suele ser pública en el anuncio — y más difíciles a nivel unidad. Estrategia en dos niveles:

1. **Nivel edificio (el objetivo >95%)**: infraestructura ya existente — `web/lib/sii-edificio-sql.ts` agrupa unidades por dirección base y `rol_padre`; endpoints `sii-edificios`/`sii-building-units`. Señales: dirección+nº del anuncio/NLP, nombre del edificio/condominio (F2), fachada del edificio en fotos vs Street View (F6), skyline/altura visible, `building_count` y huella del footprint (los edificios grandes son inconfundibles en Open Buildings), gastos comunes como proxy de categoría.
2. **Nivel unidad (refinamiento)**: dentro del `rol_padre`, filtrar unidades por `superficie_m2` SII (±10%), piso (NLP: "piso 12", "penthouse"; VLM: altura de la vista desde ventanas/balcón), orientación (NLP + sombras/vista en fotos), avalúo vs precio pedido, dormitorios. Muchas veces queda un set de 2-10 unidades gemelas del mismo piso/tipo — se reporta el edificio con lista de unidades candidatas ordenadas, que ya es accionable para captación (el rol exacto se confirma con el dueño/TGR).
- Cambios: `property_locator_cl` gana `building_rol_padre` y `unit_candidates jsonb`; el embudo F1-F5 se reutiliza entero cambiando el generador de candidatos (edificios en vez de parcelas) — sin migración estructural nueva.
- Prerequisito por comuna: stock SII cargado (ya nacional) + geocoding de direcciones de edificios (mismo job de F1).

---

## 5. Coste por 1.000 anuncios nuevos (≈650 clústeres)

| Etapa | Volumen tras embudo | Tokens aprox. | Coste |
|---|---|---|---|
| F1 determinista | 650 | 0 | $0 |
| F2 NLP texto (qwen3-8b) | ~450 | ~1.2k c/u | <$0.10 |
| F3 VLM atributos (flash-lite) | 650 (sin gating) | 10 fotos ≈ 3.6k c/u | ~$0.40 |
| F5 desempate visual (flash-lite) | ~130 | 12 imágenes ≈ 4.5k c/u | ~$0.10 |
| Tiles / Nominatim | cache / free tier | — | $0 |
| **Total** | | | **<$1 / 1.000 anuncios · re-procesos ≈$0 por `ai_cache_cl`** |

Al volumen actual: **<$5/mes**, muy por debajo del tope de $50/mes. Palanca disponible: desempate visual estándar en todo `needs_review`.

**Backfill del stock existente**: ~15.000 anuncios/props hoy ⇒ ~$10-15 una sola vez (F2+F3 sobre todo el histórico, en lotes nocturnos); al crecer a ~30.000 con deptos y más comunas ⇒ <$30 one-time y el incremental mensual sigue <$10, porque el cache por `content_hash` hace que re-procesar sea ≈$0. (Las **captadas confirmadas** son hoy ~73 — ese es el gold set inicial, ver F7.)

## 6. Cómo se mide el >90% (no se promete a ciegas)

1. `node scraper/eval-locator-cl.mjs` en cada fase, contra el gold set existente (captaciones con `sii_rol` confirmado + pins manuales): precisión y cobertura por comuna, con delta por fase.
2. **Gate**: precisión de `auto_confirmed` **≥95%**; si baja, se suben umbrales antes de avanzar de fase.
3. Expectativa honesta: >90% de acierto global es alcanzable en comunas con polígonos y anuncios con fotos+texto ricos; en comunas sin coordenadas SII el techo lo pone el geocoding del stock (por eso corre en paralelo desde F1). Para departamentos (F9) la meta es **>95% a nivel edificio** (dirección de edificio suele ser pública) con lista corta de unidades candidatas como salida accionable.
4. E2E: migraciones en orden sobre copia; jobs verificados en logs pg-boss y `/chile/anuncios-health`; flujo completo en `/chile/localizador` con un clúster real de Las Condes → verificar `rol_matriz` en `property_cl` y `address_real` en el panel SmartBC.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Términos de uso comercial de Esri World Imagery (hallazgo abierto) | Abstraer proveedor de tiles tras env `SAT_TILE_PROVIDER` (Mapbox Static 50k/mes gratis, Google Static 10k/mes) |
| Nominatim público 1 req/s | Cache en `ai_cache_cl`, solo pistas nuevas, lotes nocturnos; self-host al expandir |
| `HETZNER_S3_*` sin configurar (sin `stored_photos`/`content_hash`) | F0 incluye `phash-backfill-cl` sin almacenamiento; cache VLM degrada a sha256(URL). **Recomendado configurar las credenciales** |
| VLM alucinando atributos | temperature 0, null obligatorio, confianza por atributo, regla ≥2 fotos; la IA solo mueve log-odds acotados — `decideMatch` sigue exigiendo 0.92+margen |
| Open Buildings con offsets/falsos edificios | `confidence ≥ 0.7` y señal acotada ±0.9, nunca decisoria |

## 8. Fuera del MVP

- **Entrenar redes neuronales propias / fine-tuning de visión**: innecesario, el embudo lo cubre. El "entrenamiento" del sistema es la calibración estadística continua de la Fase 7 (regresión logística/GBM sobre CPU, coste $0) — con este volumen de datos rinde más que una red propia. Reconsiderar solo si el corpus etiquetado supera decenas de miles de casos y la calibración toca techo.
- **Cross-view geolocalization (GeoCLIP/PIGEON)**: mediana de error ~44 km — inútil a escala de parcela. Solo investigación futura.
- **Nuevas fuentes catastrales SII**: restricción del usuario — solo `sii_roles_cl`/`cadastre_parcels_cl` ya cargados.

## 9. Archivos

**Reutilizar**: `web/lib/captar-pipeline.ts` · `web/lib/sii-match-cl-v2.ts` · `web/lib/visual-match-cl.ts` · `scraper/lib/media-sync-cl.mjs` · `scraper/lib/phash.mjs` · `scraper/worker-cl.mjs` · `web/lib/rol-format.ts` · `scraper/lib/geocode-cl.mjs`.

**Nuevos**: `web/lib/property-locator-cl.ts` · `web/lib/text-clues-cl.ts` · `web/lib/photo-attrs-cl.ts` · `scraper/lib/phash-backfill-cl.mjs` · `scraper/lib/locator-feeder-cl.mjs` · `scraper/ingest-open-buildings-cl.mjs` · `scraper/eval-locator-cl.mjs` · `scraper/calibrate-locator-cl.mjs` (F7) · `scraper/seed-locator-labels-cl.mjs` (F7a, importa captaciones/uniones existentes) · `web/app/api/chile/property-locator/{route.ts, [id]/confirm/route.ts, entrenar/route.ts}` · `web/app/chile/localizador/page.tsx` (pestañas Revisión + Entrenar) · migraciones `0100`–`0104`.

Para F8-F9 (dedup 2.0 y departamentos): extender `scraper/lib/score-pair-cl.mjs`, `scraper/lib/clustering-cl.mjs` y reutilizar `web/lib/sii-edificio-sql.ts` + endpoints `sii-edificios`/`sii-building-units`.

---

## 10. Orquestación — trabajo en paralelo con varias cuentas de Claude

Cuatro puestos que pueden avanzar **a la vez sin pisarse**, porque el reparto es por **propiedad exclusiva de archivos**, no por fases sueltas. Cada persona abre Claude Code en su cuenta, lee este documento y su brief, y trabaja SOLO en sus archivos y su rama.

### 10.1 Reglas de convivencia (obligatorias para todos)

1. **Rama propia por puesto**: `feat/localizador-p1-infra`, `feat/localizador-p2-nucleo`, `feat/localizador-p3-ia`, `feat/localizador-p4-ui`. PRs pequeños (una pieza por PR) contra `main`, mergeados SOLO en el orden de integración de §10.4.
2. **Propiedad exclusiva**: cada archivo tiene UN dueño (tabla §10.2). Si necesitas cambiar un archivo ajeno, NO lo toques: pídeselo a su dueño (comentario en el PR o al coordinador). Los dos archivos más peleados ya tienen dueño fijo: `scraper/worker-cl.mjs` → P1; `web/lib/sii-match-cl-v2.ts` y `captar-pipeline.ts` → P2.
3. **Números de migración reservados** (no negociables, así nunca chocan): P2 → `0100`; P3 → `0101`; P1 → `0102`; P4 → `0104`. La `0103` (pgvector, F6) queda libre para quien llegue a esa fase. Si alguien necesita una migración extra, pide número al coordinador ANTES de escribirla.
4. **Contratos congelados** (§10.3): los JSON y firmas que cruzan puestos no se cambian sin avisar al coordinador. Puedes AÑADIR campos, nunca renombrar ni quitar.
5. Cada PR entrega con: tests (`.test.mjs`/unitario, deps inyectadas), migraciones idempotentes, y `/code-review` pasado si es pieza 🔴 (ver tabla de desarrollo en §4).
6. **Intocable para todos**: decisiones humanas (`decided_by='human'`, `manual_property_lock`, pins manuales) y los snapshots crudos. Nada de tu código las revierte jamás.
7. Tras cada merge a `main`, todos hacen `git fetch origin main && git rebase origin/main` antes de seguir.

### 10.2 Los 4 puestos

**P1 — Infra & Datos (Sonnet 5, esfuerzo medio) — arranca YA, sin dependencias**
- Fases: **F0 completa** (fix pHash en `media-sync-cl.mjs`, nuevo `phash-backfill-cl.mjs` + test, saneamiento S3 real, smoke tests) → **F7a** (`seed-locator-labels-cl.mjs`, cuando P4 tenga la 0104 mergeada) → **F4a** (`ingest-open-buildings-cl.mjs` streaming + migración `0102`).
- Dueño de: `scraper/lib/media-sync-cl.mjs`, `scraper/lib/phash-backfill-cl.mjs`, `scraper/ingest-open-buildings-cl.mjs`, `scraper/seed-locator-labels-cl.mjs`, **`scraper/worker-cl.mjs`** (registra TODAS las colas nuevas, también las que pidan P2/P3 — se las piden por PR comment), migración `0102`.
- Definición de hecho: phashes poblados >90%, bucket real probado, footprints RM cargados con la MV `parcel_footprint_stats_cl`.

**P2 — Núcleo del localizador (Fable 5, esfuerzo ALTO, 🔴 /code-review siempre) — arranca YA en paralelo**
- Fases: **F1** (migración `0100` + `web/lib/property-locator-cl.ts` + `web/app/api/chile/property-locator/route.ts` + `scraper/lib/locator-feeder-cl.mjs`*) → **F4b** (señal `footprintEvidence` en el scoring, cuando P1 tenga la MV) → **F5b** (re-score con `visual_score`) → **F7c** (`calibrate-locator-cl.mjs`) → **F8**.
  *El feeder lo escribe P2 pero su registro en worker-cl.mjs lo hace P1.
- Dueño de: `web/lib/property-locator-cl.ts`, `web/lib/sii-match-cl-v2.ts`, `web/lib/captar-pipeline.ts`, `scraper/lib/score-pair-cl.mjs` (F8), `scraper/calibrate-locator-cl.mjs`, `scraper/eval-locator-cl.mjs`, migración `0100`.
- Definición de hecho por pieza: `eval-locator-cl.mjs` corriendo y precisión auto_confirmed ≥95% en el gold set antes de cada merge que toque scoring.

**P3 — IA: prompts y extracción (Opus 5, esfuerzo medio) — arranca YA en paralelo**
- Fases: **F2** (`web/lib/text-clues-cl.ts` + migración `0101` ai_cache) → **F3** (`web/lib/photo-attrs-cl.ts` con cache por content_hash y agregación anti-alucinación) → **F5a-visión** (ajustes de prompt de `visual-match-cl.ts` si hacen falta).
- Dueño de: `web/lib/text-clues-cl.ts`, `web/lib/photo-attrs-cl.ts`, `web/lib/visual-match-cl.ts`, migración `0101`.
- Clave: sus módulos son **funciones puras** — reciben textos/fotos, devuelven el JSON del contrato §10.3, no tocan el scoring ni la BD de propiedades. Así P3 nunca choca con P2: P2 las llama cuando estén.
- Definición de hecho: precisión ≥90% en muestra manual de 50 descripciones (F2) y 50 fotos (F3); coste por llamada registrado en `ai_cache_cl`.

**P4 — UI y entrenamiento (Sonnet 5; la query de active learning con Opus 5) — arranca YA con datos mock**
- Fases: **F7b** (migración `0104` locator_labels + `web/app/chile/localizador/page.tsx` pestañas Revisión/Entrenar + `web/app/api/chile/property-locator/{[id]/confirm,entrenar}/route.ts`) → **F5a** (cola de revisión con mapa de candidatos) → extensión de `property-cl-merge.ts` para que unir/separar escriba etiquetas.
- Dueño de: todo `web/app/chile/localizador/`, `web/app/api/chile/property-locator/[id]/confirm/` y `/entrenar/`, `web/lib/property-cl-merge.ts`, migración `0104`.
- Empieza con **datos mock que cumplen el contrato `candidates` de §10.3** (no espera a P2); conecta el dato real cuando F1 esté en main.
- Definición de hecho: etiquetar 25 casos en <5 min con teclado; cada "Es exacta" escribe etiqueta + confirma ROL.

### 10.3 Contratos congelados (la interfaz entre puestos)

1. **`property_locator_cl`** (migración 0100, P2): columnas y estados exactamente como en §4-F1. P4 lee `status`, `evidence`, `candidates`; no escribe más que vía sus endpoints.
2. **`candidates` jsonb** (P2 escribe, P4 pinta): `[{rol, sii_comuna_code, direccion, probability, rank, signals: {address, distance, land_area, built_area, floors, footprint, visual}, lat, lng, parcel_id}]`.
3. **`text_clues` JSON** (P3 → P2): `{calle, numero, condominio, esquina_con, hitos:[{nombre, relacion}], sector, orientacion, pisos, piscina, rol_sii_mencionado, confianza}` — null si no aparece.
4. **`photo_attrs` JSON** (P3 → P2): `{es_exterior, piscina:{presente, forma, posicion_relativa}, pisos_visibles, techo:{material, color}, estilo, numero_casa_ocr:{valor, confianza}, cerros_visibles, quincho, cancha, paneles_solares}` — por foto, null si no se distingue.
5. **`ai_cache_cl`** (0101, P3) y **`locator_labels_cl`** (0104, P4): esquemas exactamente como en §4.
6. **`parcel_footprint_stats_cl`** (0102, P1): `parcel_id, rol, comuna_id, building_count, footprint_total_m2, footprint_main_m2`.
7. Funciones expuestas: P3 exporta `extractTextClues(texts: string[]): Promise<TextClues>` y `extractPhotoAttrs(photos: PhotoRef[]): Promise<PhotoAttrs[]>`; P2 exporta `locateProperty(propertyClId: string)`; P1 expone las colas pg-boss con los nombres de §4.

### 10.4 Orden de integración a `main`

```
1. P1: F0 (pHash + saneamiento)          ← desbloquea señal de fotos
2. P2: 0100 + F1 núcleo                  ← desbloquea a P4 (dato real) y P1 (seed)
3. P4: 0104 + pestaña Entrenar           │ 4. P3: 0101 + F2 NLP     (3 y 4 en cualquier orden)
5. P1: seed etiquetas (F7a)              │ 6. P3: F3 visión         (5 y 6 en cualquier orden)
7. P1: 0102 + footprints → 8. P2: señal footprint (F4b)
9. P4: cola revisión (F5a) → 10. P2: re-score visual (F5b)
11. P2: calibración (F7c) → 12. P2: dedup 2.0 (F8)
```

Coordinador (el dueño del proyecto o quien designe): asigna números de migración extra, aprueba cambios de contrato, y mergea en este orden. Si un puesto se bloquea esperando un merge, adelanta la siguiente pieza propia de su lista — cada puesto tiene siempre trabajo no bloqueado.

### 10.5 Briefs individuales (listos para repartir)

Cada puesto tiene su documento con tareas, archivos, contratos y criterios de "hecho":

- `docs/localizador-briefs/P1-INFRA-DATOS.md`
- `docs/localizador-briefs/P2-NUCLEO.md`
- `docs/localizador-briefs/P3-IA-EXTRACCION.md`
- `docs/localizador-briefs/P4-UI-ENTRENAMIENTO.md`

Mensaje de arranque para cada persona (copiar/pegar)

> Vas a trabajar en el Localizador de Propiedades con IA del CRM. Eres el puesto **PX**: lee `docs/localizador-briefs/PX-....md` y el plan completo `docs/PLAN-LOCALIZADOR-IA-CL.md` antes de escribir código. Resumen de las reglas: configura `/model` como indique tu brief; trabaja SOLO en los archivos de los que eres dueño, en tu rama, con PRs pequeños a main; respeta los contratos de §10.3 (puedes añadir campos, nunca renombrar ni quitar); cada PR lleva tests y migraciones idempotentes, más `/code-review` si tu pieza está marcada 🔴. Nunca toques decisiones humanas (`decided_by='human'`, `manual_property_lock`, pins manuales) ni archivos de otro puesto — si necesitas un cambio ajeno, pídelo en el PR. Tras cada merge a main, haz rebase antes de seguir.
