# Diseño: descubrimiento geográfico de manzanas (`getFeatureInfo`)

- **Fecha:** 2026-07-04
- **Estado:** Aprobado
- **Componente:** `sii-scraper`

## Contexto y problema

La etapa `manzanas` descubre manzanas **por enumeración a ciegas**: prueba IDs de
manzana `manzana_min..manzana_max` y sondea predios en cada uno. Funciona bien en
comunas densas de IDs bajos (Puente Alto: manzanas 1..N contiguas), pero es frágil
y cara en comunas **dispersas / de IDs altos**. Ejemplo verificado: **Vitacura
(15160)** no tiene nada en los IDs bajos; sus primeras manzanas con datos son la
**111** y la **113**. Con `manzana_max` bajo no se encuentra nada; con uno alto se
gastan decenas de miles de sondeos en IDs vacíos, y aun así puedes perderte
manzanas más altas.

El visor del SII no enumera IDs: al hacer clic sobre una parcela dispara un POST a
`mapasFacadeService/getFeatureInfo` con la **coordenada** del clic, y recibe la
ficha del predio — incluyendo su `manzana`, `predio` y `rol`. Es decir, la
geografía de una comuna **sí es conocible** (centro por `listServiciosComunas`),
mientras que sus IDs de manzana no. Esta etapa aprovecha eso.

Nota: las operaciones WMS `GetFeatureInfo` y `GetCapabilities` **contra el proxy**
(`wmsProxyService/call*`) están bloqueadas (HTTP 400, solo `GetMap` permitido) —
verificado. La vía viable es el método **`getFeatureInfo` del facade** (POST JSON),
que sí funciona.

## Objetivo

Etapa nueva **`manzanas-geo`**, alternativa a `manzanas`, que descubre las
manzanas de una comuna consultando `getFeatureInfo` sobre una **grilla de puntos**
que cubre el área de la comuna, y escribe el **mismo** `output/manzanas/<comuna>.jsonl`.
Enfoque **híbrido**: la grilla solo descubre los `manzana_id`; la extracción de
predios la sigue haciendo la etapa `predios` (enumeración exhaustiva `0..predio_max`
dentro de cada manzana conocida), sin cambios.

## Alcance

**Incluye:** método de cliente `get_feature_info`; parseo de su respuesta; módulo
de geometría (grilla + bbox); etapa `manzanas-geo`; sección de config `geo`;
registro en el orquestador; tests; docs.

**No incluye:** cambios en `predios`/`found-predios`; cosecha directa de predios
por grilla (se eligió el híbrido por exhaustividad); auto-detección fina del borde
de la comuna (se usa centro + extensión + filtro por `comuna_id`).

## Decisiones de diseño

- **Híbrido:** la grilla produce el set de `manzana_id`; `predios` enumera dentro.
- **Bbox por centro + extensión:** centro `(lat, lon)` de `listServiciosComunas`
  ± una semi-extensión. Se descarta `GetCapabilities` (bloqueado) y el bbox manual.
- **Filtro como red de seguridad:** se acepta solo la respuesta con
  `existePredio == 1` **y** `comuna == comuna_id`. Así el bbox no necesita ser
  exacto: overshoot → puntos fuera devuelven vacío/otra comuna y se descartan.
- **Consulta puntual:** cada punto de la grilla se consulta con un `clickInfo` de
  bbox chico centrado en el punto y pixel central, de modo que la respuesta sea el
  predio exactamente en esa coordenada.
- **Reanudable:** checkpoint por punto de grilla (índice); dedup de manzanas
  releyendo el `.jsonl` existente al iniciar.

## Componentes

### 1. `client/sii_client.py`
- `_feature_info_payload(comuna_id, predios_servicio, sw_lat, sw_lon, ne_lat, ne_lon, x, y, width, height) -> dict`
  arma el POST de `getFeatureInfo`. Estructura (confirmada con captura real):
  ```json
  {"metaData": {"namespace": ".../MapasFacadeService/getFeatureInfo",
                "conversationId": "UNAUTHENTICATED-CALL",
                "transactionId": "getFeatureInfo"},
   "data": {"clickInfo": {
     "x": 128, "y": 128,
     "southwestx": <lat_sw>, "southwesty": <lon_sw>,
     "northeastx": <lat_ne>, "northeasty": <lon_ne>,
     "layer": "<predios_layer>", "width": 256, "height": 256,
     "servicios": [ <predios_servicio> ]}}}
  ```
  **Convención de ejes (importante):** `southwestx`/`northeastx` son **latitudes**;
  `southwesty`/`northeasty` son **longitudes** (verificado con los valores reales
  de la captura).
- `async get_feature_info(comuna_id, predios_servicio, sw_lat, sw_lon, ne_lat, ne_lon, x, y, width, height) -> dict`
  → `await self._post("getFeatureInfo", _feature_info_payload(...))`. Reusa
  rate-limiter, semáforo, reintentos, sesión y proxy.
- `async get_predios_servicio(comuna_id) -> dict | None`: devuelve el **registro
  crudo** del servicio de Predios (aliasServicio "P") de `listServiciosComunas`,
  que incluye tanto lo que necesita el payload (`comuna, layer, style, eac,
  eacano`) como lo que necesita el bbox (`latitud, longitud, zoom`). Devuelve
  `None` si la comuna no expone capa de Predios. (La consulta a
  `listServiciosComunas` se hace una vez por comuna.)

### 2. `domain/models.py`
- `parse_feature_info(raw: dict) -> dict | None`: de la respuesta de
  `getFeatureInfo`, si `data` existe y `data.existePredio == 1`, devuelve
  `{"comuna": int, "manzana": int, "predio": int, "area_homogenea": str | None}`;
  si no (`data` null/`existePredio` != 1) devuelve `None`. El `area_homogenea` sale
  de `data.ah` (código de área homogénea, p.ej. "EAB590") si está presente.

### 3. `geo.py` (nuevo módulo de geometría pura, sin red)
- `half_extent_m(zoom: int, lat: float) -> float`: semi-extensión en metros para
  el bbox por defecto, derivada del `zoom` del SII:
  `156543.03392 * cos(rad(lat)) / 2**zoom * HALF_VIEWPORT_PX` con
  `HALF_VIEWPORT_PX = 600` (asume un visor ~1200 px). Para Vitacura (zoom 13,
  lat -33.4) da ~9.6 km.
- `bbox_around(lat, lon, half_m) -> (sw_lat, sw_lon, ne_lat, ne_lon)`: convierte
  metros a grados (`1° lat ≈ 111_320 m`; `1° lon ≈ 111_320 * cos(lat)`).
- `grid_points(sw_lat, sw_lon, ne_lat, ne_lon, step_m) -> list[(lat, lon)]`:
  genera los puntos de la grilla en orden determinístico (filas de sur a norte,
  columnas de oeste a este), con paso `step_m` convertido a grados.
- Todo es puro y unit-testeable sin red.

### 4. `pipeline/manzanas_geo.py` (nueva etapa)
- `async run_manzanas_geo_stage(client, config) -> None`. Por cada comuna:
  1. `predios_servicio = await client.get_predios_servicio(comuna.comuna_id)`; si
     `None` → WARNING y se salta la comuna.
  2. Calcula el bbox: `lat/lon/zoom` salen del registro devuelto por
     `get_predios_servicio` (`latitud`, `longitud`, `zoom`).
     `half = config.geo_radius_km * 1000` si está configurado, si no
     `half_extent_m(zoom, lat)`. `bbox_around(lat, lon, half)`. El elemento
     `servicios` del payload se arma con el subconjunto `{comuna, layer, style,
     eac, eacano}` de ese mismo registro.
  3. `puntos = grid_points(*bbox, config.geo_grid_step_m)`.
  4. Abre `JsonlWriter(manzanas/<slug>.jsonl)`, `Checkpoint(manzanas_geo_<slug>.json)`.
     Siembra `vistas: set[int]` releyendo el `.jsonl` existente (dedup en reanudación).
  5. Para cada punto con índice `i` no procesado en checkpoint: consulta
     `get_feature_info` (bbox chico centrado en el punto), parsea con
     `parse_feature_info`; si hay predio y `comuna == comuna_id` y su `manzana` no
     está en `vistas`: escribe `{manzana_id, comuna_id, area_homogenea,
     extraction_datetime}` (mismo schema que `parse_manzana`), agrega a `vistas`.
     Marca el punto `i` como done en el checkpoint. `asyncio.gather` acotado por el
     semáforo del cliente.
- El bbox chico por punto: `ε = 0.0005°`; `southwest=(lat-ε, lon-ε)`,
  `northeast=(lat+ε, lon+ε)`, `width=height=256`, `x=y=128` → el pixel central
  cae en `(lat, lon)`.

### 5. `config.py`
- Nueva sección `geo` → dos campos, ambos opcionales:
  - `geo_grid_step_m: int` (default `100`).
  - `geo_radius_km: float | None` (default `None` → se deriva del `zoom`).
- Se agregan a `Config` con defaults (al final, como `regiones`/`manzana_min`),
  para no romper constructores existentes.

### 6. `orchestrator.py`
- `STAGES["manzanas-geo"] = run_manzanas_geo_stage`.
- `SCRAPING_STAGES` incluye `"manzanas-geo"` (usa `resolve_comunas` y la validación
  de comunas no vacías, igual que las otras etapas de scraping).

## Flujo de datos

```
run.py manzanas-geo
  → resolve_comunas
  → por comuna: get_predios_servicio → bbox(centro,extensión) → grid_points
      → get_feature_info por punto → parse_feature_info → filtra (comuna+existePredio)
      → dedup manzana_id → manzanas/<comuna>.jsonl   (+ checkpoint por punto)
run.py predios            (sin cambios: enumera 0..predio_max por manzana)
  → predios/<comuna>.jsonl
```

## Manejo de errores

- `get_feature_info` con `RetriesExhausted` u otra excepción en un punto → WARNING,
  se salta ese punto (no se marca done → se reintenta la próxima corrida), la grilla
  continúa.
- `get_predios_servicio` devuelve `None` (comuna sin capa Predios) → WARNING y se
  salta la comuna, sin abortar la corrida.
- Resultado vacío (ninguna manzana hallada) → `.jsonl` vacío (válido, como hoy).

## Plan de testing (TDD)

- `geo.py`:
  - `grid_points`: bbox conocido + paso → cantidad y coordenadas esperadas; orden
    determinístico.
  - `bbox_around` / `half_extent_m`: valores numéricos esperados (incl. Vitacura
    zoom 13 → ~9.6 km).
- `parse_feature_info`: respuesta real (Vitacura, `manzana:111, predio:10,
  existePredio:1, ah:"EAB590"`) → dict correcto; `existePredio:0` → None;
  `data:null` → None.
- `client`: `get_feature_info` mockeado con `aioresponses` (POST getFeatureInfo);
  `get_predios_servicio` devuelve el servicio "P" desde un `listServiciosComunas`
  mockeado, y `None` cuando no hay Predios.
- `run_manzanas_geo_stage` con `FakeClient` (predios en ciertos puntos, uno de otra
  comuna): escribe los `manzana_id` únicos correctos, **descarta** el punto de otra
  comuna, respeta el checkpoint (2da corrida no reconsulta), y no duplica manzanas
  al reanudar (dedup releyendo el `.jsonl`).
- `orchestrator`: `"manzanas-geo"` registrada y en `SCRAPING_STAGES` (resuelve
  comunas / valida no-vacío).

## Costo (nota operativa)

La grilla es un barrido grande: un bbox de ~6×6 km a paso 100 m ≈ 3.600 puntos
(~20 min a 3 req/s). No es gratis, pero para comunas dispersas es competitivo o
mejor que enumerar (Vitacura con `manzana_max=500`/`probe_depth=60` también son
decenas de miles de sondeos) y **no requiere adivinar `manzana_max` ni pierde
manzanas altas**. Es reanudable (checkpoint por punto), así que puede correr por
tramos. Se puede ajustar el costo con `geo_grid_step_m` (paso mayor = menos puntos,
riesgo de saltarse una manzana chica) y `geo_radius_km` (bbox más ajustado).

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `sii_scraper/client/sii_client.py` | `_feature_info_payload`, `get_feature_info`, `get_predios_servicio` |
| `sii_scraper/domain/models.py` | `parse_feature_info` |
| `sii_scraper/geo.py` | **nuevo**: `half_extent_m`, `bbox_around`, `grid_points` |
| `sii_scraper/pipeline/manzanas_geo.py` | **nuevo**: `run_manzanas_geo_stage` |
| `sii_scraper/config.py` | `geo_grid_step_m`, `geo_radius_km` |
| `sii_scraper/orchestrator.py` | registrar `manzanas-geo` en STAGES + SCRAPING_STAGES |
| `tests/…` | tests de geo, parse, cliente, etapa, orquestador |
| `config.example.json` / `README.md` | documentar la etapa y la sección `geo` |
