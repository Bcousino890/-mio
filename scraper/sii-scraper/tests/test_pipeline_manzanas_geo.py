import json
from sii_scraper.config import Config, ComunaConfig
from sii_scraper.geo import bbox_around, grid_points
from sii_scraper.pipeline.manzanas_geo import run_manzanas_geo_stage

SERVICIO = {"comuna": 15160, "layer": "sii:BR_CART_VITACURA_WMS",
            "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0,
            "latitud": -33.4, "longitud": -70.6, "zoom": 13}


class FakeGeoClient:
    """get_feature_info devuelve un predio solo en los puntos predefinidos.
    hits: {(round(lat,4), round(lon,4)): data_dict}."""
    def __init__(self, servicio, hits):
        self._servicio = servicio
        self._hits = hits
        self.calls = 0

    async def get_predios_servicio(self, comuna_id):
        return self._servicio

    async def get_feature_info(self, comuna_id, predios_servicio, sw_lat, sw_lon,
                               ne_lat, ne_lon, x, y, width, height):
        self.calls += 1
        lat = (sw_lat + ne_lat) / 2
        lon = (sw_lon + ne_lon) / 2
        data = self._hits.get((round(lat, 4), round(lon, 4)))
        return {"data": data} if data else {"data": None}


def _cfg(tmp_path, **kw):
    base = dict(
        comunas=[ComunaConfig(15160, "Vitacura")],
        manzana_max=500, manzana_probe_depth=60, predio_max=150,
        max_concurrency=4, requests_per_second=1000, max_retries=3,
        backoff_base=2, output_dir=str(tmp_path),
        geo_radius_km=0.5, geo_grid_step_m=150)
    base.update(kw)
    return Config(**base)


def _grid_for(cfg):
    half = cfg.geo_radius_km * 1000.0
    bbox = bbox_around(SERVICIO["latitud"], SERVICIO["longitud"], half)
    return grid_points(*bbox, cfg.geo_grid_step_m)


def _k(p):
    return (round(p[0], 4), round(p[1], 4))


async def test_run_manzanas_geo_stage_discovers_and_dedups(tmp_path):
    cfg = _cfg(tmp_path)
    pts = _grid_for(cfg)
    assert len(pts) >= 31  # el bbox/paso dan una grilla suficiente
    hits = {
        _k(pts[0]):  {"comuna": 15160, "manzana": 111, "predio": 10, "existePredio": 1, "ah": "EAB590"},
        _k(pts[10]): {"comuna": 15160, "manzana": 111, "predio": 5,  "existePredio": 1, "ah": "EAB590"},  # misma manzana -> dedup
        _k(pts[20]): {"comuna": 15160, "manzana": 113, "predio": 1,  "existePredio": 1, "ah": "X"},
        _k(pts[30]): {"comuna": 99999, "manzana": 7,   "predio": 1,  "existePredio": 1},  # otra comuna -> descartar
    }
    client = FakeGeoClient(SERVICIO, hits)
    await run_manzanas_geo_stage(client, cfg)

    rows = [json.loads(l) for l in
            (tmp_path / "manzanas" / "vitacura.jsonl").read_text().splitlines()]
    assert sorted(r["manzana_id"] for r in rows) == [111, 113]  # dedup 111, descarta 99999
    assert all(r["comuna_id"] == 15160 for r in rows)
    m111 = next(r for r in rows if r["manzana_id"] == 111)
    assert m111["area_homogenea"] == "EAB590"


async def test_run_manzanas_geo_stage_resumes_without_duplicates(tmp_path):
    cfg = _cfg(tmp_path)
    pts = _grid_for(cfg)
    hits = {_k(pts[0]): {"comuna": 15160, "manzana": 111, "predio": 1,
                         "existePredio": 1, "ah": "A"}}
    c1 = FakeGeoClient(SERVICIO, hits)
    await run_manzanas_geo_stage(c1, cfg)
    assert c1.calls == len(pts)

    c2 = FakeGeoClient(SERVICIO, hits)
    await run_manzanas_geo_stage(c2, cfg)
    assert c2.calls == 0  # todo en el checkpoint

    rows = [json.loads(l) for l in
            (tmp_path / "manzanas" / "vitacura.jsonl").read_text().splitlines()]
    assert [r["manzana_id"] for r in rows] == [111]  # sin duplicar al reanudar


async def test_run_manzanas_geo_stage_skips_comuna_without_predios(tmp_path):
    class NoPredios(FakeGeoClient):
        async def get_predios_servicio(self, comuna_id):
            return None
    cfg = _cfg(tmp_path)
    await run_manzanas_geo_stage(NoPredios(SERVICIO, {}), cfg)
    assert not (tmp_path / "manzanas" / "vitacura.jsonl").exists()
