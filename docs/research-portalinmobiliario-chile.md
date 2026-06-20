# Investigación: scraper de Portalinmobiliario.com (Chile) y resolución de identidad de propiedad

> Fase de research/diseño. No incluye código de implementación.
> Limitación de esta sesión: el sandbox bloqueó por allowlist las peticiones directas a
> `portalinmobiliario.com`, `api.mercadolibre.com` y `developers.mercadolibre.com.ar` (403
> vía fetch y vía `curl`). La evidencia viene de documentación oficial indexada, de dos
> scrapers open-source funcionales y de un proveedor comercial (Apify) que vende este
> scraping activamente. El primer paso de implementación debe ser un spike de fetch real
> (fuera del sandbox) contra un anuncio concreto para confirmar lo que aquí se infiere.

## Estructura de datos y anti-bot

Portalinmobiliario comparte el frontend "Andes" de Mercado Libre: clases `ui-search-layout__item`
y `poly-component__title` en el listado, URLs de ficha con patrón `MLC-\d+`. Es una
generación más moderna que los scrapers de hace una década (`media-block-title`,
`data-sheet-column-address`), lo que sugiere un SPA tipo React/Next.js — razonable esperar
un blob JSON embebido (`__NEXT_DATA__` o similar) en la ficha, a confirmar con un fetch
real; de existir, sería preferible parsearlo en vez del DOM renderizado, igual que ya
preferimos JSON-LD sobre HTML cuando Idealista lo expone.

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

- Confirmar si la ficha expone `__NEXT_DATA__` o similar (preferible a CSS selectors).
- Confirmar si `/items/{id}` y `/sites/MLC/search` exigen `access_token` hoy; si sí,
  evaluar si vale el registro OAuth dado que no resuelve el problema de ubicación.
- Medir en vivo agresividad real del rate-limit (429 vs 403) y si hay WAF perimetral antes
  de asumir que un UA de navegador normal basta indefinidamente.
- Definir el umbral pin-vs-geocoder (propuesta inicial: 150 m) con una muestra real de
  decenas de anuncios, no solo el caso de ejemplo.
- Decidir fuente de tipo de cambio UF→CLP diario y si se persiste también el valor UF
  crudo.
- Diseñar el esquema de `location_confidence` y cómo se propaga a `rc_status` (hoy binario
  `'none'` en España) — Chile probablemente necesita valores intermedios (`'candidate'`,
  `'pin_suspect'`, `'confirmed'`).
- Validar si las republicaciones tras expirar (45 días en arriendo) cambian el ID MLC — de
  ser así, el job de triangulación debe agrupar por teléfono/RUT/pHash, nunca por ID de
  anuncio.
