import json
import pytest
from sii_scraper.config import load_config, Config, ComunaConfig


def _write(tmp_path, data):
    p = tmp_path / "config.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return str(p)


VALID = {
    "comunas": [{"comuna_id": 15160, "nombre_comuna": "Vitacura"}],
    "ranges": {"manzana_max": 500, "manzana_probe_depth": 60, "predio_max": 150},
    "limits": {"max_concurrency": 8, "requests_per_second": 5,
               "max_retries": 5, "backoff_base": 2},
    "output_dir": "output",
}


def test_load_valid_config(tmp_path):
    cfg = load_config(_write(tmp_path, VALID))
    assert isinstance(cfg, Config)
    assert cfg.comunas == [ComunaConfig(comuna_id=15160, nombre_comuna="Vitacura")]
    assert cfg.manzana_max == 500
    assert cfg.requests_per_second == 5
    assert cfg.output_dir == "output"


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


def test_negative_rate_raises(tmp_path):
    bad = {**VALID, "limits": {**VALID["limits"], "requests_per_second": 0}}
    with pytest.raises(ValueError, match="requests_per_second"):
        load_config(_write(tmp_path, bad))


def test_non_positive_concurrency_raises(tmp_path):
    bad = {**VALID, "limits": {**VALID["limits"], "max_concurrency": 0}}
    with pytest.raises(ValueError, match="max_concurrency"):
        load_config(_write(tmp_path, bad))


def test_manzana_min_defaults_zero(tmp_path):
    cfg = load_config(_write(tmp_path, VALID))
    assert cfg.manzana_min == 0


def test_manzana_min_parsed(tmp_path):
    data = {**VALID, "ranges": {**VALID["ranges"], "manzana_min": 100}}
    cfg = load_config(_write(tmp_path, data))
    assert cfg.manzana_min == 100


def test_manzana_min_ge_max_raises(tmp_path):
    data = {**VALID, "ranges": {**VALID["ranges"], "manzana_min": 500, "manzana_max": 500}}
    with pytest.raises(ValueError, match="manzana_min"):
        load_config(_write(tmp_path, data))


def test_geo_defaults(tmp_path):
    cfg = load_config(_write(tmp_path, VALID))
    assert cfg.geo_grid_step_m == 100
    assert cfg.geo_radius_km is None


def test_geo_parsed(tmp_path):
    data = {**VALID, "geo": {"grid_step_m": 80, "radius_km": 6}}
    cfg = load_config(_write(tmp_path, data))
    assert cfg.geo_grid_step_m == 80
    assert cfg.geo_radius_km == 6.0
