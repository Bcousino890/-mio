# Brief P2 — Datos e IA

> Lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo antes de escribir código, sobre todo §4 (fases F0, F2, F3, F4a) y §10 (orquestación). Este brief resume lo tuyo, no reemplaza el plan.

## Tu puesto

Eres **P2**, el combustible del sistema: arreglas lo que está roto, cargas los datos geográficos y conviertes texto y fotos en datos estructurados. Todo lo que produces lo consume P1 para decidir. Tus módulos de IA son **funciones puras** — reciben textos o fotos y devuelven JSON, no tocan la base de propiedades — por eso nunca chocas con P1.

- **Rama**: `feat/localizador-p2-datos`
- **Migraciones reservadas**: `0101` (cache de IA) y `0102` (footprints)
- **Arrancas el día 1**, no dependes de nadie.

### Modelo y esfuerzo por tarea

Casi todo tu trabajo sigue patrones que ya existen en el repo, así que **Sonnet 5 te sirve para el 80%**. Sube de modelo solo en los prompts.

| Tarea | `/model` | Esfuerzo | Por qué |
|---|---|---|---|
| F0a fix pHash en `media-sync-cl.mjs` | `claude-sonnet-5` | Medio | Cambio acotado en un UPDATE existente |
| F0b `phash-backfill-cl.mjs` + test | `claude-sonnet-5` | Medio | Patrón de los `.mjs` con deps inyectadas |
| F0c saneamiento S3 y smoke tests | `claude-sonnet-5` | Medio | Verificación, no diseño |
| `0101` cache | `claude-sonnet-5` | Bajo | DDL simple |
| **F2 prompt de NLP** | `claude-opus-5` (o Sonnet si no hay) | **Alto** | Un prompt malo mete direcciones falsas al scoring |
| F2 parser y wiring del cache | `claude-sonnet-5` | Medio | Código de pegamento |
| **F3 prompt de visión/OCR** | `claude-opus-5` (o Sonnet si no hay) | **Alto** | Ídem, más la regla anti-alucinación |
| F3 agregación por clúster | `claude-opus-5` | Medio | Decide qué atributo es "señal fuerte" |
| F4a ingesta streaming | `claude-sonnet-5` | Medio | Stream + COPY, patrón conocido |
| `0102` + materialized view | `claude-sonnet-5` | Medio | SQL espacial |
| F6 embeddings (Ola 2) | `claude-sonnet-5` | Medio | Batch aislado, no decide nada solo |

**Si no tienes Opus disponible**: haz los prompts con Sonnet 5 pero **valídalos con la muestra manual de 50 casos antes de dar la fase por hecha** — es el mismo control de calidad, solo que iterarás un par de vueltas más. El presupuesto manda: Opus aquí es una comodidad, no un requisito.

## Archivos de los que eres dueño

```
scraper/lib/media-sync-cl.mjs          (modificas)
scraper/lib/phash-backfill-cl.mjs      (nuevo) + su .test.mjs
scraper/ingest-open-buildings-cl.mjs   (nuevo)
scraper/worker-cl.mjs                  ← TUYO EN EXCLUSIVA
web/lib/text-clues-cl.ts               (nuevo)
web/lib/photo-attrs-cl.ts              (nuevo)
web/lib/visual-match-cl.ts             ← TUYO EN EXCLUSIVA (ya existe, lo ajustas)
db/migrations/0101_ai_cache_cl.sql
db/migrations/0102_building_footprints_cl.sql
```

**Sobre `worker-cl.mjs`**: eres el único que lo edita. P1 escribirá `locator-feeder-cl.mjs` y te pedirá por comentario en su PR que registres la cola (cron `37 * * * *`). Registra siguiendo el patrón de `dedup-cluster-cl` (líneas ~446-452).

## Modelos que usarás en producción (ya configurados en `.env.example`)

| Env | Modelo | Para qué |
|---|---|---|
| `AI_MODEL_CHEAP` | `qwen/qwen3-8b` | F2 — extracción de texto |
| `AI_MODEL_WORKHORSE` | `google/gemini-2.5-flash-lite` | F3 — visión y OCR |

Vía OpenRouter, `temperature: 0`, `usage: {include: true}` para registrar coste real. El patrón HTTP exacto ya está en `web/lib/visual-match-cl.ts:110-130` — cópialo.

## Tus tareas, en orden

### 1. F0 — Bases sólidas (lo primero de todo, desbloquea a todos)

**a) Fix del bug de pHash.** `scraper/lib/upsert-listing-cl.mjs:196-239` nunca escribe `cover_phash`/`photo_phashes` (las columnas existen desde la migración `0028`), así que la señal `photos_match: 0.50` del dedup llega **siempre vacía**. No lo arregles ahí (descargaría 30 fotos de forma síncrona en el detail job): hazlo en `media-sync-cl.mjs`, cuyo UPDATE final (~línea 122) **ya tiene los pHash calculados** en `storedPhotos`. Añade `cover_phash` (primer pHash no nulo) y `photo_phashes`, sin pisar valores ya poblados.

**b) `phash-backfill-cl.mjs`** — fallback para cuando `HETZNER_S3_*` no está configurado (hoy `worker-cl.mjs:390` deshabilita media-sync sin credenciales, así que sin esto el backfill nunca corre). Lotes de ~50 listings activos con `photos != '[]'` y `photo_phashes = '{}'`; máx 12 fotos por anuncio con `calculatePhashBatch(urls, 3)` de `scraper/lib/phash.mjs`; escribe los hashes y **descarta los buffers** (cero almacenamiento). Test con deps inyectadas, como los `.test.mjs` que ya existen. Registra la cola con cron `*/20 * * * *`.

**c) Saneamiento** — esto es lo que garantiza que nadie construya sobre algo roto:
- Configurar `HETZNER_S3_*` en el `.env` del VPS (coordina con el dueño del proyecto, son credenciales).
- **Probar `scraper/lib/hetzner-s3.mjs` contra el bucket real**: su propia cabecera avisa que la capa de I/O nunca se validó (solo con cliente simulado). Sube, lee y borra un objeto de prueba; verifica que la dedup por `content_hash` no re-sube una foto repetida.
- Query de control: confirmar que `photos_match` empieza a llegar poblada en `listing_match_cl`.
- Smoke tests de los cimientos que todos reutilizan: `normalizar_rol_cl()` con ambos formatos (`"3810-21"` vs `"03810-00021"`), `resolveRolAtPoint()` en las 4 comunas con polígonos, y `findSiiCandidatesV3()` con un anuncio conocido.

**Hecho cuando**: >90% de listings activos tienen phashes en una semana, el bucket real funciona, y se ven merges nuevos de `property_cl` por señal de foto.

### 2. Migración `0101` — el cache de IA (antes de escribir cualquier prompt)

Tabla `ai_cache_cl`, esquema exacto en §4-F2 del plan: PK `(kind, cache_key)`, kinds `text_clues`/`photo_attrs`/`geocode_clue`, `result jsonb`, más `prompt_tokens`, `completion_tokens`, `cost_usd`.

**El cache es la pieza clave del presupuesto**: la misma foto republicada por 3 corredoras se paga al modelo **una sola vez**. Para fotos, `cache_key = content_hash` (de `stored_photos`/`media_assets_cl`, que tu propio F0 puebla; fallback a sha256 de la URL). Para textos, sha256 del texto normalizado **+ versión del prompt** (así un cambio de prompt invalida el cache automáticamente).

### 3. F2 — Pistas de texto (`web/lib/text-clues-cl.ts`) · prompt con Opus 5 si lo tienes, si no Sonnet 5

Una llamada por clúster: concatena títulos + descripciones + features de todos los anuncios (truncar a ~6k chars) → `AI_MODEL_CHEAP`.

Prompt (esbozo — refínalo, es tu especialidad):

> "Extrae SOLO datos explícitos del texto de estos anuncios inmobiliarios chilenos (todos de la misma propiedad, publicados por corredoras distintas). Responde JSON: `{calle, numero, condominio, esquina_con, hitos:[{nombre, relacion}], sector, orientacion, pisos, piscina, rol_sii_mencionado, confianza:0-1}`. Si un dato no aparece textualmente, usa null. NO infieras ni inventes."

Exporta `extractTextClues(texts: string[]): Promise<TextClues>`. El JSON es un **contrato congelado** (§10.3): puedes añadir campos, nunca renombrar ni quitar.

Notas de dominio chileno: `rol_sii_mencionado` es el jackpot (algunos anuncios de parcelas publican el rol → match instantáneo). Los condominios abundan en Colina y Lo Barnechea. "A pasos de Av. X" es un hito geocodificable con Nominatim (1 req/s, cachea en `kind='geocode_clue'`). Cuidado con direcciones parciales: "Los Militares al 5000" no es un número exacto.

**Hecho cuando**: precisión ≥90% en muestra manual de 50 descripciones reales, coste por llamada registrado.

### 4. F3 — Atributos visuales y OCR (`web/lib/photo-attrs-cl.ts`) · prompt con Opus 5 si lo tienes, si no Sonnet 5

Hasta 10 fotos por clúster → `AI_MODEL_WORKHORSE`, con cache por foto.

Prompt (esbozo):

> "Para cada foto indica `es_exterior` (bool). Solo si es exterior: `{piscina:{presente, forma: rectangular|rinon|oval|L|irregular, posicion_relativa}, pisos_visibles, techo:{material: teja_roja|plano|zinc|otro, color}, estilo: mediterranea|moderna|rustica|otro, numero_casa_ocr:{valor, confianza}, cerros_visibles:{presente, cercania}, quincho, cancha, paneles_solares}`. Usa null si no se distingue. NO adivines: baja `confianza` si hay duda."

Exporta `extractPhotoAttrs(photos: PhotoRef[]): Promise<PhotoAttrs[]>`.

**Regla anti-alucinación (obligatoria)**: la agregación por clúster marca un atributo como "señal fuerte" **solo si aparece en ≥2 fotos o con confianza alta**. Un modelo que inventa una piscina en una foto no debe mover el scoring. Esta agregación es tu responsabilidad, no la de P1.

Por qué importa cada atributo: la forma de la piscina y el techo se comparan luego contra la vista satelital; `numero_casa_ocr` + la calle de F2 fabrican una dirección completa (la señal más fuerte del scoring); los cerros visibles acotan la orientación.

**Hecho cuando**: precisión ≥90% en muestra manual de 50 fotos reales, cache funcionando (segunda pasada = 0 llamadas), coste registrado.

### 5. F4a — Footprints de Google Open Buildings · Sonnet 5

Migración `0102`: tabla `building_footprints_cl` + materialized view `parcel_footprint_stats_cl` (esquema exacto en §4-F4 del plan).

La celda S2 que cubre Santiago/RM es **`967_buildings.csv.gz` (~950 MB comprimido)**:
`https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/967_buildings.csv.gz`

**En streaming, sin descomprimir a disco** (el VPS tiene espacio limitado): `https.get` → `zlib.createGunzip()` → parser CSV línea a línea → filtro bbox RM + `confidence >= 0.7` + `area >= 15 m²` → `COPY` con `pg-copy-streams`. Reanudable (checkpoint por nº de línea) e idempotente.

Tú solo cargas los datos; la lógica que evita penalizar construcciones posteriores a 2023 es de P1.

**Hecho cuando**: footprints de la RM cargados y `parcel_footprint_stats_cl` poblada y consultable por `(comuna_id, rol)`.

### 6. Ajustes de `visual-match-cl.ts` (si P1 los pide)

El comparador fotos↔satélite ya existe y funciona (Esri z19, prompt de piscina/techo/forma/entorno, devuelve `[{rol, score: -1..1, reasons}]`). P1 lo llamará para desempatar. Si pide ajustes de prompt o de selección de fotos (usar `es_exterior` de tu F3 para elegir las mejores), son tuyos.

Mejora a coordinar con P1: abstraer el proveedor de tiles tras un env `SAT_TILE_PROVIDER` — los términos de uso comercial de Esri World Imagery son un hallazgo abierto (alternativas: Mapbox Static 50k/mes, Google Static 10k/mes).

### 7. Ola 2 — F6 Embeddings (solo cuando el corpus supere ~1.500 etiquetas)

No lo empieces hasta que P3 confirme que hay corpus suficiente; antes aporta poco frente a su coste.

Migración `0103_pgvector_embeddings_cl.sql`: extensión `vector`, `media_assets_cl.embedding vector(512)` + embedding de descripciones. Embeddings de imagen con SigLIP/CLIP **por lotes nocturnos en el VPS** (8 GB sin GPU: viable pero lento, hazlo offline y con checkpoint). Usos: near-duplicates que el pHash pierde (recortes, marcas de agua, reencuadres) y matching fachada ↔ Street View / Mapillary.

Entregas la búsqueda por similitud; quien la usa en el scoring del dedup es P1 (su F8).

## Reglas que no se rompen

- Tus módulos de IA son **funciones puras**: entra texto/fotos, sale JSON. No escribas en `property_cl`, `listings_cl` ni en el scoring — eso es de P1.
- `temperature: 0` siempre; todo cacheado antes de llamar al modelo. Si el cache no está poblado, el sistema degrada, no rompe.
- Filosofía del proyecto, ya documentada en `visual-match-cl.ts:6-8`: **"la IA es fallback, no camino principal"**. Tus señales mueven log-odds acotados; nunca confirman solas.
- Migraciones idempotentes; tests con deps inyectadas (mockea las respuestas del modelo).
- **Nunca** toques decisiones humanas (`decided_by='human'`, `manual_property_lock`, pins manuales) ni los snapshots crudos.
- **Nunca** edites archivos de otro puesto — pide el cambio en el PR.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
