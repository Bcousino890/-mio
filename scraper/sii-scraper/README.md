# SII Scraper (predios → JSONL)

Scraper asíncrono de predios del **SII** (`mapasFacadeService`). Recorre el
espacio `(comuna, manzana, predio)` y escribe los resultados en **JSONL por
comuna**, sin base de datos ni Redis.

## Estado actual del proyecto

El scraper **funciona y extrae predios reales** —rol, avalúo (total/afecto/
exento), lat/long, dirección, área homogénea y superficie— a archivos JSONL.

- **Sin infraestructura:** no usa PostgreSQL ni Redis. Solo `aiohttp` (+
  `python-dotenv` para el `.env` del proxy). El progreso reanudable vive en
  archivos de checkpoint bajo `output/`.
- **4 etapas:** `regiones` (catálogo región→comunas), `manzanas`
  (descubrimiento), `predios` (extracción) y `found-predios` (enriquecimiento).
  Cada una es reanudable vía checkpoint.
- **Selección por región:** además de listar comunas a mano, el config acepta
  `regiones: [id]` y expande a todas las comunas de esas regiones (vía
  `listRegiones`), uniéndolas con las `comunas` explícitas.
- **Capas WMS dinámicas por comuna** (ver más abajo): funciona para cualquier
  comuna que el SII exponga, no solo una hardcodeada.
- **Tests:** 82 tests (`pytest -q`), verdes.

### Qué comunas devuelven datos

El scraper itera IDs enteros `(manzana, predio)`. La mayoría de las comunas
responden con predios reales desde IDs bajos; por ejemplo (verificado):

| Comuna | `comuna_id` | Resultado |
|---|---|---|
| Puente Alto | `16301` | predios desde manzana 1 |
| Santiago | `13101` | predios desde manzana 1 |
| Las Condes | `15108` | predios (manzanas ~100+) |
| Providencia | `15103` | predios (manzanas ~100+) |
| Vitacura | `15160` | predios reales, pero en manzanas **dispersas y altas** (111, 113, …) |

> ⚠️ **Manzanas dispersas / en IDs altos (Vitacura y similares):** algunas comunas
> tienen sus manzanas en IDs altos y salteados. Vitacura, p.ej., no tiene nada en
> los IDs bajos y sus manzanas van del **103 al 3625** (verificado). Con un
> `manzana_max` chico (p.ej. `20`) no encuentras nada aunque **sí** haya predios.
> Dos salidas: subir `manzana_max` (500+) / usar la ventana `manzana_min`, o —lo
> más robusto— usar la etapa **`manzanas-geo`** (descubrimiento por coordenada, ver
> Uso), que encuentra los IDs reales sin adivinar. El `config.example.json` viene
> con **Puente Alto (16301)**, denso y desde IDs bajos, ideal para una prueba
> rápida con la enumeración clásica.

## Instalación

```bash
cd sii-scraper
python3 -m venv venv && . venv/bin/activate
pip install -r requirements-dev.txt   # o requirements.txt para solo runtime
```

## Configuración

Copia `config.example.json` a `config.json` y ajústalo. Ejemplo completo:

```json
{
  "comunas":  [ { "comuna_id": 16301, "nombre_comuna": "Puente Alto" } ],
  "regiones": [],
  "ranges":   { "manzana_max": 500, "manzana_probe_depth": 60, "predio_max": 150 },
  "limits":   { "max_concurrency": 2, "requests_per_second": 3, "max_retries": 5, "backoff_base": 2 },
  "output_dir": "output"
}
```

Regla mental: **`comunas`/`regiones` = qué** raspar · **`ranges` = cuánto** de cada
comuna · **`limits` = qué tan rápido/resiliente** · **`output_dir` = dónde**.

### `comunas` — qué comunas raspar

Lista de objetos `{comuna_id, nombre_comuna}`.

- **`comuna_id`**: el código interno del SII (es lo que importa para la API).
  Ej.: Puente Alto `16301`, Santiago `13101`, Las Condes `15108`, Vitacura
  `15160`. Los descubres con la etapa `regiones` (ver `output/regiones.jsonl`).
- **`nombre_comuna`**: es **cosmético** — solo nombra el archivo de salida (slug:
  "Puente Alto" → `puente_alto.jsonl`) y aparece en los logs. No necesita
  coincidir exacto con el nombre oficial del SII.

> ⚠️ Ojo: comunas como **Vitacura (15160)** tienen las manzanas en IDs altos y
> dispersos (111, 113, …), no desde 1. Con `manzana_max` bajo dan un
> `manzanas/*.jsonl` vacío **aunque sí tengan predios** — sube `manzana_max` o usa
> `manzana_min` (ver `ranges` más abajo).

### `regiones` — atajo por región (opcional)

Lista de IDs de región (1-16; ver `regiones.jsonl`). Si pones `[13]`, el scraper
llama a `listRegiones`, toma **todas las comunas de esa región** y las agrega a la
lista a procesar. Se **combina** con `comunas` (unión, dedup por `comuna_id`; si
una comuna aparece en ambos, conserva el `nombre_comuna` que pusiste a mano).

- `[]` (o ausente) → se usa solo `comunas`.
- `comunas` **y** `regiones` ambos vacíos + una etapa de scraping → error claro.

### `ranges` — cuánto del espacio de IDs se barre

El scraper **itera IDs enteros** `(manzana, predio)`; no existe un "listar todo".
Estos números acotan esa iteración:

- **`manzana_min` / `manzana_max`** — la etapa `manzanas` prueba los IDs de
  manzana en el rango **`[manzana_min, manzana_max)`** (min incluido, max
  excluido). `manzana_min` es **opcional, default `0`** → con `0` equivale al
  clásico `0 .. manzana_max-1`, así que nada cambia si no lo defines. Sirve para
  **particionar** un barrido grande en ventanas (0-500, 500-1000, … en corridas
  separadas o en paralelo) o para **saltar un rango bajo** que sabes vacío en
  comunas con IDs de manzana altos. Se valida `0 ≤ manzana_min < manzana_max`.
  Las manzanas reales están en IDs bajos y contiguos; subir el tope cubre comunas
  grandes, pero cada ID inexistente cuesta caro (ver el siguiente).
- **`manzana_probe_depth`** — para decidir si una manzana **existe**, la etapa
  `manzanas` sondea sus predios `0` a `depth-1`. Si **alguno** devuelve datos, la
  manzana existe (corta ahí y la guarda); si **todos** salen vacíos, la descarta.
  ⚠️ Una manzana inexistente gasta las `depth` peticiones completas (con `60`,
  son 60 requests por cada ID muerto).
- **`predio_max`** — con las manzanas ya conocidas, la etapa `predios` itera los
  predios `0` a `predio_max-1` de cada una y guarda los que existen. Si una
  manzana tiene **más** predios que `predio_max`, te pierdes el resto → déjalo
  holgado.

Qué campo de `ranges` usa cada etapa:

| Etapa | Usa |
|---|---|
| `regiones` | ninguno (vuelca el catálogo completo del país) |
| `manzanas` | `manzana_min`, `manzana_max`, `manzana_probe_depth` |
| `predios` | `predio_max` (recorre las manzanas ya halladas) |
| `found-predios` | ninguno (recorre los predios ya hallados) |

Valores según el objetivo:

| | `manzana_max` | `manzana_probe_depth` | `predio_max` |
|---|---|---|---|
| Prueba rápida | `15` | `5` | `10` |
| Barrido completo | `500`+ | `60` | `150` |

### `limits` — velocidad y resiliencia (anti-429)

- **`max_concurrency`** — máximo de peticiones **simultáneas** en vuelo
  (`asyncio.Semaphore`). Con `2`, nunca hay más de 2 requests a la vez.
- **`requests_per_second`** — tope de peticiones por segundo (token-bucket).
  Junto con `max_concurrency` es el dial anti-`429`: bajos = lento pero estable;
  altos = `429`. Recomendado **2-3**.
- **`max_retries`** — cuántas veces reintenta **una** petición ante `429`/error de
  red antes de rendirse (`RetriesExhausted`; esa unidad se reintenta en la
  próxima corrida, no se pierde).
- **`backoff_base`** — base del backoff exponencial entre reintentos: espera
  `backoff_base^intento` segundos. Con `2`: 2s, 4s, 8s, 16s, 32s. Entre
  reintentos también renueva la sesión (cookies nuevas, e IP nueva si hay proxy).

### `output_dir` — dónde se guarda todo

Carpeta raíz de la salida (default `"output"`). Debajo se crean `manzanas/`,
`predios/`, `found_predios/`, `checkpoints/` y `regiones.jsonl`. Acepta ruta
relativa (respecto a donde corres `run.py`) o absoluta.

### `geo` — descubrimiento geográfico (etapa `manzanas-geo`)

Sección **opcional**, solo la usa la etapa alternativa `manzanas-geo` (ver Uso):

```json
"geo": { "grid_step_m": 100, "radius_km": 8 }
```

- **`grid_step_m`** (default `100`): paso de la grilla en metros. Menor = más
  puntos (menos riesgo de saltarse una manzana chica) pero más peticiones.
- **`radius_km`** (opcional): semi-lado del bbox alrededor del centro de la comuna.
  Si no se define, se deriva del `zoom` que el SII reporta para la comuna. Súbelo
  si una comuna grande queda parcialmente fuera del área barrida.

## Uso

Catálogo de regiones y sus comunas (para descubrir `comuna_id`):

```bash
python run.py regiones --config config.json   # → output/regiones.jsonl (una región por línea)
```

También puedes seleccionar comunas por región en `config.json` sin listarlas a
mano — por ejemplo `"regiones": [13]` procesa toda la Región Metropolitana sin
enumerarlas una por una.

Las 3 etapas de scraping van **en orden** — cada una lee la salida de la
anterior, así que el orden no es negociable:

```bash
python run.py manzanas       --config config.json   # 1. descubrir manzanas
python run.py predios        --config config.json   # 2. extraer predios  ← este te da los predios
python run.py found-predios  --config config.json   # 3. enriquecer predios (opcional)
```

`predios` **no encuentra nada si antes no corriste `manzanas`** (lee
`output/manzanas/<comuna>.jsonl`), y `found-predios` necesita que `predios` haya
corrido. La etapa `regiones` es independiente: solo genera el catálogo.

### Alternativa: `manzanas-geo` (descubrimiento geográfico)

En vez de `manzanas` (que enumera IDs `manzana_min..manzana_max` a ciegas), puedes
descubrir las manzanas **por coordenada**, y luego seguir igual con `predios`:

```bash
python run.py manzanas-geo --config config.json   # descubre manzanas → mismo manzanas/<comuna>.jsonl
python run.py predios      --config config.json   # luego, idéntico a siempre
```

`manzanas-geo` consulta `getFeatureInfo` (la misma llamada que el visor hace al
clickear una parcela) sobre una **grilla de puntos** que cubre el área de la comuna
y junta los `manzana_id` reales que encuentra (filtrando por `comuna_id`). Es la vía
robusta para comunas **dispersas o de IDs altos**, donde la enumeración no llega o
es cara — p.ej. **Vitacura**, cuyas manzanas van del **103 al 3625** (verificado:
52 manzanas descubiertas → cientos de predios). Produce el mismo
`manzanas/<comuna>.jsonl`, así que `predios` lo consume sin cambios. Es un barrido
grande pero **reanudable**; se ajusta con la sección `geo` del config.

Salida:

```
output/
├── regiones.jsonl               # catálogo región→comunas (etapa `regiones`)
├── manzanas/<comuna>.jsonl
├── predios/<comuna>.jsonl
├── found_predios/<comuna>.jsonl
└── checkpoints/<etapa>_<comuna>.json   # progreso reanudable
```

Cada etapa es **reanudable**: si se interrumpe, al volver a correr salta lo ya
procesado gracias al checkpoint.

## Tests

```bash
pytest -q
```

## Proxy: ¿es necesario?

**No es estrictamente obligatorio.** Con conexión directa (sin proxy) y a ritmo
bajo (`requests_per_second: 2-3`) el scraper obtiene predios sin problemas
—verificado: 6/6 peticiones `200` con datos a Puente Alto, 0 bloqueos—. Pero el
SII **puede bloquear la IP de origen** en corridas sostenidas: se ha observado
`429` al 100% desde una misma IP tras un rato de uso continuo. Regla práctica:

- **Uso liviano / pruebas / pocas comunas:** sin proxy está bien.
- **Corridas masivas o sostenidas (muchas comunas, horas):** usa un proxy
  rotativo (residencial). Es la forma fiable de sobrevivir a bloqueos por IP:
  cuando el WAF corta, el scraper reconstruye la sesión con una **IP nueva** y
  sigue. Sin proxy, un bloqueo por IP detiene todo hasta que esa IP se libere.

Para activarlo, definir estas 4 variables de entorno — no van en `config.json`.
Se pueden exportar en la shell, o poner en un archivo `sii-scraper/.env` (se
carga solo al arrancar `run.py`; `.env` está en `.gitignore`, nunca se
commitea). Son las mismas de la cuenta **SmartProxy CL** ya usada en el resto
de `casafari-mio` (ver `.env.example` raíz y `scraper/lib/fetch.mjs`, perfil
`portalinmobiliario`) — misma cuenta residencial dedicada a Chile, sin
necesidad de contratar un proveedor aparte:

```bash
# sii-scraper/.env
SMARTPROXY_CL_HOST=us.smartproxy.net
SMARTPROXY_CL_PORT=3121
SMARTPROXY_CL_USER=...
SMARTPROXY_CL_PASS=...
```

Si no se configuran las 4, el scraper usa conexión directa (comportamiento
por defecto, sin cambios).

**Estrategia: sticky por sesión (username), rotando en cada refresh.**
SmartProxy no ata la IP al puerto (como algunos proveedores alternativos)
sino a un **identificador de sesión** agregado al username
(`usuario-session-<id>`): mientras se reutilice el mismo `<id>`, las
peticiones salen por la misma IP; un `<id>` distinto da una IP distinta.

Mientras dura un set de cookies de sesión/WAF, todas las peticiones deben
salir por la misma IP (evita que el WAF vea cookies válidas llegando desde
una IP distinta), así que el scraper genera un `<id>` de sesión nuevo cada
vez que la sesión se reconstruye (bootstrap inicial, y cada `refresh()` tras
agotar reintentos / 429 sostenido) — una identidad realmente nueva (IP +
cookies) al recuperarse de un bloqueo, mientras se mantiene una única IP
consistente durante la vida de una sesión que sí está funcionando (coherente
con las cookies que esa IP obtuvo).

## Rate limit del SII y recomendaciones

El SII protege `mapasFacadeService` con límites por IP. En las pruebas:

- **A ritmo bajo** (`requests_per_second: 2-3`, `max_concurrency: 1-2`) el
  endpoint `getPredioNacional` responde estable, con `200` limpios y sin
  bloqueos.
- **A ritmo alto o en ráfagas** (p.ej. `requests_per_second: 5` con
  `max_concurrency: 2`) aparece **`429` sostenido** casi de inmediato: el WAF
  empieza a rechazar y el scraper entra en backoff + renovación de sesión.
- Los endpoints de catálogo (`listComunas`, `listRegiones`,
  `listServiciosComunas`) son livianos y responden de forma fiable incluso
  cuando `getPredioNacional` —el endpoint pesado— está siendo limitado.

**Recomendación:** para corridas reales mantén `requests_per_second` en **2-3**
y `max_concurrency` en **1-2**. Es más lento, pero evita el `429`; como cada
etapa es reanudable, puedes dejarlo trabajando por tramos. (El
`config.example.json` ya viene con estos valores.)

El scraper ya maneja el rate limit por sí solo:

- `asyncio` + `aiohttp` con sesión compartida (mantiene las cookies del WAF).
- Concurrencia acotada por semáforo + tope de req/s por token-bucket.
- Ante `429`/errores: backoff exponencial y renovación de sesión (cookies
  nuevas, y una **IP nueva** si hay proxy configurado).

> **Nota para corridas grandes:** el SII protege el servicio con Queue-it y
> Dynatrace, cuyas cookies las genera JavaScript del navegador y no un cliente
> HTTP plano. En volúmenes altos esto puede traducirse en algunos `504`
> (gateway timeout) o desprioritización de las peticiones. No es fatal: los
> reintentos, la renovación de sesión y los checkpoints reanudables lo
> absorben — pero es otra razón para ir lento.

## Capas WMS por comuna

Los campos `area_homogenea` y `superficie` (extraídos de capas WMS del SII) se
resuelven dinámicamente por comuna mediante el endpoint `listServiciosComunas`
del SII: se toma la capa "Predios" (única) y la revisión de "Área Homogénea"
más vigente (la de menor `orden` entre las disponibles para esa comuna), en
vez de valores fijos para una sola comuna. Esto permite que el scraper
funcione correctamente para cualquier comuna que el SII exponga en ese
servicio. El resultado se cachea por comuna durante la corrida (una sola
consulta a `listServiciosComunas` por comuna, sin importar cuántos predios se
procesen).

Si para una comuna en particular no se encuentra la capa "Predios" y/o
"Área Homogénea", se registra una advertencia (WARNING) en los logs
indicando qué capa falta para esa comuna; los demás campos de predio (rol,
avalúo, dirección, ubicación) no se ven afectados.
