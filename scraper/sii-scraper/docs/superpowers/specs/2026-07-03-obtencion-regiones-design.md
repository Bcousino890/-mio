# Diseño: obtención de regiones (`listRegiones`) y selección de comunas por región

- **Fecha:** 2026-07-03
- **Estado:** Aprobado
- **Componente:** `sii-scraper`

## Contexto y problema

El scraper hoy trabaja sobre una lista de comunas **hardcodeada** en `config.json`
(`comunas: [{comuna_id, nombre_comuna}]`). Para saber qué comunas existen hay que
conocer sus `comuna_id` de antemano. El SII expone un endpoint
`listRegiones` que devuelve la jerarquía completa **región → comunas** en una sola
llamada, que es justo lo que falta para poder seleccionar trabajo por región sin
listar comunas a mano.

Dato clave: la membresía región↔comuna **solo** se conoce vía `listRegiones`. El
prefijo del `codigo` de comuna NO coincide con el número de región (p. ej.
`VITACURA = 15160` pertenece a la región `13` "METROPOLITANA"). Por eso este
endpoint es imprescindible; no se puede derivar del código.

El cliente actual tiene `listComunas` (catálogo plano, usado solo como sanity
check), `listServiciosComunas` (resuelve capas WMS por comuna) y
`getPredioNacional`. **No** tiene obtención de regiones.

## Objetivo

1. **Comando de catálogo:** una etapa nueva `regiones` que baja el árbol
   región→comunas a `output/regiones.jsonl` para consulta/copia manual.
2. **Selección por región en config:** un campo opcional aditivo `regiones` en
   `config.json` que expande a todas las comunas de esas regiones y se fusiona con
   las `comunas` explícitas.

## Alcance

**Incluye:**
- Método de cliente `get_regiones()`.
- Parseo de la respuesta `listRegiones` a dataclasses de dominio.
- Etapa/comando `regiones` que escribe `output/regiones.jsonl`.
- Campo `regiones: [int]` en config + resolución/expansión a comunas.
- Tests (TDD) y sección en el README.

**No incluye:**
- Cambios en la lógica de scraping de manzanas/predios (las etapas siguen
  iterando `config.comunas`).
- Filtrar comunas "sin predios" (p. ej. Vitacura devuelve vacío): la expansión
  incluye todas las comunas que el SII lista para la región; las vacías
  simplemente no arrojan predios.

## Decisiones de diseño

- **Enfoque A — resolver en el orquestador.** Un módulo `pipeline/regiones.py`
  contiene el comando de catálogo y el helper `resolve_comunas()`. El orquestador,
  para las etapas de scraping, expande regiones→comunas, fusiona con las comunas
  explícitas (dedup) y reemplaza `config.comunas` con `dataclasses.replace`. Las 3
  etapas de scraping **no se tocan**. (Alternativas descartadas: B, cada etapa
  resuelve → duplica lógica y toca 3 archivos; C, expandir al cargar config →
  obligaría a `load_config` a hacer red/async y mezclar E/S con parseo.)
- **Config aditivo.** `regiones` es opcional; se combina con `comunas` (unión con
  dedup por `comuna_id`). Si solo usas `comunas`, el comportamiento no cambia.
- **Catálogo JSONL, una línea por región**, comunas anidadas.
- **Fallo fuerte** si se pide una región y la expansión (`listRegiones`) falla: no
  se scrapea un set parcial en silencio.

## Componentes

### 1. `client/sii_client.py`
- `_regiones_payload() -> dict`: como `_comunas_payload()` pero namespace
  `cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces.MapasFacadeService/listRegiones`
  y `transactionId: "listRegiones"`. Sin bloque `data`.
- `async def get_regiones(self) -> dict`:
  `return await self._post("listRegiones", _regiones_payload())`.
  Reusa rate-limiter, semáforo, reintentos y rotación de IP existentes.

### 2. `domain/models.py`
- `@dataclass ComunaRef: comuna_id: int; nombre: str`
- `@dataclass Region: region_id: int; nombre: str; comunas: list[ComunaRef]`
- `def parse_regiones(raw: dict) -> list[Region]`:
  - Lee `raw["data"]`; si es `None`/vacío → `[]`.
  - Por cada región: `region_id = int(r["codigo"])`, `nombre = r["nombre"]`,
    y por cada comuna `ComunaRef(comuna_id=int(c["codigo"]), nombre=c["nombre"])`.
    (El `codigo` de comuna viene como **string** en la respuesta; se normaliza a
    `int`.)

### 3. `pipeline/regiones.py`
- `async def run_regiones_stage(client, config) -> None`:
  `get_regiones()` → `parse_regiones()` → escribe `output/regiones.jsonl` con el
  `JsonlWriter` existente, **una línea por región**:
  ```json
  {"region_id": 13, "nombre": "METROPOLITANA", "comunas": [{"comuna_id": 15160, "nombre": "VITACURA"}, ...]}
  ```
- `async def resolve_comunas(client, config) -> list[ComunaConfig]`:
  - Parte de `config.comunas` (explícitas).
  - Si `config.regiones` no está vacío: `get_regiones()` → `parse_regiones()`,
    construye mapa `region_id -> [ComunaRef]`, expande cada región pedida.
  - Región pedida que no existe en la respuesta → `logger.warning(...)` y se salta.
  - Fusiona explícitas + expandidas y **deduplica por `comuna_id`** (la entrada
    explícita conserva su `nombre_comuna`).
  - Devuelve `list[ComunaConfig]`.

### 4. `config.py`
- `Config` gana `regiones: list[int]` (default `[]`).
- `load_config`: parsea `raw.get("regiones") or []` a `list[int]`.
- **Cambio de comportamiento:** hoy `load_config` lanza
  `ValueError("config.comunas no puede estar vacío")`. Se **elimina** esa
  validación temprana; ahora es válido tener `comunas` vacío (p. ej. para correr
  el comando `regiones`, o cuando solo se usa `regiones`). El chequeo "necesito ≥1
  comuna para scrapear" se mueve al runtime de las etapas de scraping (ver §5).
  Se sigue validando cada entrada de `comunas` presente y los límites
  (`requests_per_second`, `max_concurrency`).

### 5. `orchestrator.py`
- `STAGES["regiones"] = run_regiones_stage`.
- Conjunto `SCRAPING_STAGES = {"manzanas", "predios", "found-predios"}`.
- En `run_stage`, tras construir el cliente y antes de invocar la etapa: si
  `stage in SCRAPING_STAGES`:
  ```python
  config = replace(config, comunas=await resolve_comunas(client, config))
  if not config.comunas:
      raise ValueError("No hay comunas para procesar: define 'comunas' o 'regiones' en el config")
  ```
  El comando `regiones` no pasa por la resolución (dumpea todo el árbol).

## Flujo de datos

**Catálogo:**
```
run.py regiones → run_stage("regiones", config)
  → client.get_regiones() → parse_regiones() → output/regiones.jsonl (1 línea/región)
```

**Scraping con selección por región:**
```
run.py predios  (config: regiones=[13], comunas=[...])
  → run_stage → resolve_comunas(client, config)
       explícitas + expansión de get_regiones()  →  merge + dedup por comuna_id
     → config = replace(config, comunas=resueltas)
  → run_predios_stage(client, config)   # sin cambios; itera config.comunas
```

## Manejo de errores

- **Catálogo:** si `listRegiones` agota reintentos (`RetriesExhausted`) u otro
  error, propaga error claro; no escribe archivo parcial.
- **Scraping:** si `config.regiones` no está vacío y la expansión falla → falla
  fuerte (propaga). No se procede con un subconjunto silencioso.
- **Región inexistente** en la respuesta → WARNING y se salta esa región (no
  aborta si hay otras regiones/comunas válidas).
- **Resultado vacío** tras resolver (sin comunas ni regiones válidas) → `ValueError`
  claro en el orquestador.

## Plan de testing (TDD)

- `test_models.py` / nuevo `test_regiones` :
  - `parse_regiones` con muestra recortada (2 regiones, comunas con `codigo`
    string) → `Region`/`ComunaRef` con `comuna_id` int.
  - `parse_regiones({"data": None})` → `[]`.
- `resolve_comunas` (cliente fake que devuelve un `listRegiones` canónico):
  - solo `comunas` (sin `regiones`) → devuelve las explícitas sin llamar a red.
  - solo `regiones` → expande a las comunas de esa región.
  - `comunas` + `regiones` con solape → dedup por `comuna_id` (una sola vez).
  - `regiones` con id inexistente → warning + se salta.
  - resultado vacío → el orquestador lanza `ValueError` (test a nivel de
    orquestador o del resolver según convenga).
- `run_regiones_stage` con cliente fake → escribe `regiones.jsonl` con las líneas
  esperadas (tmp dir, reusa patrón de `test_pipeline_*`).
- `test_config.py`:
  - `regiones` se parsea a `list[int]`; default `[]`.
  - **Actualizar** el test que hoy espera `ValueError` con `comunas` vacío: ese
    caso ya no debe lanzar en `load_config`.

## Cambios incompatibles

- `load_config` ya no lanza con `comunas` vacío. Único test afectado conocido: el
  de `test_config.py` que verifica ese error (se actualiza para reflejar el nuevo
  contrato: la validación de "≥1 comuna" ocurre al correr una etapa de scraping).

## Uso resultante

```bash
# 1. Bajar el catálogo región→comunas
python run.py regiones --config config.json      # → output/regiones.jsonl

# 2. En config.json:  "regiones": [13]   (toda la Región Metropolitana)
python run.py manzanas --config config.json
python run.py predios  --config config.json
```

Se agrega una sección al `README.md` documentando el comando `regiones` y el campo
`regiones` del config.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `sii_scraper/client/sii_client.py` | `_regiones_payload()`, `get_regiones()` |
| `sii_scraper/domain/models.py` | `ComunaRef`, `Region`, `parse_regiones()` |
| `sii_scraper/pipeline/regiones.py` | **nuevo**: `run_regiones_stage()`, `resolve_comunas()` |
| `sii_scraper/config.py` | campo `regiones`, relajar validación de `comunas` |
| `sii_scraper/orchestrator.py` | registrar etapa `regiones`, resolver comunas para scraping |
| `tests/…` | tests de `parse_regiones`, `resolve_comunas`, `run_regiones_stage`, config |
| `config.example.json` / `README.md` | documentar `regiones` |
