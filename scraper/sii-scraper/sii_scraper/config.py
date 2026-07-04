import json
from dataclasses import dataclass, field


@dataclass
class ComunaConfig:
    comuna_id: int
    nombre_comuna: str


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
    manzana_min: int = 0
    geo_grid_step_m: int = 100
    geo_radius_km: float | None = None


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
    geo = raw.get("geo", {})
    geo_radius_km = geo.get("radius_km")

    rps = float(limits.get("requests_per_second", 0))
    if rps <= 0:
        raise ValueError("config.limits.requests_per_second debe ser > 0")
    conc = int(limits.get("max_concurrency", 0))
    if conc <= 0:
        raise ValueError("config.limits.max_concurrency debe ser > 0")

    manzana_max = int(ranges.get("manzana_max", 500))
    manzana_min = int(ranges.get("manzana_min", 0))
    if manzana_min < 0:
        raise ValueError("config.ranges.manzana_min no puede ser negativo")
    if manzana_min >= manzana_max:
        raise ValueError("config.ranges.manzana_min debe ser < manzana_max")

    return Config(
        comunas=comunas,
        regiones=regiones,
        manzana_max=manzana_max,
        manzana_min=manzana_min,
        manzana_probe_depth=int(ranges.get("manzana_probe_depth", 60)),
        predio_max=int(ranges.get("predio_max", 150)),
        max_concurrency=conc,
        requests_per_second=rps,
        max_retries=int(limits.get("max_retries", 5)),
        backoff_base=float(limits.get("backoff_base", 2)),
        output_dir=str(raw.get("output_dir", "output")),
        geo_grid_step_m=int(geo.get("grid_step_m", 100)),
        geo_radius_km=float(geo_radius_km) if geo_radius_km is not None else None,
    )
