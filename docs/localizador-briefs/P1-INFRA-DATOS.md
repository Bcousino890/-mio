# Brief P1 — Infra & Datos

> **Antes de empezar**: lee `docs/PLAN-LOCALIZADOR-IA-CL.md` completo, sobre todo §4 (fases F0, F7a, F4a) y §10 (orquestación). Este brief no reemplaza el plan, lo resume.

## Tu puesto

Eres el puesto **P1**. Preparas los cimientos y los datos: arreglas lo que está roto, cargas los footprints y eres el **único** que toca el worker.

- **Modelo**: `/model claude-sonnet-5` (todas tus piezas siguen patrones existentes en el repo).
- **Rama**: `feat/localizador-p1-infra`
- **Migración reservada**: `0102` (nadie más la usa; si necesitas otra, pídesela al coordinador).
- **Arrancas YA** — no dependes de nadie.

## Archivos de los que eres dueño

```
scraper/lib/media-sync-cl.mjs          (modificas)
scraper/lib/phash-backfill-cl.mjs      (nuevo) + su .test.mjs
scraper/ingest-open-buildings-cl.mjs   (nuevo)
scraper/seed-locator-labels-cl.mjs     (nuevo)
scraper/worker-cl.mjs                  ← TUYO EN EXCLUSIVA
db/migrations/0102_building_footprints_cl.sql
```

**Importante sobre `worker-cl.mjs`**: eres el único que lo edita. P2 y P3 escribirán módulos que necesitan colas nuevas (`locator-feeder-cl`, etc.) pero **te pedirán a ti el registro** por comentario en su PR. Regístralas siguiendo el patrón de `dedup-cluster-cl` (líneas ~446-452).

## Tus tareas, en orden

### 1. F0 — Bases sólidas (lo primero, desbloquea a todos)

**a) Fix del bug de pHash.** `scraper/lib/upsert-listing-cl.mjs:196-239` nunca escribe `cover_phash`/`photo_phashes` (las columnas existen desde la migración `0028`), así que la señal `photos_match: 0.50` del dedup llega siempre vacía. No lo arregles ahí (descargaría 30 fotos de forma síncrona en el detail job): hazlo en `media-sync-cl.mjs`, cuyo UPDATE final (~línea 122) **ya tiene los pHash calculados** en `storedPhotos`. Añade `cover_phash` (primer pHash no nulo) y `photo_phashes`, sin pisar valores ya poblados.

**b) `phash-backfill-cl.mjs`** — fallback para cuando `HETZNER_S3_*` no está configurado (hoy `worker-cl.mjs:390` deshabilita media-sync sin credenciales, así que sin esto el backfill nunca corre). Lotes de ~50 listings activos con `photos != '[]'` y `photo_phashes = '{}'`; máx 12 fotos por anuncio con `calculatePhashBatch(urls, 3)` de `scraper/lib/phash.mjs`; escribe los hashes y **descarta los buffers** (cero almacenamiento). Test con deps inyectadas, como los `.test.mjs` que ya existen.

**c) Registra la cola** `phash-backfill-cl` en el worker con cron `*/20 * * * *`.

**d) Saneamiento** (esto es lo que garantiza que no construimos sobre algo roto):
- Configurar `HETZNER_S3_*` en el `.env` del VPS (coordina con el dueño del proyecto — son credenciales).
- **Probar `scraper/lib/hetzner-s3.mjs` contra el bucket real**: su cabecera avisa que la capa de I/O nunca se validó (solo con cliente simulado). Sube, lee y borra un objeto de prueba; verifica que la dedup por `content_hash` no re-sube una foto repetida.
- Query de control: confirmar que `photos_match` empieza a llegar poblada en `listing_match_cl`.
- Smoke tests de los cimientos que todos reutilizan: `normalizar_rol_cl()` con formatos con y sin ceros (`"3810-21"` vs `"03810-00021"`), `resolveRolAtPoint()` en las 4 comunas con polígonos, y `findSiiCandidatesV3()` con un anuncio conocido.

**Hecho cuando**: >90% de listings activos tienen phashes en una semana, el bucket real funciona, y se ven merges nuevos de `property_cl` por señal de foto.

### 2. F7a — Semilla de etiquetas (espera a que P4 mergee la migración `0104`)

`scraper/seed-locator-labels-cl.mjs`: importa a `locator_labels_cl` todo lo que ya es conocimiento humano en el sistema —
- captaciones con `sii_rol` confirmado → `source='captacion_confirmada'`;
- pins manuales (`property_cl.manual_latitude/longitude` → `resolveRolAtPoint`) → `source='pin_manual'`;
- **todas las uniones y separaciones manuales de corredoras distintas** (`property_merge_log_cl`: merge → pares `label='yes'`, split → `label='no'`) → `source='manual_merge'/'manual_split'`;
- pares de `listing_match_cl` con `decided_by='human'`.

Idempotente (re-ejecutable sin duplicar). **Hecho cuando**: el corpus arranca en varios cientos de etiquetas, no en 73.

### 3. F4a — Footprints de Google Open Buildings

Migración `0102` (tabla `building_footprints_cl` + materialized view `parcel_footprint_stats_cl` — esquema exacto en §4-F4 del plan) e `ingest-open-buildings-cl.mjs`.

La celda S2 que cubre Santiago/RM es **`967_buildings.csv.gz` (~950 MB comprimido)**:
`https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/967_buildings.csv.gz`

**En streaming, sin descomprimir a disco** (el VPS tiene espacio limitado): `https.get` → `zlib.createGunzip()` → parser CSV línea a línea → filtro bbox RM + `confidence >= 0.7` + `area >= 15 m²` → `COPY` con `pg-copy-streams`. Reanudable (checkpoint por nº de línea) e idempotente.

Ojo: el dataset es inferencia de **mayo 2023**. Tú solo cargas los datos; la lógica que evita penalizar construcciones posteriores es de P2.

**Hecho cuando**: footprints de la RM cargados y `parcel_footprint_stats_cl` poblada y consultable por `(comuna_id, rol)`.

## Reglas que no se rompen

- PRs pequeños (una pieza por PR) contra `main`.
- Migraciones idempotentes (`IF NOT EXISTS`, re-ejecutables).
- Tests con dependencias inyectadas.
- **Nunca** toques decisiones humanas (`decided_by='human'`, `manual_property_lock`, pins manuales) ni los snapshots crudos.
- **Nunca** edites archivos de otro puesto — si necesitas un cambio ajeno, pídelo en el PR.
- Tras cada merge a main: `git fetch origin main && git rebase origin/main`.
