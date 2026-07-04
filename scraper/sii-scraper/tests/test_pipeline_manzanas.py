import json
from sii_scraper.client.sii_client import RetriesExhausted
from sii_scraper.config import Config, ComunaConfig
from sii_scraper.pipeline.manzanas import discover_manzana, run_manzanas_stage
from sii_scraper.storage.checkpoint import Checkpoint


class FakeClient:
    """fetch_predio devuelve data solo para (manzana_id, predio_id) predefinidos."""
    def __init__(self, hits, raises=None):
        self.hits = hits  # set de (manzana_id, predio_id)
        self.raises = raises or set()  # set de manzana_id que agotan reintentos
        self.calls = 0

    async def fetch_predio(self, comuna_id, manzana_id, predio_id):
        self.calls += 1
        if manzana_id in self.raises:
            raise RetriesExhausted("agotados los reintentos")
        if (manzana_id, predio_id) in self.hits:
            return {"data": {"rol": f"{manzana_id}-{predio_id}",
                             "datosCapas": [{"titulo": "Homo",
                                             "datos": [{"etiqueta": "Homo", "valor": "AH-1"}]}]}}
        return {"data": None}


async def test_discover_manzana_found():
    client = FakeClient(hits={(3, 2)})
    m = await discover_manzana(client, comuna_id=15160, manzana_id=3, probe_depth=10)
    assert m is not None and m.manzana_id == 3 and m.area_homogenea == "AH-1"


async def test_discover_manzana_not_found():
    client = FakeClient(hits=set())
    m = await discover_manzana(client, comuna_id=15160, manzana_id=3, probe_depth=5)
    assert m is None


def _config(tmp_path):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=4, manzana_probe_depth=5, predio_max=10,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
    )


async def test_run_manzanas_stage_writes_and_checkpoints(tmp_path):
    client = FakeClient(hits={(1, 0), (3, 1)})  # manzanas 1 y 3 existen
    cfg = _config(tmp_path)
    await run_manzanas_stage(client, cfg)

    out = tmp_path / "manzanas" / "vitacura.jsonl"
    rows = [json.loads(l) for l in out.read_text().splitlines()]
    found = sorted(r["manzana_id"] for r in rows)
    assert found == [1, 3]

    ck = json.loads((tmp_path / "checkpoints" / "manzanas_vitacura.json").read_text())
    assert set(ck["done"]) == {"1", "3"}
    assert set(ck["discarded"]) == {"0", "2"}


async def test_run_manzanas_stage_resumes(tmp_path):
    cfg = _config(tmp_path)
    client1 = FakeClient(hits={(1, 0)})
    await run_manzanas_stage(client1, cfg)
    calls_after_first = client1.calls

    client2 = FakeClient(hits={(1, 0)})
    await run_manzanas_stage(client2, cfg)  # todo ya en checkpoint
    assert client2.calls == 0
    assert calls_after_first > 0


async def test_run_manzanas_stage_leaves_unprocessed_on_retries_exhausted(tmp_path):
    cfg = _config(tmp_path)
    client = FakeClient(hits={(1, 0)}, raises={2})
    await run_manzanas_stage(client, cfg)

    ck_path = str(tmp_path / "checkpoints" / "manzanas_vitacura.json")
    ckpt = Checkpoint(ck_path)
    assert ckpt.is_processed("2") is False
    assert ckpt.is_processed("1") is True


async def test_run_manzanas_stage_respects_manzana_min(tmp_path):
    # hit en manzana 1 (bajo el min, no debe probarse) y en 3 (dentro del rango)
    client = FakeClient(hits={(1, 0), (3, 0)})
    cfg = Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=5, manzana_probe_depth=5, predio_max=10,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path), manzana_min=2,
    )
    await run_manzanas_stage(client, cfg)

    out = tmp_path / "manzanas" / "vitacura.jsonl"
    rows = [json.loads(l) for l in out.read_text().splitlines()]
    assert sorted(r["manzana_id"] for r in rows) == [3]   # rango [2,5): solo el 3 tiene hit

    ck = json.loads((tmp_path / "checkpoints" / "manzanas_vitacura.json").read_text())
    assert set(ck["done"]) == {"3"}
    assert set(ck["discarded"]) == {"2", "4"}
    # la manzana 1 (bajo el min) nunca se tocó
    assert "1" not in ck["done"] and "1" not in ck["discarded"]
