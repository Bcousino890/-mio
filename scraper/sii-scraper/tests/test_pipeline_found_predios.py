import json
from sii_scraper.client.sii_client import RetriesExhausted
from sii_scraper.config import Config, ComunaConfig
from sii_scraper.pipeline.found_predios import run_found_predios_stage
from sii_scraper.pipeline._io import read_jsonl
from sii_scraper.storage.checkpoint import Checkpoint


class FakeClient:
    def __init__(self, hits, raises=None):
        self.hits = hits
        self.raises = raises or set()  # set de (manzana_id, predio_id) que agotan reintentos
        self.calls = 0

    async def fetch_predio(self, comuna_id, manzana_id, predio_id):
        self.calls += 1
        if (manzana_id, predio_id) in self.raises:
            raise RetriesExhausted("agotados los reintentos")
        return {"data": self.hits.get((manzana_id, predio_id))}


def _config(tmp_path):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=4, manzana_probe_depth=5, predio_max=3,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
    )


def _seed_predios(tmp_path, rols):
    d = tmp_path / "predios"
    d.mkdir(parents=True)
    with open(d / "vitacura.jsonl", "w") as f:
        for rol in rols:
            f.write(json.dumps({"rol_predio": rol}) + "\n")


async def test_run_found_predios_enriches(tmp_path):
    _seed_predios(tmp_path, ["7-2"])
    client = FakeClient(hits={(7, 2): {
        "rol": "7-2", "valorTotal": 300,
        "datosCapas": [{"titulo": "Homo",
                        "datos": [{"etiqueta": "Superficie", "valor": "250"}]}],
    }})
    await run_found_predios_stage(client, _config(tmp_path))

    rows = read_jsonl(str(tmp_path / "found_predios" / "vitacura.jsonl"))
    assert len(rows) == 1
    assert rows[0]["rol_predio"] == "7-2"
    assert rows[0]["superficie"] == "250"
    assert rows[0]["extra_data"]["comuna_id"] == 15160


async def test_run_found_predios_resumes(tmp_path):
    _seed_predios(tmp_path, ["7-2"])
    cfg = _config(tmp_path)
    c1 = FakeClient(hits={(7, 2): {"rol": "7-2"}})
    await run_found_predios_stage(c1, cfg)
    c2 = FakeClient(hits={(7, 2): {"rol": "7-2"}})
    await run_found_predios_stage(c2, cfg)
    assert c2.calls == 0


async def test_run_found_predios_survives_malformed_rol(tmp_path):
    _seed_predios(tmp_path, ["not-a-valid-rol", "7-2"])
    client = FakeClient(hits={(7, 2): {"rol": "7-2", "valorTotal": 300}})
    await run_found_predios_stage(client, _config(tmp_path))

    rows = read_jsonl(str(tmp_path / "found_predios" / "vitacura.jsonl"))
    assert len(rows) == 1
    assert rows[0]["rol_predio"] == "7-2"

    ck = json.loads((tmp_path / "checkpoints" / "found_predios_vitacura.json").read_text())
    assert set(ck["done"]) == {"not-a-valid-rol", "7-2"}


async def test_run_found_predios_leaves_unprocessed_on_retries_exhausted(tmp_path):
    _seed_predios(tmp_path, ["7-1", "7-2"])
    client = FakeClient(
        hits={(7, 2): {"rol": "7-2", "valorTotal": 300}},
        raises={(7, 1)},
    )
    await run_found_predios_stage(client, _config(tmp_path))

    rows = read_jsonl(str(tmp_path / "found_predios" / "vitacura.jsonl"))
    assert len(rows) == 1
    assert rows[0]["rol_predio"] == "7-2"

    ck_path = str(tmp_path / "checkpoints" / "found_predios_vitacura.json")
    ckpt = Checkpoint(ck_path)
    # rol procesado con éxito: se marca done
    assert ckpt.is_processed("7-2") is True
    # agotamiento de reintentos: NO se marca done, se reintentará en la próxima corrida
    # (a diferencia de un rol malformado, ver test_run_found_predios_survives_malformed_rol)
    assert ckpt.is_processed("7-1") is False
