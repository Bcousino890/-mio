from dataclasses import replace

from sii_scraper.config import Config, ComunaConfig
from sii_scraper import orchestrator


def _config(tmp_path, sessions=1):
    return Config(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=2, manzana_probe_depth=2, predio_max=2,
        max_concurrency=2, requests_per_second=1000, max_retries=2,
        backoff_base=2, output_dir=str(tmp_path), sessions=sessions,
    )


class _FakeSession:
    def __init__(self):
        self.closed = False

    async def get(self):
        return None

    async def refresh(self):
        return None

    async def close(self):
        self.closed = True


class _FakeClient:
    """Registra en qué instancia recayó cada fetch_predio, para verificar
    round-robin entre sesiones."""
    _next_id = 0

    def __init__(self, *a, **k):
        self.id = _FakeClient._next_id
        _FakeClient._next_id += 1
        self.calls = []

    async def get_comunas(self):
        return {"data": []}

    async def fetch_predio(self, comuna_id, manzana_id, predio_id):
        self.calls.append((comuna_id, manzana_id, predio_id))
        return {"data": None}


async def test_run_stage_creates_n_sessions_and_closes_all(tmp_path, monkeypatch):
    _FakeClient._next_id = 0
    created_sessions = []
    created_clients = []

    def make_session():
        s = _FakeSession()
        created_sessions.append(s)
        return s

    def make_client(*a, **k):
        c = _FakeClient(*a, **k)
        created_clients.append(c)
        return c

    async def fake_stage(client, config):
        pass

    monkeypatch.setitem(orchestrator.STAGES, "manzanas", fake_stage)
    monkeypatch.setattr(orchestrator, "SIISession", make_session)
    monkeypatch.setattr(orchestrator, "SIIClient", make_client)

    await orchestrator.run_stage("manzanas", _config(tmp_path, sessions=4))

    assert len(created_sessions) == 4
    assert len(created_clients) == 4
    assert all(s.closed for s in created_sessions)


async def test_client_pool_round_robins_fetch_predio(tmp_path, monkeypatch):
    _FakeClient._next_id = 0
    created_clients = []

    def make_client(*a, **k):
        c = _FakeClient(*a, **k)
        created_clients.append(c)
        return c

    seen_ids = []

    async def fake_stage(client, config):
        for i in range(6):
            await client.fetch_predio(15160, 1, i)

    monkeypatch.setitem(orchestrator.STAGES, "manzanas", fake_stage)
    monkeypatch.setattr(orchestrator, "SIISession", lambda: _FakeSession())
    monkeypatch.setattr(orchestrator, "SIIClient", make_client)

    await orchestrator.run_stage("manzanas", _config(tmp_path, sessions=3))

    for c in created_clients:
        seen_ids.extend([c.id] * len(c.calls))
    # 6 llamadas repartidas en 3 clientes → 2 cada uno (round-robin exacto).
    assert sorted(len(c.calls) for c in created_clients) == [2, 2, 2]
