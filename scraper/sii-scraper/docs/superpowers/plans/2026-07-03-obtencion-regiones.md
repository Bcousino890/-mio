# Obtención de regiones (`listRegiones`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar obtención de regiones del SII (`listRegiones`): un comando `regiones` que baja el catálogo región→comunas a JSONL, y un campo opcional `regiones` en el config que expande a todas las comunas de esas regiones para el scraping.

**Architecture:** Enfoque A (resolver en el orquestador). Un módulo nuevo `pipeline/regiones.py` contiene el comando de catálogo (`run_regiones_stage`) y un helper `resolve_comunas()`. El orquestador, para las etapas de scraping, expande regiones→comunas, fusiona con las comunas explícitas (dedup por `comuna_id`) y reemplaza `config.comunas` con `dataclasses.replace`. Las 3 etapas de scraping no se tocan.

**Tech Stack:** Python 3.10, asyncio, aiohttp; tests con pytest + pytest-asyncio (modo auto) + aioresponses.

## Global Constraints

- Runtime deps limitadas a `aiohttp` y `python-dotenv` (ver `requirements.txt`); no agregar dependencias nuevas.
- Estilo JSONL de salida vía `JsonlWriter` (una línea JSON por registro, `ensure_ascii=False`).
- Tests `async def` corren sin marcador (pytest-asyncio en modo auto, ver `tests/conftest.py`).
- El `codigo` de comuna en `listRegiones` viene como **string** (ej. `"15160"`) y el `codigo` de región como **int** (ej. `13`); ambos se normalizan a `int`.
- Comunas se identifican por `comuna_id` (== `codigo` del catálogo del SII); la membresía región↔comuna solo se conoce vía `listRegiones`.
- Mensajes de log/errores en español, consistentes con el código existente.
- Commits en español, estilo conventional commits con scope `sii-scraper` (ej. `feat(sii-scraper): ...`).

---

### Task 1: Cliente — `get_regiones()`

**Files:**
- Modify: `sii_scraper/client/sii_client.py` (agregar `_regiones_payload()` tras `_comunas_payload()`; agregar método `get_regiones()` tras `get_comunas()`)
- Test: `tests/test_sii_client.py`

**Interfaces:**
- Consumes: `SIIClient._post(method, payload)` (existente).
- Produces:
  - `_regiones_payload() -> dict`
  - `SIIClient.get_regiones() -> dict` (devuelve el JSON crudo de `listRegiones`)

- [ ] **Step 1: Write the failing tests**

En `tests/test_sii_client.py`, agregar al final del archivo:

```python
def test_regiones_payload_namespace():
    from sii_scraper.client.sii_client import _regiones_payload
    p = _regiones_payload()
    assert p["metaData"]["transactionId"] == "listRegiones"
    assert p["metaData"]["namespace"].endswith("/listRegiones")
    assert "data" not in p


async def test_get_regiones_ok():
    url = f"{SERVICE_URL}/listRegiones"
    payload = {"data": [{"codigo": 1, "nombre": "REGIÓN DE TARAPACÁ",
                         "comunas": [{"codigo": "1201", "nombre": "IQUIQUE"}]}]}
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(url, status=200, payload=payload,
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.get_regiones()
        assert out == payload
        await client.session.close()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python -m pytest tests/test_sii_client.py::test_get_regiones_ok tests/test_sii_client.py::test_regiones_payload_namespace -v`
Expected: FAIL (`ImportError: cannot import name '_regiones_payload'` / `AttributeError: 'SIIClient' object has no attribute 'get_regiones'`)

- [ ] **Step 3: Implement**

En `sii_scraper/client/sii_client.py`, agregar tras la función `_comunas_payload()`:

```python
def _regiones_payload() -> dict:
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/listRegiones"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "listRegiones",
        }
    }
```

Y dentro de la clase `SIIClient`, tras el método `get_comunas()`:

```python
    async def get_regiones(self) -> dict:
        return await self._post("listRegiones", _regiones_payload())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python -m pytest tests/test_sii_client.py -v`
Expected: PASS (todos, incluidos los nuevos)

- [ ] **Step 5: Commit**

```bash
git add sii-scraper/sii_scraper/client/sii_client.py sii-scraper/tests/test_sii_client.py
git commit -m "feat(sii-scraper): agregar SIIClient.get_regiones() (listRegiones)"
```

---

### Task 2: Dominio — `parse_regiones()` + dataclasses

**Files:**
- Modify: `sii_scraper/domain/models.py` (agregar `ComunaRef`, `Region`, `parse_regiones`)
- Test: `tests/test_models.py`

**Interfaces:**
- Produces:
  - `@dataclass ComunaRef: comuna_id: int; nombre: str`
  - `@dataclass Region: region_id: int; nombre: str; comunas: list[ComunaRef]`
  - `parse_regiones(raw: dict) -> list[Region]`

- [ ] **Step 1: Write the failing tests**

En `tests/test_models.py`, agregar (ajustar el import existente de `sii_scraper.domain.models` para incluir los nuevos nombres, o añadir una línea de import nueva):

```python
from sii_scraper.domain.models import parse_regiones, Region, ComunaRef

REGIONES_RAW = {
    "data": [
        {"codigo": 1, "nombre": "REGIÓN DE TARAPACÁ",
         "comunas": [{"codigo": "1201", "nombre": "IQUIQUE"},
                     {"codigo": "1211", "nombre": "ALTO HOSPICIO"}]},
        {"codigo": 13, "nombre": "REGIÓN METROPOLITANA DE SANTIAGO",
         "comunas": [{"codigo": "15160", "nombre": "VITACURA"}]},
    ]
}


def test_parse_regiones():
    regs = parse_regiones(REGIONES_RAW)
    assert len(regs) == 2
    assert regs[0] == Region(
        region_id=1, nombre="REGIÓN DE TARAPACÁ",
        comunas=[ComunaRef(1201, "IQUIQUE"), ComunaRef(1211, "ALTO HOSPICIO")])
    # el codigo de comuna viene string y se normaliza a int
    assert regs[1].comunas[0] == ComunaRef(15160, "VITACURA")
    assert isinstance(regs[1].comunas[0].comuna_id, int)


def test_parse_regiones_empty():
    assert parse_regiones({"data": None}) == []
    assert parse_regiones({"data": []}) == []
    assert parse_regiones({}) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python -m pytest tests/test_models.py::test_parse_regiones tests/test_models.py::test_parse_regiones_empty -v`
Expected: FAIL (`ImportError: cannot import name 'parse_regiones'`)

- [ ] **Step 3: Implement**

En `sii_scraper/domain/models.py`, agregar (las dataclasses junto a `Manzana`/`Predio`, y la función junto a `parse_manzana`/`parse_predio`):

```python
@dataclass
class ComunaRef:
    comuna_id: int
    nombre: str


@dataclass
class Region:
    region_id: int
    nombre: str
    comunas: list[ComunaRef]


def parse_regiones(raw: dict) -> list[Region]:
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data:
        return []
    regiones = []
    for r in data:
        comunas = [
            ComunaRef(comuna_id=int(c["codigo"]), nombre=c["nombre"])
            for c in (r.get("comunas") or [])
        ]
        regiones.append(Region(
            region_id=int(r["codigo"]),
            nombre=r["nombre"],
            comunas=comunas,
        ))
    return regiones
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python -m pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sii-scraper/sii_scraper/domain/models.py sii-scraper/tests/test_models.py
git commit -m "feat(sii-scraper): parse_regiones() y dataclasses Region/ComunaRef"
```

---

### Task 3: Config — campo `regiones` y relajar validación de `comunas`

**Files:**
- Modify: `sii_scraper/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `Config.regiones: list[int]` (default `[]`). `load_config` ya no lanza con `comunas` vacío.
- Consumes: `ComunaConfig` (existente).

- [ ] **Step 1: Update/Write the tests**

En `tests/test_config.py`, **eliminar** `test_missing_comunas_raises` (líneas 30-33) y agregar:

```python
def test_empty_comunas_no_longer_raises(tmp_path):
    # comunas vacío ya no es error en load_config; la validación de
    # "≥1 comuna" ocurre al correr una etapa de scraping (orquestador).
    cfg = load_config(_write(tmp_path, {**VALID, "comunas": []}))
    assert cfg.comunas == []


def test_regiones_parsed(tmp_path):
    cfg = load_config(_write(tmp_path, {**VALID, "regiones": [13, 5]}))
    assert cfg.regiones == [13, 5]


def test_regiones_defaults_empty(tmp_path):
    cfg = load_config(_write(tmp_path, VALID))
    assert cfg.regiones == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python -m pytest tests/test_config.py -v`
Expected: FAIL (`test_regiones_parsed`/`test_regiones_defaults_empty`: `AttributeError: 'Config' object has no attribute 'regiones'`; `test_empty_comunas_no_longer_raises`: lanza `ValueError`)

- [ ] **Step 3: Implement**

En `sii_scraper/config.py`:

Cambiar el import de dataclasses:

```python
from dataclasses import dataclass, field
```

Agregar el campo al final de `Config` (con default, para no romper constructores existentes):

```python
@dataclass
class Config:
    comunas: list[ComunaConfig]
    manzana_max: int
    manzana_probe_depth: int
    predio_max: int
    max_concurrency: int
    requests_per_second: float
    max_retries: int
    backoff_base: float
    output_dir: str
    regiones: list[int] = field(default_factory=list)
```

Reemplazar el cuerpo de `load_config` (quitar el `raise` por comunas vacío, parsear `regiones`):

```python
def load_config(path: str) -> Config:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    comunas_raw = raw.get("comunas") or []
    comunas = [
        ComunaConfig(comuna_id=int(c["comuna_id"]), nombre_comuna=str(c["nombre_comuna"]))
        for c in comunas_raw
    ]

    regiones = [int(r) for r in (raw.get("regiones") or [])]

    ranges = raw.get("ranges", {})
    limits = raw.get("limits", {})

    rps = float(limits.get("requests_per_second", 0))
    if rps <= 0:
        raise ValueError("config.limits.requests_per_second debe ser > 0")
    conc = int(limits.get("max_concurrency", 0))
    if conc <= 0:
        raise ValueError("config.limits.max_concurrency debe ser > 0")

    return Config(
        comunas=comunas,
        regiones=regiones,
        manzana_max=int(ranges.get("manzana_max", 500)),
        manzana_probe_depth=int(ranges.get("manzana_probe_depth", 60)),
        predio_max=int(ranges.get("predio_max", 150)),
        max_concurrency=conc,
        requests_per_second=rps,
        max_retries=int(limits.get("max_retries", 5)),
        backoff_base=float(limits.get("backoff_base", 2)),
        output_dir=str(raw.get("output_dir", "output")),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python -m pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sii-scraper/sii_scraper/config.py sii-scraper/tests/test_config.py
git commit -m "feat(sii-scraper): campo config 'regiones' y comunas vacio permitido en load_config"
```

---

### Task 4: `pipeline/regiones.py` — comando catálogo + `resolve_comunas`

**Files:**
- Create: `sii_scraper/pipeline/regiones.py`
- Test: `tests/test_pipeline_regiones.py`

**Interfaces:**
- Consumes: `client.get_regiones()` (Task 1), `parse_regiones` (Task 2), `Config` con `.regiones`/`.comunas`/`.output_dir` (Task 3), `ComunaConfig`, `JsonlWriter`.
- Produces:
  - `async run_regiones_stage(client, config) -> None` (escribe `<output_dir>/regiones.jsonl`)
  - `async resolve_comunas(client, config) -> list[ComunaConfig]`

- [ ] **Step 1: Write the failing tests**

Crear `tests/test_pipeline_regiones.py`:

```python
import json
from sii_scraper.config import Config, ComunaConfig
from sii_scraper.pipeline.regiones import run_regiones_stage, resolve_comunas


REGIONES_RAW = {
    "data": [
        {"codigo": 13, "nombre": "METROPOLITANA",
         "comunas": [{"codigo": "15160", "nombre": "VITACURA"},
                     {"codigo": "16301", "nombre": "PUENTE ALTO"}]},
        {"codigo": 5, "nombre": "VALPARAÍSO",
         "comunas": [{"codigo": "5301", "nombre": "VALPARAISO"}]},
    ]
}


class FakeClient:
    def __init__(self, regiones_raw=REGIONES_RAW):
        self._regiones_raw = regiones_raw
        self.calls = 0

    async def get_regiones(self):
        self.calls += 1
        return self._regiones_raw


def _config(tmp_path, comunas=(), regiones=()):
    return Config(
        comunas=[ComunaConfig(*c) for c in comunas],
        regiones=list(regiones),
        manzana_max=4, manzana_probe_depth=5, predio_max=10,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
    )


async def test_run_regiones_stage_writes_jsonl(tmp_path):
    client = FakeClient()
    await run_regiones_stage(client, _config(tmp_path))
    out = tmp_path / "regiones.jsonl"
    rows = [json.loads(l) for l in out.read_text().splitlines()]
    assert [r["region_id"] for r in rows] == [13, 5]
    assert rows[0]["nombre"] == "METROPOLITANA"
    assert rows[0]["comunas"][0] == {"comuna_id": 15160, "nombre": "VITACURA"}


async def test_resolve_comunas_only_explicit_no_network(tmp_path):
    client = FakeClient()
    cfg = _config(tmp_path, comunas=[(16301, "Puente Alto")])
    out = await resolve_comunas(client, cfg)
    assert out == [ComunaConfig(16301, "Puente Alto")]
    assert client.calls == 0  # sin regiones -> no llama a la red


async def test_resolve_comunas_expands_region(tmp_path):
    client = FakeClient()
    cfg = _config(tmp_path, regiones=[5])
    out = await resolve_comunas(client, cfg)
    assert out == [ComunaConfig(5301, "VALPARAISO")]


async def test_resolve_comunas_merges_and_dedups(tmp_path):
    client = FakeClient()
    # 15160 aparece explícita y también dentro de la región 13
    cfg = _config(tmp_path, comunas=[(15160, "Vitacura")], regiones=[13])
    out = await resolve_comunas(client, cfg)
    assert [c.comuna_id for c in out] == [15160, 16301]  # dedup: 15160 una vez
    assert out[0] == ComunaConfig(15160, "Vitacura")     # explícita gana el nombre


async def test_resolve_comunas_unknown_region_skipped(tmp_path):
    client = FakeClient()
    cfg = _config(tmp_path, comunas=[(16301, "Puente Alto")], regiones=[999])
    out = await resolve_comunas(client, cfg)
    assert out == [ComunaConfig(16301, "Puente Alto")]  # región 999 omitida
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python -m pytest tests/test_pipeline_regiones.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'sii_scraper.pipeline.regiones'`)

- [ ] **Step 3: Implement**

Crear `sii_scraper/pipeline/regiones.py`:

```python
import logging
import os

from ..config import ComunaConfig
from ..domain.models import parse_regiones
from ..storage.jsonl_writer import JsonlWriter

logger = logging.getLogger(__name__)


async def run_regiones_stage(client, config) -> None:
    """Baja el catálogo región→comunas y lo escribe en <output_dir>/regiones.jsonl,
    una línea JSON por región con sus comunas anidadas."""
    raw = await client.get_regiones()
    regiones = parse_regiones(raw)
    out_path = os.path.join(config.output_dir, "regiones.jsonl")
    with JsonlWriter(out_path) as writer:
        for region in regiones:
            writer.append({
                "region_id": region.region_id,
                "nombre": region.nombre,
                "comunas": [
                    {"comuna_id": c.comuna_id, "nombre": c.nombre}
                    for c in region.comunas
                ],
            })
    logger.info("regiones: %d regiones escritas en %s", len(regiones), out_path)


async def resolve_comunas(client, config) -> list[ComunaConfig]:
    """Comunas a procesar: las explícitas de config.comunas más la expansión de
    config.regiones (todas las comunas de esas regiones), deduplicadas por
    comuna_id (la explícita conserva su nombre_comuna). Si config.regiones está
    vacío, no hace ninguna llamada de red."""
    result: dict[int, ComunaConfig] = {}
    for c in config.comunas:
        result.setdefault(c.comuna_id, c)

    if config.regiones:
        regiones = parse_regiones(await client.get_regiones())
        by_id = {r.region_id: r for r in regiones}
        for region_id in config.regiones:
            region = by_id.get(region_id)
            if region is None:
                logger.warning("región %s no existe en listRegiones; se omite",
                               region_id)
                continue
            for cref in region.comunas:
                if cref.comuna_id not in result:
                    result[cref.comuna_id] = ComunaConfig(
                        comuna_id=cref.comuna_id, nombre_comuna=cref.nombre)

    return list(result.values())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `./venv/bin/python -m pytest tests/test_pipeline_regiones.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sii-scraper/sii_scraper/pipeline/regiones.py sii-scraper/tests/test_pipeline_regiones.py
git commit -m "feat(sii-scraper): etapa regiones (catalogo JSONL) y resolve_comunas()"
```

---

### Task 5: Orquestador — registrar etapa `regiones` y resolver comunas para scraping

**Files:**
- Modify: `sii_scraper/orchestrator.py`
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `run_regiones_stage`, `resolve_comunas` (Task 4); `dataclasses.replace`.
- Produces: `STAGES` con la etapa `"regiones"`; `SCRAPING_STAGES`; `run_stage` resuelve comunas para etapas de scraping y lanza `ValueError` si quedan vacías.

- [ ] **Step 1: Update/Write the tests**

En `tests/test_orchestrator.py`:

Agregar `from dataclasses import replace` al inicio.

Reemplazar `test_stages_registry_has_three` (líneas 15-16) por:

```python
def test_stages_registry():
    assert set(orchestrator.STAGES) == {
        "regiones", "manzanas", "predios", "found-predios"}
```

Agregar al final del archivo:

```python
async def test_run_stage_regiones_does_not_require_comunas(tmp_path, monkeypatch):
    called = {}

    async def fake_regiones(client, config):
        called["ran"] = True

    monkeypatch.setitem(orchestrator.STAGES, "regiones", fake_regiones)

    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): called["closed"] = True

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    cfg = replace(_config(tmp_path), comunas=[], regiones=[])
    await orchestrator.run_stage("regiones", cfg)
    assert called.get("ran") and called.get("closed")


async def test_run_stage_scraping_raises_when_no_comunas(tmp_path, monkeypatch):
    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): pass

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    cfg = replace(_config(tmp_path), comunas=[], regiones=[])
    with pytest.raises(ValueError, match="comunas"):
        await orchestrator.run_stage("manzanas", cfg)


async def test_run_stage_expands_regiones_for_scraping(tmp_path, monkeypatch):
    seen = {}

    async def fake_stage(client, config):
        seen["comunas"] = [c.comuna_id for c in config.comunas]

    monkeypatch.setitem(orchestrator.STAGES, "manzanas", fake_stage)

    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): pass

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}
        async def get_regiones(self):
            return {"data": [{"codigo": 13, "nombre": "RM",
                              "comunas": [{"codigo": "15160", "nombre": "VITACURA"},
                                          {"codigo": "16301", "nombre": "PUENTE ALTO"}]}]}

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    cfg = replace(_config(tmp_path), comunas=[], regiones=[13])
    await orchestrator.run_stage("manzanas", cfg)
    assert seen["comunas"] == [15160, 16301]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./venv/bin/python -m pytest tests/test_orchestrator.py -v`
Expected: FAIL (`test_stages_registry`: falta `"regiones"`; los 3 nuevos: `ImportError`/`AttributeError` o comportamiento no implementado)

- [ ] **Step 3: Implement**

En `sii_scraper/orchestrator.py`:

Agregar imports (arriba, junto a los existentes):

```python
from dataclasses import replace
```

y con los demás imports de pipeline:

```python
from .pipeline.regiones import run_regiones_stage, resolve_comunas
```

Reemplazar el diccionario `STAGES` para incluir la etapa `regiones` y definir `SCRAPING_STAGES`:

```python
STAGES = {
    "regiones": run_regiones_stage,
    "manzanas": run_manzanas_stage,
    "predios": run_predios_stage,
    "found-predios": run_found_predios_stage,
}

SCRAPING_STAGES = {"manzanas", "predios", "found-predios"}
```

En `run_stage`, dentro del `try`, reemplazar la línea `await STAGES[stage](client, config)` por:

```python
        if stage in SCRAPING_STAGES:
            config = replace(config, comunas=await resolve_comunas(client, config))
            if not config.comunas:
                raise ValueError(
                    "No hay comunas para procesar: define 'comunas' o "
                    "'regiones' en el config")
        await STAGES[stage](client, config)
```

- [ ] **Step 4: Run the full suite**

Run: `./venv/bin/python -m pytest -q`
Expected: PASS (toda la suite, incluyendo los tests existentes de otras etapas)

- [ ] **Step 5: Commit**

```bash
git add sii-scraper/sii_scraper/orchestrator.py sii-scraper/tests/test_orchestrator.py
git commit -m "feat(sii-scraper): registrar etapa regiones y expandir regiones->comunas en el scraping"
```

---

### Task 6: Docs — README y config de ejemplo

**Files:**
- Modify: `sii-scraper/config.example.json`
- Modify: `sii-scraper/README.md`

**Interfaces:** Ninguna (documentación). Sin tests automáticos.

- [ ] **Step 1: Actualizar `config.example.json`**

Reemplazar el contenido completo de `sii-scraper/config.example.json` por (agrega `regiones` como lista vacía por defecto):

```json
{
  "comunas": [
    { "comuna_id": 15160, "nombre_comuna": "Vitacura" }
  ],
  "regiones": [],
  "ranges": {
    "manzana_max": 500,
    "manzana_probe_depth": 60,
    "predio_max": 150
  },
  "limits": {
    "max_concurrency": 8,
    "requests_per_second": 5,
    "max_retries": 5,
    "backoff_base": 2
  },
  "output_dir": "output"
}
```

- [ ] **Step 2: Documentar en `README.md`**

En `sii-scraper/README.md`, en la tabla de campos de configuración (sección "## Configuración"), agregar una fila tras la de `comunas`:

```markdown
| `regiones` | Lista opcional de IDs de región (ej. `[13]`) a expandir a todas sus comunas vía `listRegiones`. Se combina con `comunas` (unión, dedup por `comuna_id`). |
```

En la sección "## Uso", agregar el comando de catálogo antes de las 3 etapas:

```markdown
Catálogo de regiones y sus comunas (para descubrir `comuna_id`):

​```bash
python run.py regiones --config config.json   # → output/regiones.jsonl (una región por línea)
​```

También puedes seleccionar comunas por región en `config.json` sin listarlas a
mano — por ejemplo `"regiones": [13]` procesa toda la Región Metropolitana:

​```bash
python run.py manzanas --config config.json
python run.py predios  --config config.json
​```
```

Y en el árbol de salida de esa sección, agregar la línea:

```markdown
├── regiones.jsonl               # catálogo región→comunas (etapa `regiones`)
```

- [ ] **Step 3: Verificar que el ejemplo carga**

Run: `cd sii-scraper && ./venv/bin/python -c "from sii_scraper.config import load_config; c = load_config('config.example.json'); print('regiones=', c.regiones, 'comunas=', len(c.comunas))"`
Expected: `regiones= [] comunas= 1`

- [ ] **Step 4: Commit**

```bash
git add sii-scraper/config.example.json sii-scraper/README.md
git commit -m "docs(sii-scraper): documentar comando regiones y campo config regiones"
```

---

## Validación end-to-end (manual, opcional tras Task 6)

Con red real (proxy configurado en `sii-scraper/.env`), confirmar el comando nuevo:

```bash
cd sii-scraper
./venv/bin/python run.py regiones --config config.json
head -1 output/regiones.jsonl   # una región con sus comunas anidadas
```

Y la expansión por región (usar un rango chico en `ranges` y `"regiones": [13]`):

```bash
./venv/bin/python run.py manzanas --config config.json
```

> Nota operativa (de la sesión de pruebas): a `requests_per_second` alto el SII
> devuelve 429; a 2-3 req/s no hubo bloqueos. Vitacura (15160) devuelve `data:null`
> para todos los IDs; comunas como Puente Alto (16301), Santiago (13101), Las
> Condes (15108) y Providencia (15103) sí devuelven predios.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** cliente `get_regiones` (T1) ✓; `parse_regiones`/dataclasses (T2) ✓; config `regiones` + relajar validación (T3) ✓; etapa `regiones` + `resolve_comunas` (T4) ✓; orquestador registra etapa y resuelve/valida comunas (T5) ✓; errores (falla fuerte por propagación de `get_regiones`; región inexistente→WARNING; vacío→`ValueError`) cubiertos en T4/T5 ✓; docs (T6) ✓.
- **Tipos consistentes entre tareas:** `get_regiones() -> dict` (T1) lo consumen `run_regiones_stage`/`resolve_comunas` (T4); `parse_regiones(dict) -> list[Region]` con `Region.region_id/nombre/comunas` y `ComunaRef.comuna_id/nombre` (T2) usados igual en T4; `resolve_comunas(client, config) -> list[ComunaConfig]` (T4) consumido por el orquestador vía `replace(config, comunas=...)` (T5); `Config.regiones: list[int]` (T3) leído en T4/T5.
- **Sin placeholders:** cada step de código muestra el código real y cada comando su salida esperada.
