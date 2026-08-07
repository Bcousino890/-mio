# Anuncios CL — leer el listado por la API oficial de Mercado Libre

## El problema que cierra este cambio

El barrido de Portal Inmobiliario descubría anuncios bajando el **HTML de las
páginas de búsqueda** (`/venta/casa/propiedades-usadas/las-condes-metropolitana/…`).
Mercado Libre responde a esas páginas con su pantalla de verificación de
**"tráfico sospechoso"**: HTTP 200, la página construida con el mismo framework
que la buena, y cero anuncios dentro. La decisión es por **reputación de la IP de
salida** — está comprobado y documentado en `web/lib/pi-respuesta.mjs`: no
cambia con las cabeceras, ni con `Sec-Fetch-*`, ni con cookies, ni arreglando el
parser.

Síntoma en el panel de salud (`/chile/anuncios-health`): *"El barrido está
bloqueado en 7 de 8 objetivos · no consiguen leer ni una página"*, con los
objetivos acumulando cientos de intentos y el catálogo sin crecer durante horas.

Un dato que orienta la solución: **las fichas nunca estuvieron bloqueadas**.
Medido en producción con todo el listado caído, 46 fichas bajadas y parseadas
bien frente a 11 bloqueos del listado, en la misma hora y por el mismo proxy. Lo
que está cerrado no es el portal: es su **buscador**.

Cambiar de pool o de geo del proxy residencial destraba el barrido unos días y
la IP nueva acaba señalada igual. Es una carrera que no se gana y que ya costó
varias rondas de parches.

## La salida

Mercado Libre publica una **API de búsqueda documentada** (`api.mercadolibre.com`)
para exactamente este caso de uso: la misma información del listado, servida por
una vía pensada para clientes automáticos y autenticada con una aplicación
propia en vez de filtrada por reputación de IP. Ahí no hay antibot que esquivar
porque no hay nada que esquivar.

El pipeline queda así:

| Paso | Antes | Ahora |
|---|---|---|
| Descubrir qué anuncios hay (listado) | HTML del buscador — **bloqueado** | API oficial de Mercado Libre |
| Bajar cada ficha completa | HTML de la ficha | HTML de la ficha (**sin cambios**) |
| Dedup, corredoras, fotos, canje | igual | igual |

Solo cambia de dónde sale la **lista de ids**. Todo lo demás —el parser de
fichas, el upsert, el dedup, las fotos— sigue exactamente igual, porque la ficha
es la que trae los datos y esa se sigue leyendo como siempre.

## Puesta en marcha

1. Entrar en <https://developers.mercadolibre.cl> con la cuenta de Mercado Libre
   de la empresa → **Mis aplicaciones** → **Crear aplicación**. Es gratis y
   autoservicio.
2. Copiar el **App ID** (`client_id`) y el **Secret Key** (`client_secret`).
3. Ponerlos en el `.env` del servidor:

   ```
   ML_CLIENT_ID=...
   ML_CLIENT_SECRET=...
   ```

   El worker relee el `.env` en caliente (`scraper/lib/env-vivo.mjs`), así que no
   hace falta recrear contenedores: el siguiente ciclo de barrido (≤15 min) ya
   sale por la API.
4. Comprobar en `/chile/anuncios-health` que la cabecera dice **"listado por API
   de Mercado Libre"** y que los objetivos dejan de estar en rojo.

Sin esas dos variables **no cambia nada**: el barrido sigue leyendo el HTML
igual que antes. Desplegar este cambio con el `.env` sin tocar es un no-op
funcional.

## Las bajas siguen firmadas por el HTML (a propósito)

Dar de baja un anuncio es la decisión irreversible del barrido: lo que no se vio,
se apaga. Se decide comparando lo visto contra el **total que declara la fuente**
(`MIN_SWEEP_COVERAGE`, 98%).

Si el catálogo que devuelve la API resultara ser un **subconjunto** del que
enseña el portal —cosa que aún no está comparada en producción— un barrido
"completo al 100%" apagaría anuncios vivos en masa. Por eso:

- con la API activa, el barrido **descubre altas** (que es lo urgente) pero
  **no da de baja**;
- las bajas las siguen firmando los barridos que lidera el HTML;
- el objetivo lo dice en sus `notes`: *"barrido por api-ml+html: altas sí, bajas
  no"*.

Cuando los totales de las dos fuentes se hayan comparado en el panel y cuadren,
se activa con:

```
ML_API_BAJAS=1
```

## Cómo está montado

- **`scraper/lib/ml-oauth-cl.mjs`** — token de aplicación
  (`grant_type=client_credentials`), cacheado en memoria y renovado un minuto
  antes de caducar. El `client_secret` viaja por *stdin* del `curl`, no por
  argumentos, para que no aparezca en la lista de procesos.
- **`scraper/lib/ml-api-client.mjs`** — `/sites/MLC/search`, `/items/{id}`,
  `/countries/CL`, `/states/{id}`. Un 401/403 con token en mano pide uno fresco
  y repite **una** vez. Circuito de resiliencia propio, separado de los de
  `portalinmobiliario.com`: son infraestructuras distintas y que una se caiga no
  dice nada de la otra.
- **`scraper/lib/discovery-fuente-cl.mjs`** — las dos fuentes hablando el mismo
  idioma (`pedirPagina({offset, priceRange}) → {ok, listings, meta}`), el
  resolutor de filtros y el envoltorio de respaldo.
- **`scraper/lib/discovery-portalinmobiliario-cl.mjs`** — el barrido, que ya no
  sabe (ni le importa) quién le sirve las páginas.

### Ids opacos: se preguntan, no se escriben a mano

La API filtra por ids como `TUxDQ0xBUzc0OTBa`, no por nombres. Escribirlos a mano
fallaría en silencio devolviendo la comuna equivocada, así que se resuelven
preguntándole a la propia API y se cachean en memoria:

```
región  → /countries/CL              → estado (CL-RM)
comuna  → /states/CL-RM              → ciudad
operación / tipo → available_filters de una búsqueda real
```

La coincidencia por nombre prueba **igualdad exacta antes que prefijo**: hay
valores que empiezan igual y significan cosas distintas — "Arriendo" y "Arriendo
temporal" son dos mercados y mezclarlos metería estadías turísticas en el
catálogo.

El criterio de orden "más recientes" se resuelve igual, leyendo
`available_sorts` de esas mismas búsquedas: mandar `sort=date_desc` a ciegas
sería un 400 si la categoría no lo ofrece, y un parámetro cosmético tumbaría la
búsqueda entera. Si no hay ninguno por fecha se va sin orden.

### Topes y bandas de precio

La API no deja pasar de `offset + limit = 1000` (el HTML topaba en ~2000). La
fuente lo declara como `resultsLimit`, y el barrido aplica **la misma bisección
por bandas de precio que ya usaba** para el tope del HTML: parte la comuna hasta
que cada banda quepa debajo. No hubo que tocar esa maquinaria.

Las bandas se traducen al filtro `price=min-max` de la API (con `*` en los
extremos abiertos). No se manda unidad aparte porque la API filtra sobre el
precio tal como lo publicó el vendedor: arriendos en pesos y ventas en UF
(`currency_id: "CLF"`), que es justo el par de unidades con el que el discovery
ya bisecaba.

### Si la API falla, el barrido no se para

La fuente activa es `api-ml+html`: si la API no sirve una página —credenciales
caducadas, un id de filtro que ML cambió, un 500— se reintenta esa misma página
por el HTML. Activar la API no puede dejar el barrido peor de lo que estaba.

## Qué queda verificado y qué no

Verificado con tests (`node --test scraper/lib/*.test.mjs scraper/worker-cl.test.mjs`,
240 pasando):

- que `/sites/MLC/search` **no** es accesible de forma anónima (403 comprobado
  contra la API real en 2026-08 — el supuesto que quedaba abierto en
  `docs/research-portalinmobiliario-chile.md`);
- el ciclo de vida del token (caché, caducidad, renovación forzada, cambio de
  credenciales, errores legibles);
- el mapeo de ítem de API a la forma del scraper, con el `external_id`
  normalizado igual que el del HTML;
- la resolución de filtros y su caché, incluido que un fallo de red **no** se
  cachea;
- el tope de 1000 tratado como fin de resultados y no como fallo;
- la caída a HTML;
- y que la fuente API **no** ejecuta ninguna baja mientras no se le autorice.

**No verificado en vivo** (requiere las credenciales, que no están en este
entorno): la forma exacta de la respuesta real de `/sites/MLC/search` para la
categoría MLC1459, y si los nombres de los valores de `OPERATION`/`PROPERTY_TYPE`
son literalmente "Venta"/"Arriendo"/"Casa"/"Departamento". Por eso la resolución
de nombres es tolerante (exacto → prefijo → sin filtro de tipo) y por eso existe
el respaldo a HTML. La primera corrida con credenciales reales es la que lo
confirma; el panel dirá por qué fuente entró cada barrido.
