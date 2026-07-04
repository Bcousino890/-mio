import json
from sii_scraper.client.sii_client import RetriesExhausted
from sii_scraper.config import Config, ComunaConfig
from sii_scraper.pipeline.predios import run_predios_stage
from sii_scraper.pipeline._io import read_jsonl
from sii_scraper.storage.checkpoint import Checkpoint


class FakeClient:
    def __init__(self, hits, raises=None):
        self.hits = hits  # dict (manzana,predio) -> data dict
        self.raises = raises or set()  # set de (manzana_id, predio_id) que agotan reintentos
        self.calls = 0

    async def fetch_predio(self, comuna_id, manzana_id, predio_id):
        self.calls += 1
        if (manzana_id, predio_id) in self.raises:
            raise RetriesExhausted("agotados los reintentos")
        data = self.hits.get((manzana_id, predio_id))
        return {"data": data}


def _config(tmp_path):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=4, manzana_probe_depth=5, predio_max=3,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
    )


def _seed_manzanas(tmp_path, manzana_ids):
    d = tmp_path / "manzanas"
    d.mkdir(parents=True)
    with open(d / "vitacura.jsonl", "w") as f:
        for mid in manzana_ids:
            f.write(json.dumps({"manzana_id": mid, "comuna_id": 15160}) + "\n")


def test_read_jsonl_missing_returns_empty(tmp_path):
    assert read_jsonl(str(tmp_path / "nope.jsonl")) == []


async def test_run_predios_stage_writes_predios(tmp_path):
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(hits={
        (7, 0): {"rol": "7-0", "valorTotal": 100},
        (7, 2): {"rol": "7-2", "valorTotal": 300},
    })
    cfg = _config(tmp_path)
    await run_predios_stage(client, cfg)

    rows = read_jsonl(str(tmp_path / "predios" / "vitacura.jsonl"))
    rols = sorted(r["rol_predio"] for r in rows)
    assert rols == ["7-0", "7-2"]

    ck = json.loads((tmp_path / "checkpoints" / "predios_vitacura.json").read_text())
    assert set(ck["done"]) == {"7-0", "7-1", "7-2"}
    assert ck["discarded"] == []


async def test_run_predios_stage_resumes(tmp_path):
    _seed_manzanas(tmp_path, [7])
    cfg = _config(tmp_path)
    c1 = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    await run_predios_stage(c1, cfg)
    c2 = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    await run_predios_stage(c2, cfg)
    assert c2.calls == 0


async def test_run_predios_stage_marks_misses_as_done_not_discarded(tmp_path):
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    cfg = _config(tmp_path)
    await run_predios_stage(client, cfg)

    ck = json.loads((tmp_path / "checkpoints" / "predios_vitacura.json").read_text())
    assert set(ck["done"]) == {"7-0", "7-1", "7-2"}
    assert ck["discarded"] == []


async def test_run_predios_stage_leaves_unprocessed_on_retries_exhausted(tmp_path):
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(
        hits={(7, 0): {"rol": "7-0"}, (7, 2): {"rol": "7-2"}},
        raises={(7, 1)},
    )
    cfg = _config(tmp_path)
    await run_predios_stage(client, cfg)

    ck_path = str(tmp_path / "checkpoints" / "predios_vitacura.json")
    ckpt = Checkpoint(ck_path)
    assert ckpt.is_processed("7-1") is False
    assert ckpt.is_processed("7-0") is True
    assert ckpt.is_processed("7-2") is True
