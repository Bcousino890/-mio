# Plan — Módulo "Anuncios": scraping 24/7, deduplicación y trazabilidad de corredoras (Chile)

**v2.0 · 2026-07-21 · Documento de arranque para ejecutar en fases con Claude Code**

Este documento convierte el scraping manual/puntual de Portal Inmobiliario en un
**sistema 24/7 que se retroalimenta solo**, con deduplicación de propiedades y
trazabilidad completa de corredoras, integrado como el apartado **"Anuncios"**
del CRM. Cubre primero **Casas usadas en RM** (no proyectos nuevos), arrancando
el barrido en **Las Condes** y dejando la estructura lista para el resto de la
RM, Departamentos y Terrenos con la misma arquitectura.

**No es un documento desde cero**: gran parte de la ingesta, normalización y
motor de matching **ya existen en este repo**. La prioridad, en palabras del
usuario, es **"construir una buena base"** — cimientos correctos (esquema, dedup
determinista, discovery, orquestación, almacenamiento inmutable) antes que
features vistosas.

> **Cambios v1.0 → v2.0.** (a) Dedup reformulada en **2 niveles** (determinista
> + probabilístico) tras confirmar que `listings_cl` ya tiene `property_code`;
> (b) **terna de identificadores** formalizada (anuncio / propiedad / corredora);
> (c) decisiones del usuario integradas (media a bucket automático, cobertura
> Las Condes primero, cadencia 8h, worker en contenedor separado); (d) proveedor
> de storage definido y **provisionado**: Hetzner Object Storage (Helsinki);
> (e) proxy definido: **Evomi**; (f) huecos transversales de "buena base"
> añadidos (snapshots inmutables, normalización de datos sucios, resiliencia,
> observabilidad, almacenamiento eficiente, tests); (g) webs propias de
> corredoras vía adaptadores por CRM detectado (Convecta/Ofinet); (h) tabla de
> **qué modelo de Claude Code usar por fase**.

---

## 1. Lo que YA existe en `casafari-mio` (no reinventar)

| Pieza | Archivo(s) | Estado |
|---|---|---|
| Parser de ficha individual (blob `__NORDIC_RENDERING_CTX__`, no HTML plano) | `scraper/lib/parse-portalinmobiliario.mjs` | ✅ Implementado. `parseListPage()` existe pero **no verificado contra HTML real de listado** |
| Cliente API pública de Mercado Libre (`/sites/MLC/search`, `/items/{id}`) | `scraper/lib/ml-api-client.mjs` | ✅ Implementado; **sin confirmar en producción** si exige `access_token` |
| Mapeo scrape → `Listing` de la UI (moneda dual UF/CLP, comuna normalizada) | `scraper/lib/to-listing.mjs::toAppListingCl` | ✅ |
| Normalización UF/CLP dual + tasa del día | `scraper/lib/uf-rate-cl.mjs` | ✅ |
| Esquema de anuncios crudos Chile | `db/migrations/0028_listings_cl.sql`, `0033` (property_code+media) | ✅ Un anuncio = una fila, nunca se sobreescribe destructivamente |
| Registro de cambios entre corridas (altas/bajas/precio/agencia) | `0034_listing_version_log_cl.sql` | ✅ `listing_version_log_cl` — la trazabilidad de subidas/bajadas, YA modelada. **Falta alimentarla a escala** |
| Blocking laxo para pares candidatos | `scraper/lib/group-candidates-cl.mjs` | ✅ Deliberadamente sin exigir dormitorios/m² exactos |
| Motor de resolución de identidad (6 estrategias) | `scraper/lib/identity-resolution-cl.mjs` | ✅ `CL_IDENTITY_THRESHOLDS` = 0.75 confirmado / 0.45 candidato |
| Pares candidatos a misma propiedad física | `0028` → `listing_match_cl` | ✅ Solo pares, **sin clustering final** (H3) |
| pHash de fotos (reutilizable, agnóstico de país) | `scraper/lib/phash.mjs` | ✅ |
| Detección de CRM/web propia por patrón de URL (España) | `scraper/lib/crm-detector.mjs`, `0012/0013` | ♻️ Patrón reutilizable para webs de corredoras CL |
| Clustering por componentes conexos (España) | `scraper/lib/clustering.mjs`, `dedup-job.mjs` | ♻️ Copiar patrón para `_cl` (`graphology`) |
| Tabla `property` canónica (España) | `db/migrations/0004` | ♻️ Plantilla de `property_cl` |
| UI del apartado Anuncios | `web/app/chile/anuncios/AnunciosChileClient.tsx` + `/api/chile/anuncios` | ✅ Lista anuncios individuales (`transformChileRow`, `listing_count:1`) — **falta vista "1 propiedad, N corredoras"** |
| Cola de trabajos ya instalada | `pg-boss` en `scraper/package.json` | ⚠️ Instalada pero **sin cablear** — pieza clave para el 24/7 (H2) |
| Deploy VPS sin downtime | `.github/workflows/deploy.yml`, `infra/deploy.sh`, `infra/docker-compose.yml` | ✅ Hetzner **CX33 compartido** (Postgres+PostGIS, Redis, Nominatim propio CL, app, `zintoleads`), Helsinki. **Sin `mem_limit`** en servicios (solo redis maxmemory) |

**Conclusión clave:** el "programa avanzado de matching" ya está diseñado y en
gran parte escrito. Lo que falta no es el algoritmo — es (a) que el scraper
recorra Portal Inmobiliario **a escala y sin parar**, (b) que los pares
candidatos se conviertan en **propiedades canónicas**, (c) una **entidad
"corredora"** con historial, y (d) los cimientos transversales de una buena base
(snapshots inmutables, normalización, resiliencia, observabilidad).

---

## 2. Hallazgo que refuerza la base: dedup en 2 niveles

`db/migrations/0033` ya dotó a `listings_cl` de `property_code` (ID canónico de
la propiedad en Mercado Libre, **persiste cuando el anuncio se re-lista con nuevo
MLC-ID** — el caso de los ~45 días en arriendos), `advertiser_id` (seller_id) y
`seller_reference`, todos indexados. Esto habilita una arquitectura de dedup
mucho más robusta que el matching difuso solo:

- **Nivel 1 — determinista (barato, exacto).** Dos anuncios con el mismo
  `property_code` son la misma propiedad de la misma corredora (o su
  re-publicación). Match seguro, sin score. Resuelve el caso más común sin
  gastar cómputo.
- **Nivel 1.5 — determinista por código interno (H21).** Anuncio de PI ↔ ficha
  de la web propia de la corredora cuando coinciden misma corredora +
  mismo `seller_reference`. Edge sin score.
- **Nivel 2 — probabilístico (el que ya existe).** Para el caso difícil —la
  MISMA propiedad publicada por 10+ corredoras DISTINTAS, cada una con su
  `property_code`— se usa `group-candidates-cl.mjs` + `identity-resolution-cl.mjs`
  (triangula por teléfono/agencia/pHash/geo/huella física). El clustering final
  reutiliza **tal cual el patrón de España** (`clustering.mjs`: grafo
  `graphology` + componentes conexos + anti "black hole"): solo cambian la tabla
  origen (`listing_match_cl`) y destino (`property_cl`).

### 2.1 Terna de identificadores y trazabilidad (H9)

Requisito del usuario: identificar por separado **código del anuncio**, **código
de la propiedad** y **código de la corredora**, para contar con exactitud
subidas, re-publicaciones y actualizaciones. Los 3 ya se extraen y persisten;
aquí se formaliza su semántica:

| Identificador | Columna en `listings_cl` | Qué es | Estabilidad |
|---|---|---|---|
| **Código del anuncio** | `external_id` (MLC-id) | La publicación concreta | Cambia en cada re-publicación (~45 días) |
| **Código de la propiedad (ML)** | `property_code` | ID canónico de la propiedad en ML | Persiste entre re-publicaciones de la MISMA corredora |
| **Código interno de la corredora** | `seller_reference` | Referencia en el CRM de la corredora | Estable por corredora |
| **Código de la corredora** | `advertiser_id` (seller_id) | Identidad de la corredora en ML | Estable |

**Métricas derivables** (job/vista sobre `listings_cl` + `listing_version_log_cl`):
- **Subidas / re-publicaciones**: nº de `external_id` distintos por `property_code`.
- **Actualizaciones**: nº de filas en `listing_version_log_cl` por listing
  (agregables por `property_code` y por `advertiser_id`).
- **Altas/bajas**: `first_seen_at` / `taken_down_at` → tiempo real en mercado.
- **Multi-corredora** (mismo inmueble, distinto `advertiser_id`): se detecta en
  el Nivel 2 y marca "sin exclusividad / en canje".

---

## 3. Decisiones tomadas (usuario, 2026-07-18 → 2026-07-21)

1. **Media: descargar fotos a un bucket, 100% automático** (el worker sube, no
   el usuario) → pipeline de media con **dedup por contenido** (H7).
2. **Cobertura: estructura lista para TODAS las comunas RM, pero arrancar el
   barrido solo con Las Condes** → discovery **config-driven** vía
   `scrape_targets_cl` (H8); activar el resto = un `UPDATE`, sin tocar código.
3. **Cadencia: cada 8h** (3 pasadas/día) para comunas activas — columna
   `interval_hours` (default 8), ajustable por comuna.
4. **Worker: contenedor separado** en `docker-compose.yml`, con `mem_limit`
   propio, para que un scraper colgado no tumbe el CRM.
5. **Proxy residencial: Evomi** (geo Chile) — reemplaza SmartProxy/Geonode (H10).
6. **Storage: Hetzner Object Storage** (S3-compatible, Helsinki hel1), un único
   contrato cubre fotos + backups (H7/H20).

### 3.1 Storage — Hetzner Object Storage (PROVISIONADO ✅ 2026-07-21)

Dos buckets creados en **Helsinki (hel1)** — misma región que el VPS
`cosas.conducen`. Endpoint S3: `https://hel1.your-objectstorage.com`. Precio base
**€6,49/mes por cuenta** (no por bucket): un solo contrato cubre ambos. **NO** se
contrata Storage Box aparte — restic (backups) habla S3 nativo.

| Bucket | Visibilidad | Uso |
|---|---|---|
| `anuncios-bcp` | **Público (read-only)** | Fotos/media deduplicadas (H7) |
| `backups-bcp` | **Privado** | Dumps `restic` de Postgres (H20) |

**Seguridad de credenciales:** los Access/Secret Key S3 **NO se versionan
jamás** — viven solo en `.env` del VPS, ya cubierto por `.gitignore` (`.env*`).
Este documento solo referencia los **nombres de variables**. A poblar en el VPS
(mismo patrón `upsert_env` de `deploy.yml`):

```
# Fotos (bucket público)
HETZNER_S3_ENDPOINT=https://hel1.your-objectstorage.com
HETZNER_S3_REGION=hel1
HETZNER_S3_BUCKET=anuncios-bcp
HETZNER_S3_ACCESS_KEY=…        # solo en el VPS, nunca en git
HETZNER_S3_SECRET_KEY=…        # solo en el VPS, nunca en git

# Backups (bucket privado)
HETZNER_S3_BACKUP_BUCKET=backups-bcp
HETZNER_S3_BACKUP_ACCESS_KEY=…   # solo en el VPS, nunca en git
HETZNER_S3_BACKUP_SECRET_KEY=…   # solo en el VPS, nunca en git
```

---

## 4. Huecos y diseño de cada uno

### H0 — Confirmar supuestos (Fase 0, bloqueante, sin código nuevo)
- Spike rate-limit (`scraper/spike-rate-limit-vps.mjs`) contra VPS real →
  concurrencia segura, con y sin proxy **Evomi**.
- Spike API ML: ¿`/sites/MLC/search` y `/items/{id}` sin `access_token`?
- Subir 1 HTML real de listado de comuna → validar/terminar `parseListPage()`.
- Investigar el endpoint XHR real del listado de **Convecta** (H21).

### H1 — Discovery crawler (config-driven)
`scraper/lib/discovery-portalinmobiliario-cl.mjs` (nuevo): para cada fila
`enabled` de `scrape_targets_cl`, recorre
`/venta|arriendo/casa/propiedades-usadas/<comuna>-metropolitana`, pagina, extrae
`MLC-id`+URL, encola `detail:<id>` de los nuevos. Preferir API ML; fallback HTML.
Arranca solo con Las Condes activa.

### H2 — Orquestación 24/7
- `scraper/worker-cl.mjs` (nuevo): proceso Node persistente con `pg-boss` (cola
  sobre el mismo Postgres, sin Redis extra). Jobs:
  `discovery:<comuna>:<tipo>:<op>` (recurrente), `detail:<mlc_id>`,
  `identity-resolve:<listing_id>`, `dedup-cluster` (periódico),
  `broker-enrich:<advertiser_id>`, `media-sync:<listing_id>`.
- Servicio nuevo en `infra/docker-compose.yml` con `mem_limit` explícito (worker
  liviano: curl+parseo, **sin Playwright**, para caber en el CX33 de 8GB
  compartido).
- Detección de baja: MLC activo que no reaparece en el barrido de su comuna →
  `taken_down_at` + fila `delisted` en `listing_version_log_cl`.
- Retira el disparo manual por archivo centinela + GitHub Actions para este
  flujo (los workflows quedan solo para tareas puntuales/SII).

### H3 — Dedup 2 niveles + propiedad canónica `property_cl`
- Migración `property_cl` (plantilla `property` de 0004, sufijo `_cl`, comuna en
  vez de zone, UF/CLP, `location_confidence`). FK `listings_cl.property_cl_id`.
- Nivel 1: agrupar por `property_code` (+`advertiser_id`).
- Nivel 1.5: enlace por `seller_reference` (H21).
- Nivel 2: `scraper/lib/clustering-cl.mjs` (patrón `clustering.mjs`) sobre
  `listing_match_cl.status='confirmed'` → componentes conexos → `property_cl`.
- Consolidación "ganador": coords del listing con `location_confidence` más alta;
  m² moda; precio mínimo como "precio de mercado"; unión de portales.
- Cola de revisión manual para score intermedio (0.45–0.75).
- **Nivel 3 — matching MANUAL (migración 0079, IMPLEMENTADO):** el score nunca
  llega al 100%; el equipo mirando las fotos sí. Desde `/chile/propiedades` se
  arrastra una ficha sobre otra (o se marcan varias con el modo "Unir") y se
  fusionan en una sola; el reverso es "Separar" por aviso dentro de la ficha.
  - API: `POST /api/chile/property-cl/merge` y `.../split`
    (`web/lib/property-cl-merge.ts`).
  - La decisión humana PESA MÁS que el automático y no se revierte sola:
    `listings_cl.manual_property_lock` saca esos avisos del reagrupamiento de
    Nivel 1, y los pares quedan en `listing_match_cl` con `decided_by='human'`
    (`confirmed` al unir, `rejected` al separar) — que el feeder automático ya
    respetaba (`WHERE decided_by = 'auto'` en su upsert).
  - Trazabilidad: `property_merge_log_cl` guarda cada unión/separación con los
    avisos movidos y su ficha de origen (incluido el `ref_code` de la absorbida,
    que se borra al unir).

### H4 — Entidad corredora `corredoras_cl` + trazabilidad
- Migración `corredoras_cl`: identidad consolidada por `advertiser_id` (clave
  estable) + nombre normalizado + teléfonos. FK `listings_cl.corredora_id`.
- Métricas derivadas: stock activo, rotación (días a `delisted`), % exclusividad
  aparente, comunas de operación, historial de precios agregado.
- `web_propia_url` + `crm_platform` ('convecta'|'ofinet'|'other'): regex (patrón
  `crm-detector.mjs`) + detector de plataforma (H21) + enriquecimiento asistido.
- Ficha `/chile/corredoras/[id]` (nuevo): inventario en PI + web propia,
  plataforma CRM, inventario oculto, métricas.

### H5 — Ampliar UI Anuncios
- Vista "1 propiedad canónica, N corredoras" + timeline de precio.
- Pines por `property_cl` en el mapa (no por anuncio).
- Cola de revisión de matches dudosos (extender badges de confianza actuales).

### H6 — Cobertura
Casas usadas RM: piloto Las Condes → comunas prioritarias (Colina, Lo Barnechea,
La Reina, Vitacura, Peñalolén) → resto RM. Luego Deptos, luego Terrenos (mismo
pipeline, cambia el filtro de tipo en discovery).

#### H6.1 — Verificación de las 56 comunas de la taxonomía (2026-07-28)

Antes de activar comunas se sondearon EN VIVO las 56 de `chile-zones.ts`
(`/venta/casa/propiedades-usadas/<comuna>-<region>`, página 1 real). Resultado y
correcciones aplicadas:

| Comprobación | Resultado |
|---|---|
| Slug de URL válido | 52/52 RM ✅ · Zapallar y Puchuncaví ✅ · **Pucón y Villarrica ❌** (corregido) |
| Nombre del portal resuelve a la comuna | 55/56 ✅ · **Til Til ❌** (el portal escribe "Tiltil" — corregido con alias) |
| Anuncios de p1 que son de la comuna | 79–100% en las 56 (mínimo: Estación Central 79%) |

**Modo de fallo descubierto — un slug inválido NO da 404.** Portal Inmobiliario
ignora en silencio el segmento de comuna que no reconoce y sirve el listado
**NACIONAL** completo. Medido: `pucon-araucania` → `total=63.017` (todo Chile),
`pucon-la-araucania` → `total=726` (el real). Sin protección, `discoverTarget`
leía ese total nacional como "comuna que topa la paginación", la subdividía en
decenas de bandas de precio y encolaba miles de fichas de todo el país — días de
cola y GB de proxy para una comuna que nunca se barrió.

Tres correcciones, con test de regresión cada una:
1. **`regionSlug()`** se quedaba con la última palabra del nombre de región, lo
   que se comía el artículo ("Región de la Araucanía" → `araucania`). Ahora quita
   el prefijo "Región de/del" y **conserva el artículo** → `la-araucania`.
2. **Alias de comuna** (`aliases` en la taxonomía): "Tiltil" → `Til Til`. Sin
   esto sus anuncios entraban con `comuna_id` NULL, invisibles a los filtros y
   **fuera del `markDelisted`** (que filtra por comuna_id) — se quedaban activos
   para siempre. Replicado en `web/lib/chile-zones.ts` y `scraper/lib/chile-comunas.mjs`.
3. **Guarda `comunaMatchRatio`**: en la página 1 se mide qué fracción de los
   anuncios pertenece de verdad a la comuna del objetivo. Bajo el 50% se aborta
   el objetivo sin paginar, sin bisecar, sin encolar y sin dar bajas. Margen
   medido: comuna válida 79–100%, listado nacional 0–2%. Si `location_text`
   faltara (cambio de maquetado), la guarda se vuelve **inerte**, no bloqueante.

**Volumen que implica activar la RM entera** (casas en venta, medido el
2026-07-28): **35.369 anuncios** en 52 comunas — 10× el piloto de Las Condes
(3.472). Las 4 comunas fuera de la RM suman 2.876 más. A las ~15 fichas/min que
sostiene hoy la cola `detail-cl`, la puesta al día inicial son **~40 h de cola
solo para venta**, sin contar arriendo. No es un bloqueante, pero sí obliga a
escalar por tandas y no de golpe.

### H7 — Pipeline de media a bucket, con dedup de fotos
Requisito: **si la misma corredora re-publica las mismas fotos, NO guardarlas dos
veces** — solo subir las nuevas.
- **Almacén direccionado por contenido.** Migración `media_assets_cl`
  (`content_hash` sha256 PK · `phash` · `bucket_url` · `bytes` · `first_seen_at`
  · `ref_count`). El objeto en el bucket se nombra por su `content_hash` → una
  foto idéntica byte-a-byte existe **una sola vez**.
- Job `media-sync:<listing_id>`: descarga fotos (usa `fetchGalleryPhotos()` de
  `parse-portalinmobiliario.mjs`, las N del modal) → calcula `content_hash` +
  `phash` → **antes de subir** consulta `media_assets_cl`: si el hash existe,
  reusa `bucket_url` (sube `ref_count`), no re-sube; si hay un `phash` a Hamming
  ≤ umbral, misma imagen recomprimida. Solo sube lo genuinamente nuevo → rellena
  `stored_photos` + `media_synced_at` (columnas ya en 0033).
- En re-publicación (mismo `property_code`, nuevo MLC-id): procesa solo el
  **delta** de fotos nuevas.
- **Todo automático (worker), nunca manual**: el `GET` al CDN de ML y el `PUT` al
  bucket los hace el job por API. Config: variables `HETZNER_S3_*` (ver §3.1).

### H8 — Config de objetivos de barrido
Migración `scrape_targets_cl` (comuna_id FK, tipo, operacion, enabled,
interval_hours, last_run_at, priority), sembrada para toda la RM con solo Las
Condes activa. `worker-cl.mjs` lee esta tabla al programar los jobs de discovery.

### H10 — Proxy residencial: Evomi
- `scraper/lib/fetch.mjs` ya soporta proxy opcional → añadir perfil Evomi sin
  reescribir la capa. Config: `EVOMI_PROXY_HOST/PORT/USER/PASS` (geo CL).
- Dejar `SMARTPROXY_CL_*` como fallback legacy.
- El spike de Fase 0 mide % 429 sin proxy vs con Evomi → decide si el barrido a
  8h necesita proxy siempre o solo bajo bloqueo. Vigilar GB de Evomi como coste
  variable dominante.

### H11 — Fase final: sincronizar Anuncios con Catastro + captar-url
Con el pipeline al 100%, conectarlo con el visor catastral y captación por URL:
- **`property_cl` → capa "Oferta" del visor** (`/chile/catastro`): 1 pin por
  inmueble canónico (no por anuncio), coloreado por `location_confidence`.
- **Triangulación automática anuncio → Rol SII**: correr `identity-resolution-cl.mjs`
  (geocodificar dirección + point-in-polygon contra `cadastre_parcels_cl` +
  huella física contra `sii_roles_cl`) → asigna `rol_sii` candidato con confianza.
- **`/chile/captar-url`**: cuando el worker detecta un anuncio nuevo, dispara la
  misma resolución que hoy es manual → captación automática y retroalimentada.
- Al resolver el Rol, se cruza con lo ya cargado del SII (avalúo, dueño
  DealerNet, deuda TGR, ventas CBR).

### H12 — Machine Learning: diferido, pero base "ML-ready"
**Recomendación: NO construir ML en la base; sí prepararla.** El determinista
(Nivel 1) + score ponderado (Nivel 2) resuelve el MVP sin datos etiquetados que
aún no existen. Cómo se deja lista sin trabajo extra:
- La **cola de revisión manual** (H3, score 0.45–0.75) ES el etiquetado humano.
- `listing_match_cl.signals` (jsonb) ya persiste las features del par. Features +
  labels = dataset acumulándose solo. Guardar `decided_by` ('rule'|'human') + score.
- **Cuándo activarlo**: con volumen + miles de labels → clasificador de pares
  (gradient boosting) que afine los pesos manuales. La extracción NLP ya usa LLM
  (Claude Haiku), no requiere modelo propio.

### H21 — Webs propias de corredoras: scraper por corredora, reusable por CRM
Seguimos necesitando un **scraper configurado por corredora** (cada dominio es un
target que hay que registrar). Lo que SÍ se comparte es el **parser/adaptador**:
la mayoría de corredoras chilenas corren su web sobre uno de un puñado de CRM
inmobiliarios. Cuando el detector reconoce la plataforma, se reusa el adaptador
ya escrito — solo cambia el dominio.

**Footprints verificados con HTML real (curl directo):**
- **Convecta** (`magnoliaproperty.cl`): señal primaria
  `<meta name="author" content="Convecta Desarrollos Informaticos SpA">` en el
  `<head>` (más robusto que el footer "Desarrollado por Convecta"). Usa `.aspx`;
  listado por segmentos de carpeta (`/Todos_los_tipos/Venta_y_Arriendo/…`). El
  HTML estático del listado no trae enlaces a fichas → **JS/AJAX, pendiente
  confirmar endpoint en Fase 0**.
- **Ofinet** (`bpropiedades.cl`, `cympropiedades.cl`): footer "Designed by
  Ofinet"; listado `.asp` con querystring `select-*`.
- `ppartnersgroup.com` **NO** es Convecta ni Ofinet (CRM propio/otro).

Diseño:
- **Registro** `corredora_web_targets_cl` (dominio, `corredora_id`,
  `crm_platform`, `enabled`, `last_crawled_at`) — análogo a `scrape_targets_cl`.
- **Detector** `scraper/lib/detect-corredora-crm-cl.mjs` (extiende
  `crm-detector.mjs`): clasifica `convecta`/`ofinet`/`other`.
- **Adaptadores multi-tenant** `scraper/lib/crm-adapters/{convecta,ofinet}.mjs`:
  `crawlInventory(domain)` + `parseDetail(html)` de contrato común. **Un
  adaptador, N dominios registrados**.
- **Enlace determinista por código interno (Nivel 1.5).** Los anuncios de la web
  propia entran como `listings_cl` con `source_type='agency_web'`,
  `portal='web:<dominio>'` (0028 ya lo soporta).
- **Cross-corredora** sigue resolviéndose por Nivel 2 fuzzy, reforzado con las
  fotos/datos de las webs propias.

Beneficios: **trazabilidad total**, **inventario oculto** (leads de captación) y
**enriquecimiento** (más fotos, a veces dirección real → refuerza
`location_confidence`).

**Resolución del conflicto con H2 (worker sin Playwright)** — orden de intento:
1. **Investigar el endpoint JSON real primero** (Fase 0/4): si hay XHR detrás del
   AJAX de Convecta, el adaptador lo consume por HTTP normal, sin navegador en
   producción.
2. **Si no hay endpoint viable**: proceso Playwright **separado y acotado**
   (`mem_limit` propio, 1 instancia, cadencia baja/diaria), servicio aparte en
   `docker-compose.yml`.
3. El enlace básico PI↔web-propia por código interno **no depende de esto**: la
   ficha individual suele ser HTML estático. El navegador solo hace falta para el
   "inventario oculto" completo.

### H22 — Piezas que faltaban tras repasar el plan completo
- **Rate-limit propio para webs de corredoras**, más suave que PI (sitios chicos):
  concurrencia 1, delay generoso, sin proxy. Config en `crm-adapters/*.mjs`.
- **Endpoints API nuevos** para la UI (H5): `/api/chile/property-cl`,
  `/api/chile/corredoras`, `/api/chile/corredoras/[id]`.
- **Backfill de lo ya scrapeado a mano**: `listings_cl` ya tiene filas del
  scraping manual (sin `property_cl_id`, sin `corredora_id`, sin fotos en bucket).
  Job explícito de backfill (Fase 1-3): correr Nivel 1+2 de dedup y media-sync a
  lo existente, no solo a lo nuevo.
- **Criterio de éxito antes de escalar de Las Condes al resto RM** (gate): ver §6.

---

## 5. Piezas transversales de una "buena base"

Verificado contra el código: NO están cubiertas hoy. Entran distribuidas en las
fases, no como bloque final.

- **H13 · Snapshots crudos inmutables.** Hoy `listing_version_log_cl` registra
  *cambios*, no el JSON crudo de cada scrape (principio "nunca sobrescribir datos
  crudos"). Migración `listing_snapshots_cl` (`listing_id`, `captured_at`,
  `content_hash`) particionada por mes + `snapshot_blobs_cl(content_hash PK,
  raw_json)`. La propiedad canónica se *deriva* de aquí.
- **H14 · Normalización y validación de datos sucios** (dolor central: coords/m²/
  precio con error). Capa explícita:
  - `geo_confidence`/pin-sospechoso: pin sobre centroide de comuna, decimales
    redondos, clusters de agencias distintas en el mismo lat/lng → baja confianza
    (alimenta `location_confidence`, columna ya existe).
  - Superficies: `m2_utiles > m2_totales` → flag/invertir; outliers (8 / 8.000 m²).
  - Precio: normalizar UF↔CLP a la fecha del snapshot; detectar saltos anómalos.
- **H15 · Historial de precios como serie.** Vista/derivado sobre
  `listing_snapshots_cl` + `listing_version_log_cl` → timeline por listing y por
  `property_code` (bajadas = señal comercial). Alimenta la UI (H5).
- **H16 · Resiliencia del scraper.** Reintentos con backoff + dead-letter en
  `pg-boss`; circuit-breaker por dominio en `fetch.mjs`; respetar `robots.txt` y
  rate-limit cortés. Hoy `fetch.mjs` no tiene backoff/circuit-breaker.
- **H17 · Observabilidad y alertas.** Health/heartbeat del worker; métricas de
  cobertura (nº scrapeado por comuna vs el contador del portal, ej. 3.741 en Las
  Condes); **alerta de parser roto** (caída súbita de campos = ML cambió el
  layout del blob Nordic); dead-man switch si una comuna no corre en >2 ciclos.
- **H18 · Almacenamiento eficiente: guardar TODO, que pese poco.**
  - **Snapshot solo-al-cambiar + direccionado por contenido**: `content_hash` del
    JSON normalizado; si es idéntico al último → no se inserta fila, solo se
    actualiza `last_seen_at`. Blobs una vez en `snapshot_blobs_cl`. 90 scrapes
    idénticos ≈ 1 blob, no 90 copias. Nada se pierde (queda la fila-puntero).
  - **Compresión nativa**: JSONB + TOAST/lz4; zstd para los blobs grandes.
  - **Particionado mensual + cold storage**: particiones viejas se comprimen y
    pasan a tier frío (no se borran).
  - **Media siempre en el bucket (H7), nunca en disco del VPS**.
- **H19 · Tests y fixtures del parser.** Fixtures de HTML real (listado + ficha) +
  tests de regresión de `parseListPage()` / `parseDetailPage()`. Hoy solo hay
  tests de fotos/watermark. Blindaje ante cambios de maquetado de ML.
- **H20 · Costos y capacidad.** VPS CX33 ya existente + GB de Evomi + Hetzner
  Object Storage (~€6,49/mes base, único contrato fotos+backups) + LLM Haiku.
  `mem_limit` del worker; vigilar disco LOCAL (solo snapshots deduplicados +
  índices, nunca fotos ni dumps crudos). **Backups de Postgres** vía `restic` con
  backend S3 al bucket privado `backups-bcp` — no se contrata Storage Box aparte.

---

## 6. Orden de ejecución por fases

- **Fase 0** (bloqueante, sin código): H0 — spikes rate-limit + API ML + validar
  `parseListPage()` + investigar endpoint XHR de Convecta (H21).
- **Fase 1** (la base de datos entra): migraciones `scrape_targets_cl` (H8,
  sembrada RM, solo Las Condes) + `property_cl` (H3) + `corredoras_cl` (H4) + FKs
  en `listings_cl`. Discovery crawler (H1) + upsert que alimenta
  `listing_version_log_cl`. Piloto Las Condes end-to-end en local. **Backfill**
  (H22) de las filas ya scrapeadas a mano.
- **Fase 2**: worker 24/7 separado (H2) + `pg-boss` cableado + pipeline media al
  bucket (H7). Poblar secrets `HETZNER_S3_*` + `EVOMI_*` en el VPS. `mem_limit` en
  el nuevo servicio. Backfill de media-sync sobre fotos ya existentes.
- **Fase 3**: dedup 2 niveles → `property_cl` (H3) + cola de revisión manual.
  **Gate de éxito** antes de Fase 6: cobertura ≥90% vs conteo del portal para la
  comuna; muestra de clusters `property_cl` revisada sin falsos positivos
  evidentes; 0 alertas de parser roto durante ≥3 ciclos de 8h seguidos.
- **Fase 4**: consolidación `corredoras_cl` + métricas + `web_propia_url` + ficha
  `/chile/corredoras/[id]` (H4). Adaptadores Convecta/Ofinet + rate-limit suave
  (H22) + enlace por código interno + crawl de webs propias + inventario oculto
  (H21, navegador acotado solo si el endpoint JSON no apareció en Fase 0).
- **Fase 5**: UI "1 propiedad, N corredoras" + pines por `property_cl` + revisión
  de dudosos (H5) + endpoints `/api/chile/property-cl`, `/api/chile/corredoras[/id]`.
- **Fase 6**: si se cumple el gate de Fase 3, activar más comunas (`UPDATE` en
  `scrape_targets_cl`) → resto RM → Deptos → Terrenos (H6).
- **Fase 7 (final)**: sincronizar con `/chile/catastro` (capa Oferta =
  `property_cl`) + triangulación automática anuncio→Rol SII + captación
  automática vía `/chile/captar-url` (H11).

---

## 7. Qué modelo de Claude Code usar por fase

Regla: **Opus** donde una decisión de diseño mal tomada es cara de arreglar
después (ambigüedad real, umbrales, casos borde); **Sonnet** para ejecución sobre
patrones ya claros.

| Fase | Modelo | Por qué |
|---|---|---|
| 0 (spikes, endpoint Convecta) | **Opus** | Interpretar evidencia y decidir arquitectura (proxy sí/no, JSON vs navegador). |
| 1 (migraciones + discovery) | Sonnet | Copia patrones existentes (`property` de 0004). |
| 2 (worker, pg-boss, media) | Sonnet | Infra acotada y bien definida. |
| 3 (dedup 2 niveles) | **Opus** para umbrales/casos borde, Sonnet para implementar | Un umbral mal puesto contamina el dataset. Mayor riesgo del sistema. |
| 4 (corredoras + adaptadores) | Sonnet, subir a Opus si hay anti-bot no trivial | Scraping iterativo sobre HTML real. |
| 5 (UI Anuncios/Corredoras) | Sonnet | Hay componente similar para calcar. |
| 6 (activar comunas, Deptos/Terrenos) | Sonnet, incluso Haiku para lo repetitivo | Bajo riesgo si el gate de Fase 3 validó el pipeline. |
| 7 (triangulación anuncio→Rol SII) | **Opus** para diseñar, Sonnet para implementar | Toca datos catastrales sensibles (dueños, deuda TGR). |

---

## 8. Principios de diseño (no negociables)

1. **Nunca se sobrescribe un snapshot crudo.** `listings_cl` se actualiza, pero
   cada cambio deja huella en `listing_version_log_cl`, y el JSON crudo queda
   append-only en `listing_snapshots_cl` (H13).
2. **`location_confidence` nunca se asume, se calcula** (`identity-resolution-cl.mjs`).
3. **El blocking chileno es deliberadamente laxo** — no "arreglarlo" para que se
   parezca al de España.
4. **Todo objeto nuevo de Chile usa sufijo `_cl`**, en paralelo a España.
5. **El VPS es compartido y de 8GB** (CX33): todo proceso 24/7 nuevo con
   `mem_limit` explícito y sin navegador headless en el worker principal.
6. **API de Mercado Libre como fuente preferida, HTML/Nordic blob como fallback.**
7. **Los secretos jamás se versionan** — solo en `.env` del VPS (`.gitignore`).

---

## 9. Verificación (al ejecutar cada fase)

- **Fase 0**: correr los spikes, documentar % 429 y acceso API en este doc.
- **Fase 1**: `node worker-cl.mjs` en local con `DATABASE_URL` de prueba →
  verificar filas nuevas en `listings_cl` + `listing_version_log_cl` para 1 comuna.
- **Fase 2**: verificar que `media-sync` sube a `anuncios-bcp` y que una segunda
  pasada con las mismas fotos NO crea objetos nuevos (dedup por `content_hash`).
- **Fase 3**: tras un barrido, `SELECT count(*) FROM property_cl` y revisar que un
  cluster real agrupe listings de ≥2 corredoras distintas correctamente.
- **Smoke en deploy**: `infra/deploy.sh` ya prueba `/chile` y `/chile/sii-mapasui`;
  añadir `/chile/anuncios` y `/chile/corredoras`.

---

**Próximo paso inmediato:** ejecutar **Fase 0** (spikes rate-limit + API ML +
validar `parseListPage()` + endpoint Convecta) y traer los resultados a este doc
antes de tocar código de discovery/orquestación.
