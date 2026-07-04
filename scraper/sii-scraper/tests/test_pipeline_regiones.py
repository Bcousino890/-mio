import json
import logging
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


async def test_resolve_comunas_unknown_region_skipped(tmp_path, caplog):
    client = FakeClient()
    cfg = _config(tmp_path, comunas=[(16301, "Puente Alto")], regiones=[999])
    with caplog.at_level(logging.WARNING):
        out = await resolve_comunas(client, cfg)
    assert out == [ComunaConfig(16301, "Puente Alto")]  # región 999 omitida
    assert any("999" in r.message and "no existe" in r.message for r in caplog.records)


async def test_run_regiones_stage_is_idempotent(tmp_path):
    client = FakeClient()
    cfg = _config(tmp_path)
    await run_regiones_stage(client, cfg)
    await run_regiones_stage(client, cfg)  # segunda corrida no debe duplicar
    out = tmp_path / "regiones.jsonl"
    rows = out.read_text().splitlines()
    assert len(rows) == 2  # 2 regiones en REGIONES_RAW, no 4
