from dataclasses import replace

import pytest
from sii_scraper.config import Config, ComunaConfig
from sii_scraper import orchestrator


def _config(tmp_path):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=2, manzana_probe_depth=2, predio_max=2,
        max_concurrency=2, requests_per_second=1000, max_retries=2,
        backoff_base=2, output_dir=str(tmp_path),
    )


def test_stages_registry():
    assert set(orchestrator.STAGES) == {
        "regiones", "manzanas", "manzanas-geo", "predios", "found-predios"}
    # manzanas-geo es una etapa de scraping (resuelve comunas / valida no-vacío)
    assert "manzanas-geo" in orchestrator.SCRAPING_STAGES


async def test_run_stage_invokes_selected_stage(tmp_path, monkeypatch):
    called = {}

    async def fake_stage(client, config):
        called["ran"] = True

    monkeypatch.setitem(orchestrator.STAGES, "manzanas", fake_stage)

    # Evitar red: stubear session + client.get_comunas
    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): called["closed"] = True

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    await orchestrator.run_stage("manzanas", _config(tmp_path))
    assert called.get("ran") and called.get("closed")


async def test_run_stage_unknown_raises(tmp_path):
    with pytest.raises(ValueError, match="etapa"):
        await orchestrator.run_stage("nope", _config(tmp_path))


async def test_run_stage_closes_session_even_if_stage_raises(tmp_path, monkeypatch):
    called = {}

    async def failing_stage(client, config):
        raise RuntimeError("boom")

    monkeypatch.setitem(orchestrator.STAGES, "manzanas", failing_stage)

    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): called["closed"] = True

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    with pytest.raises(RuntimeError, match="boom"):
        await orchestrator.run_stage("manzanas", _config(tmp_path))
    assert called.get("closed")


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


async def test_run_stage_scraping_propagates_get_regiones_error(tmp_path, monkeypatch):
    closed = {}

    class FakeSession:
        async def get(self): return None
        async def refresh(self): return None
        async def close(self): closed["closed"] = True

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def get_comunas(self): return {"data": []}
        async def get_regiones(self):
            raise RuntimeError("listRegiones caído")

    monkeypatch.setattr(orchestrator, "SIISession", lambda: FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", FakeClient)

    cfg = replace(_config(tmp_path), comunas=[], regiones=[13])
    with pytest.raises(RuntimeError, match="listRegiones"):
        await orchestrator.run_stage("manzanas", cfg)
    assert closed.get("closed")

