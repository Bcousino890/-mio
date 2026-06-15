# PLAN MAESTRO — Plataforma de Captación + Análisis Inmobiliario (CASAFARI/LYSTOS-like), Madrid Fase 1

**Documento de referencia del proyecto · CTO · v1.0 · 2026-06-13**
**Hardware objetivo: 1× Hetzner CX43 (8 vCPU / 16 GB / 160 GB / 20 TB tráfico).**

> Nota de integración: los 6 informes de los arquitectos son sólidos y mayoritariamente convergentes (HTTP-first, RC20 como clave canónica, Postgres como centro de gravedad, IA como fallback). Hubo **dos conflictos reales resueltos con autoridad**: (a) el reparto de RAM no cuadra cuando se suman todos los límites de los expertos; (b) discrepancia sobre orquestación (Docker Compose vs systemd) y sobre embeddings locales vs no-IA-pesada. Las decisiones del CTO se marcan con **[DECISIÓN CTO]**.

---

## 1. Visión y alcance del MVP

**Qué es el producto:** un motor que convierte anuncios anonimizados de portales en **inmuebles físicos identificados por Referencia Catastral (RC20)**, deduplicados cross-portal, y los expone como (a) **leads de captación accionables** y (b) **analítica de mercado por barrio**. No es un portal de anuncios. El RC20 es lo que ningún competidor sin resolución catastral puede hacer bien, y es el pivote de todo.

### ENTRA en la v1 (Madrid, meses 1–4)
- **Cobertura geográfica:** **provincia de Madrid completa** (no solo capital 28079). El warm-up de caché y la geometría INSPIRE de la provincia caben (≈5–7 GB). [DECISIÓN CTO]
- **Operación:** **venta + alquiler** (el saneado de outliers se parametriza por operación).
- **Portales:** Idealista, Fotocasa, Habitaclia, pisos.com, Milanuncios + long-tail de webs de agencia (sitemaps). Reaprovechamos el scraper de particulares existente envolviéndolo en el orquestador.
- **Motor RC:** point-in-polygon (círculo→RC14) + enriquecimiento Catastro (DNPRC/RCCOOR) + matcher RC14→RC20 con score. RC20 como clave canónica de dedup (umbral ≥0.80).
- **Lead Flow (núcleo comercial):** particulares nuevos, **exclusivas rotas** (mismo RC20, ≥2 agencias), "particular tras agencia", reapariciones, bajadas de precio. Filtros zona/precio/tipo. Push al CRM existente.
- **Análisis de mercado:** €/m² mediano por barrio/distrito, time-on-market, descuentos, stock activo, mapa de calor (ST_AsMVT).
- **AVM v1:** comparables por RC + modelo hedónico log-lineal por barrio con intervalos. **Informe PDF de valoración** marca blanca (gancho de captación).
- **API REST v1** (FastAPI) + watchlists con alerta diaria por email/CRM.

### NO entra en v1 (Fase 2+)
- AVM ML (LightGBM), valor de cierre calibrado contra transacciones reales.
- Predicción de demanda/absorción avanzada (no tenemos datos de demanda; honestidad obligatoria).
- Descarga/análisis de imágenes (solo guardamos URLs + pHash).
- Embeddings semánticos para dedup (el RC20 + dedup heurística cubren el MVP). **[DECISIÓN CTO: embeddings a Fase 2]** — ver §6.
- Multi-provincia/multi-ciudad fuera de Madrid; alta disponibilidad; intradía near-real-time global.
- Solver de CAPTCHA permanente (se activa solo si Idealista lo exige; partida separada).

---

## 2. Arquitectura global (flujo extremo a extremo)

```
                          ┌──────────────────────────── HETZNER CX43 (1 nodo) ────────────────────────────┐
                          │                                                                                │
 PORTALES                 │   CAPA DE CAPTURA                          MOTOR RC + DEDUP                     │
 Idealista (DataDome)─┐   │   ┌───────────────────┐                   ┌──────────────────────┐             │
 Fotocasa (CF)        │   │   │ worker-scrape      │   q:detail        │ worker-resolve       │             │
 Habitaclia           ├───┼──▶│ Scrapy 2.11 +      │──┐ (Redis)        │ 1) PIP círculo→RC14  │             │
 pisos.com            │   │   │ curl_cffi (TLS)    │  │                │   (PostGIS GIST)     │             │
 Milanuncios          │   │   │ + Playwright/      │  │  ┌──────────┐  │ 2) DNPRC/RCCOOR      │             │
 webs agencia ────────┘   │   │   patchright (Idea)│  └─▶│  REDIS 7 │◀─┤   (IP directa VPS)   │             │
   ▲ proxy Geonode ES     │   │ JSON-LD/CSS parse  │     │ 3 colas  │  │ 3) match→RC20+score  │             │
   │ (solo portales)      │   └─────────┬──────────┘     │ +cache RC│  └──────────┬───────────┘             │
   │                      │             │ items          │ +budget  │             │ rc20+conf              │
 CATASTRO / INSPIRE       │             ▼                └──────────┘             ▼                         │
 (IP directa, gratis) ────┼────▶ ┌─────────────────────────────────────────────────────────────┐          │
   - ATOM (geom mensual)  │      │   POSTGRESQL 16 + POSTGIS 3.4   (centro de gravedad)          │          │
   - DNPRC/RCCOOR (1 rps) │      │   cadastre.parcel/unit · listing · property(rc20 UNIQUE)      │          │
                          │      │   listing_price_history (part. mes) · job_queue (SKIP LOCKED) │          │
 OPENROUTER (IP directa) ─┼─────▶│   mv_* (vistas materializadas, pg_cron 04:00)                 │          │
   Gemini 2.5 Flash-Lite  │      └───────────────┬───────────────────────────┬───────────────────┘          │
   (fallback parsing)     │                      │ consolidate               │ analytics/AVM               │
   via worker-ai gateway  │                      ▼                           ▼                              │
                          │              ┌───────────────┐          ┌──────────────────┐                   │
                          │              │ property dedup│          │ AVM hedónico +    │                   │
                          │              │ time-on-market│          │ MV mercado + PDF  │                   │
                          │              └───────┬───────┘          └────────┬─────────┘                   │
                          │                      │                           │                             │
                          │                      ▼                           ▼                             │
                          │              ┌─────────────────────────────────────────────┐                  │
                          │              │ API REST v1 (FastAPI/uvicorn) · Caddy TLS    │                  │
                          │              │ /properties /areas /valuation /leads /export │                  │
                          │              └───────────────┬─────────────────────────────┘                  │
                          └──────────────────────────────┼────────────────────────────────────────────────┘
                                                          │ JWT (CRM) / API-key (B2B) / webhooks HMAC
                                                          ▼
                                              CRM PROPIO existente  +  clientes B2B externos
```

**Flujo lógico (1 anuncio):** discovery (listado, HTTP barato) → detecta nuevo/cambio → `q:detail` → ficha (JSON-LD; IA solo si falta dato) → `listing` + snapshot → `resolve_rc` (PIP local) → `enrich_dnprc` (Catastro, cacheado) → `consolidate` (property por RC20) → series/eventos → de noche `analytics`/AVM refrescan MVs → API/CRM. **El 90% de precio/retirada se detecta en el listado, sin bajar a ficha** (ahorro de GB de proxy, que es el coste dominante).

---

## 3. Stack tecnológico definitivo

| Componente | Tecnología | Versión | Por qué |
|---|---|---|---|
| SO | Ubuntu LTS | 24.04 | Soporte largo, kernel reciente para cgroups v2. |
| Orquestación | **Docker Compose v2** | plugin actual | **[DECISIÓN CTO]** Resuelve el conflicto SRE-vs-resto: Compose da `mem_limit`/`cpus` declarativos por servicio (crítico para evitar OOM de Postgres), healthchecks y rollback. systemd solo para arrancar el stack al boot + timer de backups. NO k3s (roba ~1–1.5 GB). |
| Base de datos | **PostgreSQL + PostGIS** | **PG 16 + PostGIS 3.4** | Único almacén de estado: relacional + geoespacial + cola (SKIP LOCKED) + cache analítica (MV). Los 6 expertos convergen aquí. |
| Pool de conexiones | **PgBouncer** | 1.22+ | Transaction pooling: 80 conexiones físicas reutilizadas, evita explosión de `work_mem`. Obligatorio. |
| Cola/cache | **Redis** | 7.4 | 3 colas (scrapy-redis) + cache resoluciones RC + contador presupuesto IA + rate-limit. `maxmemory 768MB`, `noeviction` en colas. |
| Scraping HTTP | **Scrapy + curl_cffi** | Scrapy 2.11 / curl_cffi ≥0.7 | curl_cffi impersona TLS/JA3 + HTTP/2 de Chrome (clave vs DataDome/Cloudflare). Camino barato para Fotocasa/Habitaclia/pisos/Milanuncios. |
| Scraping JS | **Playwright + patchright** | PW 1.49 | SOLO Idealista/DataDome. Máx **2 navegadores**. Patrón cookie-harvesting → inyección en curl_cffi. |
| Parsing | selectolax + parsel | actual | selectolax (lexbor) 5–10× más rápido que BeautifulSoup. JSON-LD primero (0 tokens IA). |
| GIS import | **GDAL/ogr2ogr** | 3.8+ | Carga INSPIRE GML por municipio, `PG_USE_COPY YES -gt 50000`, reproyecta a EPSG:25830. |
| Backend/API | **FastAPI + Uvicorn/Gunicorn** | FastAPI 0.115 / uvicorn 0.34 | ASGI, Pydantic v2, OpenAPI auto. Un solo runtime Python con el ecosistema GIS. |
| ORM/migraciones | SQLAlchemy 2.0 + GeoAlchemy2 / Alembic | 2.0.x / 1.14 | Core async en hot paths; versionado de esquema. |
| Reverse proxy | **Caddy** | 2.8 | TLS automático, HTTP/2, menos RAM que nginx. |
| Scheduler | **pg_cron** + Arq | actual | pg_cron para MV/AVM nocturnos; Arq (Redis) para jobs de scraping. |
| AVM | statsmodels/scikit-learn (hedónico); LightGBM (Fase 2) | actual | OLS log-lineal en segundos; LightGBM <2 min, entrenado offline. |
| PDF | WeasyPrint | 62+ | Informe de valoración, coste 0 de infra. |
| IA | **OpenRouter** (Gemini 2.5 Flash-Lite + Qwen3-8B) | API | Fallback de parsing/clasificación. Gateway propio con kill-switch. |
| Monitorización | **Netdata** | actual | Un agente (~300 MB). NO Prometheus+Grafana (robaría ~2 GB). |
| Backups | restic → Hetzner Storage Box BX11 | actual | pg_dump+zstd diario, GFS. INSPIRE no se backupea (re-descargable). |
| CI/CD | GitHub Actions → GHCR → ssh deploy.sh | — | Build en runners de GitHub; el VPS solo hace `compose pull && up -d`. |
| Object storage | (Fase 2, solo si se descargan imágenes) Cloudflare R2 / Hetzner OS | — | En v1 NO se descargan imágenes → no necesario aún. |

**Lenguaje único: Python 3.12** en scraping, motor RC, API y workers. Reduce carga cognitiva y consumo.

---

## 4. Modelo de datos (clave canónica RC20)

Tres niveles + cola, todo en un único PostgreSQL.

```
catastro_building (RC14)         catastro_unit (RC20)             property (ficha canónica)
─ rc14 PK char(14)        1───N  ─ rc20 PK char(20)        1───1? ─ id PK
─ geom (MultiPolygon,25830)      ─ rc14 FK                        ─ rc20 UNIQUE  ◀── CLAVE DEDUP DURA
─ centroid, n_units              ─ floor_label, door              ─ rc14 (fallback edificio)
─ floors_above (BuildingPart)    ─ area_built_m2, use_type        ─ resolution_status/score
   (de INSPIRE BU + DNPRC)       ─ enriched_at (lazy DNPRC)       ─ market_status, lead_type
                                                                  ─ current_price, first/last_seen
            ▲ PIP                          ▲ match m²/planta              ▲
            │ (círculo)                     │ → rc20+score                │ 1:N
   listing (anuncio en portal, append-only de observaciones)              │
   ─ id PK · property_id FK (NULL hasta resolver)                         │
   ─ portal · external_id · url · operation (sale|rent)                   │
   ─ raw_price/area_m2/rooms/floor · circle_geom(Polygon,25830) · blur_radius_m
   ─ advertiser_type (private|agency) · advertiser_phone_hash (sha256)  ◀── captación
   ─ confidence_rc20 · status (active|gone) · first/last_seen
        │
        ├─ listing_price_history (listing_id, observed_at, price)  PARTITION BY RANGE(mes) + BRIN
        └─ listing_snapshot (listing_id, captured_at, content_hash, raw_json)  retención 90d, DROP PARTITION

   cadastre.cat_cache (cache_key, service, response jsonb, ttl)   ◀── escudo rate-limit Catastro
   job_queue (job_type, payload, state, priority, run_after, attempts)  ◀── cola SKIP LOCKED
   ad_resolution (ad_id, rc14, rc20, method, confidence, candidates jsonb) ◀── resultado motor
   watchlist / alert_queue / alert_delivery   ◀── tracking
   ai_budget (month, hard_limit_eur, spent_eur, status) · llm_cache (content_hash, task, output_json)
```

**Reglas canónicas (no negociables):**
1. **RC20 = clave de deduplicación.** `property.rc20 UNIQUE`. Dos anuncios (Idealista + Fotocasa) con mismo RC20 → mismo `property_id`.
2. **RC14 ≠ RC20.** Nunca dedup por RC14 (daría miles de falsos positivos: todo el edificio colapsaría). Pisos idénticos indistinguibles → RC14 + sub-cluster de candidatos, `confidence ≤0.6`, **no se asigna RC20**.
3. **Umbral de confianza ≥0.80** para promover RC14→RC20 y para que un match alimente exclusivas rotas/comparables. 0.55–0.80 = "probable" (precaución). <0.55 = solo RC14.
4. **Geometría en EPSG:25830** (ETRS89/UTM30N) en almacenamiento; reproyectar la entrada del anuncio (4326) en consulta. GeoJSON/4326 hacia fuera en la API.
5. **`listing` append-only de observaciones** para series temporales (TOM, descuentos, reapariciones). NO UPDATE destructivo de precio.
6. **INSPIRE crudo se procesa y se descarta**; solo se persiste geometría (simplificada con `ST_SimplifyPreserveTopology` tol. 0.5 m) + RC14. RC20 NO está en INSPIRE → DNPRC, cacheado permanente.
7. **PII mínima:** teléfono se guarda hasheado (`advertiser_phone_hash`) para dedup de anunciante; el número en claro solo donde haya base legal y con TTL de borrado (ver §9).

Particionado mensual de `listing_price_history` y `listing_snapshot` con pg_partman. Índices que importan: `GIST(parcel.geom)`, `GIST(listing.circle_geom)`, `BTREE UNIQUE(rc20)`, `BTREE(rc14)`, `GIN(pg_trgm)` para fallback texto, `BRIN(observed_at)`.

---

## 5. Reparto de recursos del VPS (16 GB / 8 vCPU / 160 GB)

**Conflicto resuelto:** los 6 expertos, sumados ingenuamente, piden ~18–20 GB de RAM. **[DECISIÓN CTO]** Reparto único y vinculante con `mem_limit` reales. Clave: **Postgres y Chromium nunca pican a la vez en pico**; el worker de embeddings NO existe en v1; el browser está capado a 2 instancias.

### RAM (presupuesto duro — la RAM no se oversuscribe, mata por OOM)

| Servicio | RAM límite | RAM típica | Notas |
|---|---:|---:|---|
| postgres + PostGIS | **6.5 GB** | 4–5 GB | `shared_buffers=4GB`, `effective_cache_size=9GB`, `work_mem=32MB`, `maint_work_mem=1GB` (2GB solo en carga INSPIRE), `max_connections=80`. |
| PgBouncer | 0.1 GB | 30 MB | Transaction pooling. |
| redis | 1.0 GB | 0.3–0.6 GB | `maxmemory 768MB`. |
| api (gunicorn 3–4 uvicorn) | 1.2 GB | 0.5 GB | No CPU-bound; sirve de MV. |
| worker-scrape (Scrapy/curl_cffi, 3–4 proc) | 2.2 GB | 1.5 GB | Caballo de batalla; capado por proxy, no CPU. |
| worker-resolve (PostGIS + Catastro I/O) | 1.0 GB | 0.6 GB | Ráfagas PIP; limitado por rate-limit Catastro (1 rps). |
| Playwright/Chromium (Idealista) | **1.5 GB** | 0.7 GB | **Máx 2 navegadores.** Cgroup propio. Solo cookie-harvesting + fichas duras. |
| worker-ai (gateway OpenRouter) | 0.4 GB | 0.2 GB | Solo orquesta HTTP. |
| scheduler (Arq) + pipelines | 0.3 GB | 0.1 GB | |
| caddy | 0.2 GB | 80 MB | |
| netdata | 0.4 GB | 0.25 GB | dbengine 1 GB disco, retención 5–7 d. |
| SO + page cache + margen OOM | **0.8 GB** | — | journald, fail2ban. |
| **TOTAL límites** | **~16.0 GB** | ~9–10 GB típico | Deja ~6 GB de holgura en operación normal. |

> **Regla dura:** si Idealista necesitara >2 navegadores, **NO se sube el límite** — es la señal de escalar (separar Playwright a un 2º VPS CX22). El worker de embeddings de Fase 2 también obligará a separar nodo o reducir browser.

### vCPU (oversubscription intencionada — scrape/resolve son I/O-bound)

| Servicio | cpus límite | | Servicio | cpus límite |
|---|---:|---|---|---:|
| postgres | 4.0 | | worker-resolve | 1.5 |
| worker-scrape | 2.5 | | api | 1.0 |
| Chromium | 1.5 (picos) | | redis / caddy / resto | 1.0 |

Suma de límites ≈12 > 8 a propósito; el CFS reparte. La regla dura es la RAM, no la CPU.

### Disco (160 GB)

| Componente | Inicial | Crecimiento | Notas |
|---|---:|---|---|
| SO + imágenes Docker | ~12 GB | lento | |
| INSPIRE Madrid en PostGIS (geom simplificada + GIST) | **~7 GB** | estable (refresco trimestral) | Provincia completa. España entera NO cabe. |
| BD anuncios + property + RC | ~2 GB | ~1 GB/mes | |
| listing_price_history (append-only, particionado) | ~1 GB | **~2–3 GB/mes** | El que más crece; particiones >24 m a cold storage. |
| listing_snapshot (JSON, no HTML) | rolling | retención 90 d | DROP PARTITION mensual. |
| Redis dump + WAL (max 4 GB) + logs (capados) + netdata | ~7 GB | acotado | |
| **Imágenes de anuncios** | **0** | **0** | **NO se descargan** (solo URLs + pHash). Regla dura. |
| **Usado mes 0 / margen** | **~30 GB** | **~3–4 GB/mes neto** | Se llena (a 130 GB, 20% libre) en **~24+ meses**. Holgado para Madrid. |

---

## 6. Capa de IA (OpenRouter, presupuesto duro <€30/mes)

**Principio:** el LLM es el último recurso. ~80% del pipeline (particular/agencia, teléfono, PIP catastral, matching numérico m²/planta) se resuelve con **regex/reglas/PostGIS, 0 tokens**. El LLM solo entra donde el texto libre es genuinamente ambiguo.

### Dónde SÍ usa LLM
1. **Extracción/normalización de campos** desde descripción libre (planta "entreplanta", m² útiles vs construidos, orientación) cuando el parser falla (~60% de anuncios nuevos, no del stock).
2. **Desambiguación RC20** cuando hay 2–4 unidades candidatas y los números no deciden (~15%). **El LLM nunca inventa un RC20; solo elige entre candidatos que PostGIS/Catastro ya devolvieron.**
3. **Clasificación particular/agencia** en el residuo ambiguo (<5%) y estado del inmueble.
4. **Texto narrativo del informe PDF** de valoración (1 llamada corta por informe).

### Modelos
| Rol | Modelo OpenRouter | $/1M in | $/1M out | Uso |
|---|---|---:|---:|---|
| **Workhorse** | `google/gemini-2.5-flash-lite` | **$0.10** | **$0.40** | Extracción, desambiguación, narrativa PDF. ✅ precio verificado jun-2026. |
| Tier barato | `qwen/qwen3-8b` | $0.05 | $0.20 | Clasificaciones fáciles. |
| Embeddings | **NO en v1** | — | — | **[DECISIÓN CTO]** A Fase 2. El RC20 + dedup heurística (pHash + trigram + precio/m²) cubren el MVP sin gastar la RAM de bge-m3 (~1.2 GB). |

### Cálculo de coste (caso ALTO: 12.000 anuncios nuevos/mes, sin contar caching)
- Extracción texto libre: 7.200 llamadas → $0.94
- Desambiguación RC20: 1.800 → $0.21
- Clasificación (Qwen3-8B): 3.000 → $0.06
- Narrativa PDF: 500 → $0.16
- **Total ≈ $1.4/mes ≈ €1.3.** Con headroom 3× (retries, A/B): **~€4/mes.** Doblando volumen a 24k: **~€8–11/mes.**

**El tope de €30 es cinturón de seguridad, no restricción operativa.** El coste variable real del proyecto es el proxy, no el LLM.

### Control de presupuesto duro (gateway propio `worker-ai`, ningún módulo llama directo a OpenRouter)
Pipeline del gateway: `rules-gate` (¿hace falta LLM?) → `cache lookup` (sha256 de descripción normalizada en `llm_cache`, hit = $0) → `budget check` → `routeModel` → llamada con `response_format: json_schema` → registrar `usage` real → `cache write`.
- **Soft limit €20:** deja de escalar a Flash-Lite en tareas no críticas, degrada a Qwen3/reglas, alerta.
- **Hard limit €28:** rechaza toda llamada LLM, devuelve `fallback_rules_only`; el pipeline sigue con reglas (degradación elegante).
- **Red de seguridad redundante:** límite de gasto fijado en la propia cuenta/API-key de OpenRouter.
- **Idempotencia:** `idempotency_key = content_hash+task`, máx 1 reintento. Reset mensual del contador.
- **Validación cruzada anti-alucinación:** un m² extraído por LLM se contrasta contra Catastro; si discrepa >umbral, se descarta.

---

## 7. Coste mensual total (Fase 1, Madrid)

| Partida | Detalle | €/mes |
|---|---|---:|
| **VPS** | Hetzner CX43 (8 vCPU/16GB/160GB/20TB) | **12** |
| **Proxies residenciales** | Geonode, 35–55 GB/mes. Plan 50 GB = $50 (≈€46) o Scale $0.45/GB / Business $0.50/GB. Standard 50 GB = $50/mes; extra $1/GB ⚠️ vigilar overage. | **30–46** |
| **IA OpenRouter** | Gemini 2.5 Flash-Lite + Qwen3-8B, solo fallback. Real €4–11; tope duro €30. | **4–11** |
| **CAPTCHA solver** | CapSolver/2Captcha para Idealista DataDome, solo si DataDome aprieta. Partida separada, activable. | **0–15** |
| **Backups** | Storage Box BX11 1 TB (€3.20) + snapshots disco semanales (~€1–2) | **4–5** |
| **Object storage** | NO en v1 (no se descargan imágenes) | **0** |
| **TOTAL realista v1** | | **≈ €50–75/mes** |
| **TOTAL apretado** (proxy <25 GB, sin CAPTCHA) | Geonode 25 GB ≈ €17 | **≈ €37–45/mes** |

> El **techo de escalado es el €/GB de proxy**, no el VPS ni la IA. Empezar con el **trial Geonode 10 GB / $5** para medir consumo real antes de comprometer plan de 50 GB. [DECISIÓN CTO]

---

## 8. Roadmap por fases (parte de: YA existe scraper de particulares + CRM)

### Fase 0 — Cimientos (semana 1–2)
**Objetivo: infraestructura y datos base, sin producto aún.**
1. Provisionar CX43, Ubuntu 24.04, firewall Hetzner + ufw, SSH solo-clave, fail2ban.
2. `docker compose` con Postgres 16+PostGIS 3.4, PgBouncer, Redis 7.4, Caddy, Netdata. Tuning de §5.
3. Esquema §4 vía Alembic. pg_partman + pg_cron.
4. **Carga INSPIRE provincia Madrid** (ATOM → ogr2ogr, 30–60 min). Crear GIST. Verificar PIP en single-digit ms.
5. CI/CD (GitHub Actions → GHCR → deploy.sh), backups restic → Storage Box, verificación de restore.

### Fase 1 — Captura + Motor RC + Dedup (semana 3–7)
**Objetivo: el lago de inmuebles identificados por RC20.**
1. Envolver el **scraper de particulares existente** en el orquestador Scrapy + `job_queue`. Confirmar qué portales cubre y si extrae círculo/m²/planta/pHash (pregunta abierta crítica — §10).
2. `worker-scrape`: curl_cffi para Fotocasa/Habitaclia/pisos/Milanuncios + sitemaps de agencias. 3 colas Redis. Detección de cambios desde listado.
3. Idealista: cookie-harvesting con 2 Playwright/patchright → inyección curl_cffi. Circuit-breaker por dominio.
4. `worker-resolve`: PIP gaussiano círculo→RC14 → DNPRC/RCCOOR (1 rps, cache permanente) → matcher RC14→RC20 + score. Warm-up nocturno de barrios objetivo.
5. `consolidate`: dedup por RC20 (UNIQUE) + dedup blando (rc14+planta+m²±5%) cuando solo RC14.
6. Gateway IA (`worker-ai`) con kill-switch, para el residuo de parsing.

### Fase 2 — Producto: Lead Flow + Mercado + AVM v1 + API (semana 8–12)
**Objetivo: lo que el cliente ve y paga.**
1. MVs de mercado (€/m², TOM, descuentos, stock) con pg_cron 04:00 + `mv_broken_exclusives` (exclusivas rotas, confidence ≥0.80).
2. Lead Flow: particulares nuevos, exclusivas rotas, "particular tras agencia", reapariciones, bajadas de precio.
3. AVM hedónico log-lineal por barrio + comparables por RC + **informe PDF** (WeasyPrint, narrativa por LLM).
4. API REST v1 (FastAPI): `/properties`, `/areas/insights`, `/valuation`, `/leads/feed`, `/export`. Auth dual (JWT CRM + API-key B2B), rate-limit token-bucket Redis.
5. Integración CRM: polling `/leads/feed?cursor=` + webhooks HMAC (`lead.created`, `price_dropped`, `listing.gone`).
6. Watchlists + alerta diaria batch (email + push CRM).

### Fase 3 — Sofisticación y escalado (mes 4+)
- AVM ML (LightGBM nacional, corrector del residuo), valor de cierre calibrado contra descuento medido.
- Embeddings semánticos (pgvector + e5-small/bge-m3) para dedup difuso avanzado.
- Absorción/proxy de demanda (TOM inverso + velocidad de bajada).
- Expansión multi-provincia → más GB proxy + separar PostgreSQL a nodo propio (red privada Hetzner) → workers stateless a nodos CX22 → k3s solo a 3+ nodos.
- HA / réplica de lectura. Object storage si se necesita visión por imagen.

**Secuencia de escalado vertical→horizontal:** CX43 → CPX51 (32 GB) → separar Postgres a nodo propio → separar workers/Playwright → k3s.

---

## 9. Riesgos top y mitigación

### Técnicos
| Riesgo | Mitigación |
|---|---|
| **OOM kill de Postgres** (Chromium o pico de work_mem coincide con scraping). | `mem_limit` estrictos (§5), PgBouncer, Playwright en cgroup propio máx 2 instancias, alarma Netdata swap >200 MB. Embeddings fuera de v1. |
| **Coste de proxy descontrolado** (techo económico real). | HTTP-first, br+gzip, bloqueo de assets, APIs JSON internas, condicionales 304, **señal de listado en vez de fichas**, no descargar imágenes. Empezar con trial 10 GB. Monitor GB/portal. |
| **Idealista/DataDome endurece** → coste CAPTCHA y navegador. | Cadencia conservadora, sticky ES, cookie-harvesting, circuit-breaker; partida CAPTCHA separada activable; tope 2 navegadores como señal de escalar. |
| **Falso match RC20** → exclusivas rotas fantasma / comparables erróneos. | Umbral ≥0.80, separación estricta RC14/RC20, sub-cluster sin asignar RC20 en pisos idénticos, panel de revisión manual de baja confianza. |
| **Rate-limit/cambio API Catastro.** | Token-bucket 1 rps, cache permanente por RC14 (>90% hit tras warm-up), backoff, pin versión WS 2.6, tests de regresión del parser, monitor feed ATOM mensual. |
| **Parsers rotos por cambio de maquetado.** | Parsers versionados por portal, fixtures de test, alertas de caída de campos, IA fallback. |
| **AVM sesgado** (precio oferta ≠ cierre, gap 5–12%). | Reportar "precio de salida" + "rango de cierre", calibrar con descuento por barrio. **No** presentarse como tasación oficial ECO/Banco de España. |
| **Disco lleno antes de tiempo.** | Imágenes fuera (regla dura), particionado mensual, alarma >80%, cold storage de particiones viejas. |
| **Punto único de fallo (1 VPS).** | Asumido en fase 1. Backups WAL + pg_dump diario + snapshots; RTO = restaurar snapshot; HA real al separar nodos en Fase 3. |

### Legales (el riesgo no-técnico mayor del proyecto — bloqueante para comercializar leads)
| Riesgo | Mitigación |
|---|---|
| **RGPD/LSSI:** almacenar y usar teléfono/nombre de particulares para captación en frío. Base de "interés legítimo" discutible. | Asesoría jurídica **antes** de explotar leads comercialmente. Minimización (teléfono hasheado por defecto), TTL de borrado, registro de actividades de tratamiento, información al interesado, gestión de oposición/supresión. No revender datos crudos. |
| **Des-anonimización:** cruzar anuncio anonimizado → dirección exacta + Catastro. | Usar solo datos catastrales NO protegidos (geometría, m², uso, planta); **nunca** scrapear titularidad. Decidir umbral de confianza para exponer dirección en producto. |
| **Directiva UE 96/9 bases de datos (sui generis) + ToS de portales.** | Tratar datos como **señal interna de captación/análisis**, no republicar el catálogo como portal competidor. No autenticarse con cuentas propias, no eludir muros de pago, rate-limit cortés. |
| **PII al LLM** (descripciones con datos personales; OpenRouter puede enrutar fuera de UE). | Strippear PII antes de enviar al LLM cuando no sea necesaria; valorar endpoints zero-retention para datos de leads; revisar política de retención del provider. |

---

## 10. Decisiones que el dueño debe tomar YA (consolidadas)

1. **¿Cobertura provincia de Madrid completa o solo capital (28079)?** Y **¿venta + alquiler o solo venta?** Condiciona universo de anuncios (120–180k), GB de proxy, plan Geonode y warm-up de caché. *(Asumo provincia completa + venta y alquiler; confirmar.)*
2. **Validación legal RGPD/ToS antes de comercializar leads de particulares.** Es **bloqueante**. ¿Hay asesoría jurídica? ¿Los leads son uso interno o se revenden? Define el diseño de almacenamiento de PII (hash vs claro, TTL) y si se puede exponer la dirección exacta en producto.
3. **El scraper de particulares existente: ¿sobre qué framework está, qué portales cubre, y ya extrae círculo difuso + radio + m²/planta/habitaciones + pHash de fotos?** Determina la tasa de resolución a RC20 (el valor diferencial entero) y si se reusa o se reescribe en Scrapy.
4. **Plan Geonode: empezar con trial 10 GB/$5 para medir consumo real, o comprometer ya 50 GB/$50?** Y **¿hay apetito para partida CAPTCHA de Idealista (€0–15/mes)** o se acepta menor cobertura cuando DataDome aprieta? *(Recomiendo: trial primero, medir, luego decidir plan.)*
5. **Cadencia de frescura del negocio:** ¿basta precio/retirada detectados 2×/día desde listado, o se necesita near-real-time intradía para barrios prime? Sube GB de proxy linealmente. *(Recomiendo 2×/día global + 1 pase VIP a las 13:00 solo barrios prime.)*
6. **Modelo de negocio:** ¿suscripción por agencia o pago por lead/informe? Y **para el AVM: ¿habrá acceso a precios de transacción reales (Registradores/notarial)** o solo precios de oferta? Solo con oferta, la valoración tiene sesgo al alza conocido (declararlo en producto).

---

**Fuentes (verificación de precios):**
- [Geonode Residential Proxies pricing](https://geonode.com/products/residential-proxies) — Scale $0.45/GB, Business $0.50/GB, standard 50 GB = $50/mes, extra $1/GB, trial 10 GB/$5.
- [OpenRouter — Gemini 2.5 Flash Lite pricing](https://openrouter.ai/google/gemini-2.5-flash-lite) — $0.10/M input, $0.40/M output.
