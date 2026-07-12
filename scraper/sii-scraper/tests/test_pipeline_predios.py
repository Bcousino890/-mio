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


def _config(tmp_path, predio_max=3, probe_depth=60, initial_scan=60):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=4, manzana_probe_depth=5, predio_max=predio_max,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
        predio_probe_depth=probe_depth, predio_initial_scan=initial_scan,
    )


def _seed_manzanas(tmp_path, manzana_ids):
    d = tmp_path / "manzanas"
    d.mkdir(parents=True)
    with open(d / "vitacura.jsonl", "w") as f:
        for mid in manzana_ids:
            f.write(json.dumps({"manzana_id": mid, "comuna_id": 15160}) + "\n")


def _done_path(tmp_path):
    return str(tmp_path / "checkpoints" / "predios_done_vitacura.json")


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

    # El checkpoint es por MANZANA terminada, no por predio.
    ck = json.loads((tmp_path / "checkpoints" / "predios_done_vitacura.json").read_text())
    assert set(ck["done"]) == {"7"}


async def test_run_predios_stage_resumes(tmp_path):
    _seed_manzanas(tmp_path, [7])
    cfg = _config(tmp_path)
    c1 = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    await run_predios_stage(c1, cfg)
    # Segunda corrida: la manzana 7 ya está completa → no se vuelve a consultar.
    c2 = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    await run_predios_stage(c2, cfg)
    assert c2.calls == 0


async def test_run_predios_stage_marks_manzana_done(tmp_path):
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    cfg = _config(tmp_path)
    await run_predios_stage(client, cfg)

    ckpt = Checkpoint(_done_path(tmp_path))
    assert ckpt.is_processed("7") is True


async def test_run_predios_stage_probe_stops_after_empties(tmp_path):
    # Manzana con un predio en 0 y luego solo vacíos: con probe_depth=5 y un
    # techo alto, debe cortar tras 5 vacíos seguidos (no barrer hasta el techo).
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(hits={(7, 0): {"rol": "7-0"}})
    cfg = _config(tmp_path, predio_max=1000, probe_depth=5)
    await run_predios_stage(client, cfg)

    # 1 hit (pid 0) + 5 vacíos (pid 1..5) = 6 consultas, no 1000.
    assert client.calls == 6
    ckpt = Checkpoint(_done_path(tmp_path))
    assert ckpt.is_processed("7") is True


async def test_run_predios_stage_initial_scan_empty_manzana(tmp_path):
    # Manzana sin ningún predio válido: corta tras initial_scan vacíos.
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(hits={})
    cfg = _config(tmp_path, predio_max=1000, initial_scan=8)
    await run_predios_stage(client, cfg)

    assert client.calls == 8
    ckpt = Checkpoint(_done_path(tmp_path))
    assert ckpt.is_processed("7") is True


async def test_run_predios_stage_incierto_no_marca_completa(tmp_path):
    # Si un predio agota reintentos (429), la manzana NO se marca completa, para
    # reintentarla en otra corrida; los predios que sí se leyeron se escriben.
    _seed_manzanas(tmp_path, [7])
    client = FakeClient(
        hits={(7, 0): {"rol": "7-0"}, (7, 2): {"rol": "7-2"}},
        raises={(7, 1)},
    )
    cfg = _config(tmp_path)
    await run_predios_stage(client, cfg)

    ckpt = Checkpoint(_done_path(tmp_path))
    assert ckpt.is_processed("7") is False  # se reintenta

    rows = read_jsonl(str(tmp_path / "predios" / "vitacura.jsonl"))
    assert sorted(r["rol_predio"] for r in rows) == ["7-0", "7-2"]
