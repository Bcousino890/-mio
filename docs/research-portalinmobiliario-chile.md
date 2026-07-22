# Investigación: scraper de Portalinmobiliario.com (Chile) y resolución de identidad de propiedad

> Fase de research/diseño. Fase 0 confirmada primero contra 11 fichas de detalle reales
> subidas por el usuario y, desde **2026-07-22**, también contra HTML de LISTADO en vivo:
> el entorno de ejecución **ya alcanza el dominio (HTTP 200)** y se validó/reescribió
> `parseListPage()` sobre el blob Nordic. Ver "Validación en vivo del LISTADO (2026-07-22)"
> y "Confirmado en Fase 0" más abajo. Lo único que sigue sin medir es el rate-limit a
> concurrencia sostenida (necesita el spike desde el VPS).

## Estructura de datos y anti-bot

Portalinmobiliario comparte el frontend "Andes" de Mercado Libre: clases `ui-search-layout__item`
y `poly-component__title` en el listado, URLs de ficha con patrón `MLC-\d+`.

**Confirmado en Fase 0 (11 fichas reales, ficha/detalle, comuna Vitacura):** la ficha NO
usa `__NEXT_DATA__`/`__PRELOADED_STATE__`/`__INITIAL_STATE__` (cero matches en las 11
muestras) — esa hipótesis original era incorrecta. El framework real es el "Nordic"
interno de Mercado Libre: el estado completo de la página viene embebido como
`<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={...}</script>`, un único blob JSON que
requiere extracción brace-balanced (no regex `\{[\s\S]*?\}`, porque el blob contiene
strings con `{`/`}` literales — descripciones, JSON escapado — que rompen los límites de
un regex naive). Implementado en `scraper/lib/parse-portalinmobiliario.mjs::extractNordicBlob`.
Dentro de ese blob, el dato vivo está en `blob.appProps.pageProps.initialState`, con dos
sub-árboles centrales:
- `state.track.melidata_event.event_data` — la fuente más rica: `domain_id` (codifica
  operación+tipo, ej. `MLC-INDIVIDUAL_HOUSES_FOR_SALE`), `price`, `currency_id` (`CLF` =
  UF), `city`, `seller_id`, `seller_type`.
- `state.components.*` — árbol de componentes UI: `header` (título/dirección),
  `location_and_points.map_info.location` (lat/lng reales, distintos por ficha),
  `highlighted_specs_res.attributes[]` (dorm/baños/m², keyed por `icon.id`),
  `seller_profile`/`seller_profile_rex` (agencia + `bottom_extra_info` con
  "Código de la propiedad"), `code_internal` (referencia interna de la corredora,
  mutuamente excluyente con `property_code` en las 11 muestras), `gallery_mosaic`
  (fotos+video), `description`/`description_rex`.

Esta es una generación más moderna que los scrapers de hace una década
(`media-block-title`, `data-sheet-column-address`). El blob Nordic es preferible al DOM
renderizado, igual que ya preferimos JSON-LD sobre HTML cuando Idealista lo expone.

No hay evidencia de un DataDome-equivalente: un scraper open-source de 2023 usa simple
`requests` + `BeautifulSoup4` sin proxies ni rotación de UA, sin mencionar bloqueos, y
Apify vende extracción comercial a escala de UF/CLP, lat/lng, dormitorios/m². Es razonable
esperar rate-limiting básico por IP y quizás un WAF estándar, pero nada que requiera el
truco de TLS-fingerprint + UA de WhatsApp actual. Conclusión operativa: reusar
`scraper/lib/fetch.mjs` casi tal cual (misma función `fetchHtml` vía `curl`, mismo soporte
de proxy opcional) pero con UA de navegador normal; el proxy queda como mitigación de
rate-limit, no como bypass de fingerprinting.

## API pública de Mercado Libre

Existe `GET /sites/MLC/search` documentado, categoría `MLC1459`, con atributos
estructurados obligatorios (`PRICE`, `CURRENCY_ID`, `BEDROOMS`, `FULL_BATHROOMS`,
`COVERED_AREA`, `CMG_SITE`). En teoría `GET /items/{id}` debería devolver estos campos
limpios — preferible a parsear HTML. **Riesgo a validar**: indicios no confirmados de que
hoy se exige `access_token` incluso para GET, y que `/search` público fue restringido para
terceros. Si es así, requeriría registrar app OAuth (`client_credentials`) — viable, pero
de todas formas la API devolvería el mismo lat/lng y misma dirección que declaró el
vendedor, que es justo el dato no confiable. La API gana en campos "duros" (precio, m²,
dormitorios, fecha, tipo de vendedor) pero no resuelve el problema de ubicación real.

## Arquitectura de scraper propuesta

Extender `scraper/lib/*` añadiendo Chile como un segundo proveedor, no un fork:

- **`lib/fetch.mjs`**: generalizar a un perfil por portal (`{ua, proxy, timeout}`) en vez
  de hardcodear el UA de WhatsApp.
- **Nuevo `lib/ml-api-client.mjs`**: cliente delgado para `/sites/MLC/search` y
  `/items/{id}`, con OAuth si se confirma necesario. Fuente preferida para campos
  estructurados; fallback a HTML si la API deniega o no cubre fotos/descripción/vistas.
- **Nuevo `lib/parse-portalinmobiliario.mjs`** (paralelo a `lib/parse.mjs`): prioriza el
  JSON embebido si existe; si no, cae a selectores DOM.
- **`lib/to-listing.mjs`**: extender el mapeo con lo específico de Chile:
  - **Moneda dual UF/CLP**: normalizar siempre a CLP con el valor de UF del día (Banco
    Central de Chile o mindicador.cl), conservando también el valor UF original y la fecha
    de conversión, porque la UF varía día a día.
  - **Comuna** reemplaza distrito/barrio; `zone-resolver.mjs` necesita su tabla chilena
    equivalente.
  - Nuevo campo `location_confidence`, poblado por el motor de resolución de identidad —
    no existe hoy porque en España la dirección de particulares ya es confiable.
- **`lib/matching.mjs`**: reutilizable casi sin cambios (agnóstico de país); solo se añaden
  señales nuevas a `DEFAULT_WEIGHTS` (teléfono/agencia recurrente, pin sospechoso).
- **`lib/phash.mjs`**: reutilizable una vez resuelto el TODO pendiente (hoy deshabilitado);
  aún más crítico en Chile como ancla de identidad cuando la ubicación no es confiable.
- **`scrape-multi-portal.mjs`**: añadir `portalinmobiliario` a `PORTAL_CONFIG` con el mismo
  contrato (`baseUrl`, `parse`, `ua`) — la orquestación ya es portal-agnóstica.

## Estrategias de resolución de identidad real de la propiedad

Ordenadas de mayor a menor confiabilidad/costo. Ninguna señal aislada basta: el objetivo es
un score combinado (mismo patrón de `lib/matching.mjs`) que produzca un Rol SII candidato
con nivel de confianza, no una resolución determinista de una sola pasada.

1. **(d) Triangulación entre anuncios — la más fuerte y la primera a construir.** Agrupar
   anuncios que probablemente son la misma propiedad por teléfono/RUT/agencia, pHash de
   fotos, republicaciones recurrentes (Mercado Libre cierra arriendos a 45 días, por lo que
   es normal ver el mismo inmueble con nuevo ID MLC) e historial de precio. El
   centroide/moda de N observaciones de lat/lng y dirección es más confiable que cualquier
   pin individual. Costo bajo (agregación sobre datos que ya se scrapean).

2. **(b) Geocodificación de dirección + verificación cruzada contra el pin.** Geocodificar
   la dirección declarada y comparar contra el lat/lng del anuncio. Coincidencia dentro de
   umbral (~100-150 m, mismo orden que `distance_m` en `matching.mjs`) sube confianza;
   discrepancia mayor es la señal de "pin falso" que advirtió el usuario — marcar baja
   confianza en vez de confiar ciegamente en cualquiera de los dos valores. Ataca el
   problema de raíz antes de gastar cómputo en point-in-polygon.

3. **(a) Point-in-polygon contra geometría catastral del SII, con detector de pin
   sospechoso.** Útil tras pasar el filtro de (b). Heurísticas para marcar un pin como
   dudoso: coincidencia con el centroide de comuna/sector (pin "puesto a mano"), lat/lng
   con decimales sospechosamente redondos, o clusters de muchos anuncios de agencias
   distintas con el mismo lat/lng exacto en una zona sin ese volumen real de oferta. Si pasa
   los chequeos y cae limpio en un único polígono, se usa como ancla fuerte; si no, se
   degrada a candidato débil.

4. **(c) Matching de huella física (m² + dormitorios/baños + tipo) contra metadata SII de
   Roles candidatos cercanos.** Análogo directo al matching RC14→RC20 español: con un
   conjunto pequeño de Roles candidatos (acotado por a+b), desambiguar comparando
   superficie/destino SII contra los m²/dormitorios/tipo del anuncio, con el mismo motor de
   señales ponderadas, agregando un set de señales atómicas específico del catastro chileno
   (a coordinar con el agente que investiga el Rol Predial).

5. **(e) Complementarias a explorar en implementación**: IDE municipal (ej. Las Condes, si
   publica numeración oficial o capas GIS abiertas), SII Mapas (WMS/WFS) como fuente
   primaria de geometría catastral, y eventualmente Conservador de Bienes Raíces si se
   necesita confirmar titularidad — fuera de alcance de este research.

## Apéndice — puntos abiertos para el spike de implementación

### Validación en vivo del LISTADO (2026-07-22) — el entorno YA alcanza el dominio

Contrario a lo que se asumía cuando se escribió este research ("el entorno remoto
sigue bloqueando el dominio con 403"), hoy el dominio responde **HTTP 200** desde
el entorno de ejecución. Eso permitió cerrar en vivo dos huecos de Fase 0 que solo
tenían fichas de detalle pre-descargadas:

- ✅ **`parseListPage()` reescrito y validado contra HTML real** (listado de Las
  Condes venta/casa, 48 tarjetas). **Hallazgo crítico:** los resultados del listado
  NO viven en `<li class="ui-search-layout__item">` del HTML — esos son
  intervenciones (widgets de filtro/publicidad). Los anuncios reales están en el
  MISMO blob Nordic que la ficha, en `initialState.results[].polycard`. El parser
  viejo troceaba por `<li>` y "funcionaba" por accidente (coincidencias del string
  escapadas dentro del JSON), devolviendo **basura con forma de datos**: tomaba un
  id de FOTO (`891463-MLC110284448549_042026`) como `external_id` y nunca extraía
  precio/atributos. El parser nuevo lee `polycard.metadata` (id/url/domain_id) +
  `components[]` (title, price, attributes_list, location, seller) y saca 48/48
  con precio + dormitorios + baños + m². Blindado con
  `scraper/lib/parse-portalinmobiliario-list.test.mjs` (fixtures reales).
- ✅ **Filtro de URL `/venta/casa/propiedades-usadas/<comuna>-metropolitana`
  confirmado**: excluye proyectos nuevos server-side (48/48 usadas, 0
  `DEVELOPMENT`). El `domain_id` del polycard además distingue
  `INDIVIDUAL_HOUSES_FOR_SALE` (usada) de `DEVELOPMENT_HOUSES_FOR_SALE` (proyecto),
  así que el discovery puede doble-filtrar. Validado en 4 comunas (Las Condes,
  Vitacura, La Reina, Ñuñoa) y en casa+departamento — 48 resultados por página.
- ✅ **API pública de Mercado Libre exige auth**: `GET api.mercadolibre.com/sites/MLC/search`
  y `/sites/MLC` devuelven **HTTP 403 `forbidden`** sin `access_token` (no es el
  proxy — `mindicador.cl` da 200 por la misma ruta). Confirma el "riesgo a validar"
  del cuerpo del research: la API NO es usable de forma anónima. Se mantiene la
  decisión de diseño del plan: **HTML/blob Nordic como fuente, API solo si se
  registra OAuth** (y aun así no resolvería la ubicación no confiable).
- ⚠️ **Rate-limit real a concurrencia 3-5: SIGUE ABIERTO.** La sonda fue cortés
  (4 requests secuenciales, delay ~1.8s) → 0% de 429/403, pero eso NO es el spike
  de concurrencia del VPS (H0): distinta IP, sin carga sostenida. El bloqueante de
  Fase 2 a escala sigue necesitando `spike-rate-limit-vps.mjs` en el VPS real.
- ⚠️ **Endpoint XHR de Convecta (H21): sin investigar todavía** — es trabajo de
  Fase 4, no bloquea el pipeline de PI.

### Confirmado en Fase 0 (11 fichas reales)

- ✅ La ficha expone un blob JSON embebido — `__NORDIC_RENDERING_CTX__`, no `__NEXT_DATA__`
  (ver sección de anti-bot arriba para la ruta completa y los campos confirmados).
- ✅ `property_code` ("Código de la propiedad") vive en
  `seller_profile(.rex)?.bottom_extra_info[]`, formato variable (numérico o hash
  alfanumérico según el sistema interno de cada corredora — confirmado, no es un bug).
- ✅ El video **nunca** viaja embebido como archivo en el HTML estático de la ficha: solo
  existe `gallery_mosaic.has_video` (booleano) y una URL de modal
  (`gallery_mosaic.media_counters[type=video].url`,
  `.../vis-modals/gallery/{item_id}?selected_tab=media_player`). Obtener el archivo real
  requiere un fetch adicional a ese endpoint — pendiente para la Fase 2 (pipeline de
  media), no resuelto por el parser de Fase 1.
- ✅ Mismo patrón para fotos: el HTML estático embebe **siempre exactamente 5 fotos**
  (`gallery_mosaic.primary` + 4 `secondary`) sin importar el total real del anuncio
  (`gallery_mosaic.total_count`, observado entre 11 y 30 en las 11 muestras). Las fotos
  restantes están detrás del mismo patrón de endpoint de modal
  (`media_counters[type=photos].url`) — el parser ya expone `photos_total_count` y
  `gallery_url` para que la Fase 2 sepa cuántas fotos le faltan ir a buscar por anuncio.
- ✅ Lat/lng reales y distintos por ficha en
  `components.location_and_points.map_info.location.{latitude,longitude}` — el fallback
  regex previo (que devolvía la misma coordenada para todas las fichas) fue eliminado, no
  reparado: no existe un fallback regex seguro y es preferible `null` a un valor
  confiadamente incorrecto.
- ✅ Dorm/baños/m² vía `components.highlighted_specs_res.attributes[]`, keyed por
  `icon.id` ∈ {`BED`, `BATHROOM`, `SCALE_UP`} — el regex anterior basado en la clase CSS
  `poly-component__attributes-item` nunca calza en la ficha de detalle (esa clase solo
  existe en el listado).
- ✅ `event_data.domain_id` resuelve operación+tipo de forma limpia (ej.
  `MLC-APARTMENTS_FOR_RENT`) — mejor que inferir por slug de breadcrumb.

### Aún abierto (no validado en esta Fase 0, ficha estática solamente)

- ~~No confirmado: si `/items/{id}` y `/sites/MLC/search` exigen `access_token`~~ →
  **RESUELTO 2026-07-22** (ver "Validación en vivo" arriba): la API pública devuelve
  403 sin auth. HTML/blob Nordic queda como fuente.
- **Parcialmente resuelto (2026-07-22):** agresividad real de rate-limit. Acceso
  ligero secuencial desde el entorno = 0% de 429/403, pero la **concurrencia 3-5
  sostenida sigue sin medir** — necesita `spike-rate-limit-vps.mjs` en el VPS.
- ~~No confirmado: filtro de URL de listado + `parseListPage()` sin verificar~~ →
  **RESUELTO 2026-07-22**: `parseListPage()` reescrito sobre el blob Nordic y validado
  contra HTML real; el filtro `/propiedades-usadas/` excluye proyectos. (Ver arriba.)
- Definir el umbral pin-vs-geocoder (propuesta inicial: 150 m) con una muestra real de
  decenas de anuncios, no solo el caso de ejemplo.
- Decidir fuente de tipo de cambio UF→CLP diario y si se persiste también el valor UF
  crudo (ya implementado en `scraper/lib/uf-rate-cl.mjs`, pendiente de validar a escala).
- Diseñar el esquema de `location_confidence` y cómo se propaga a `rc_status` (hoy binario
  `'none'` en España) — Chile probablemente necesita valores intermedios (`'candidate'`,
  `'pin_suspect'`, `'confirmed'`).
- Validar si las republicaciones tras expirar (45 días en arriendo) cambian el ID MLC — de
  ser así, el job de triangulación debe agrupar por teléfono/RUT/pHash, nunca por ID de
  anuncio. (`property_code`+`advertiser_id`, ya extraídos por el parser, son la base para
  esto, pero la deduplicación a escala real sigue pendiente de la Fase 2/3.)
