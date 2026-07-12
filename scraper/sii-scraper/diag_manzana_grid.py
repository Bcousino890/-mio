#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# diag_manzana_grid.py — DIAGNÓSTICO (no escribe en BD, no toca checkpoints).
#
# Mide cuántas manzanas encuentra la grilla de descubrimiento geográfico a
# distintos pasos (100 m vs más fino) sobre una MISMA sub-zona, para saber si el
# paso de 100 m del pipeline se está saltando manzanas (hipótesis: por eso Las
# Condes capturó ~1.099 manzanas y no las ~5.000+ que harían falta para 390k
# predios a 73 predios/manzana).
#
# Sondea una sub-zona chica (radio configurable alrededor del centro de la
# comuna) a cada paso, contando manzana_ids únicos. Reporta el conteo por paso y
# cuánto MÁS encuentra el paso fino → factor de subcaptura del paso de 100 m.
#
# USO (en el VPS, dentro de scraper/sii-scraper con venv y .env de proxy):
#   ./venv/bin/python diag_manzana_grid.py --comuna 15108 \
#       --radius-m 1200 --steps 100,60,40 --rps 2 --concurrency 3
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import asyncio
import logging

from sii_scraper.client.rate_limiter import RateLimiter
from sii_scraper.client.session import SIISession
from sii_scraper.client.sii_client import SIIClient, RetriesExhausted
from sii_scraper.domain.models import parse_feature_info
from sii_scraper.geo import bbox_around, grid_points

logging.basicConfig(level=logging.WARNING,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("diag")

_EPS = 0.0005
_W = _H = 256


async def _manzana_en_punto(client, comuna_id, predios_servicio, lat, lon):
    try:
        raw = await client.get_feature_info(
            comuna_id, predios_servicio,
            lat - _EPS, lon - _EPS, lat + _EPS, lon + _EPS,
            _W // 2, _H // 2, _W, _H)
    except (RetriesExhausted, Exception):
        return None
    info = parse_feature_info(raw or {})
    if info is not None and info.get("comuna") == comuna_id:
        return info.get("manzana")
    return None


async def _barrer_grilla(client, comuna_id, predios_servicio, bbox, step_m):
    puntos = grid_points(*bbox, step_m)
    vistas = set()
    for (plat, plon) in puntos:
        mid = await _manzana_en_punto(client, comuna_id, predios_servicio, plat, plon)
        if mid is not None:
            vistas.add(mid)
    return len(puntos), vistas


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comuna", type=int, required=True)
    ap.add_argument("--radius-m", type=float, default=1200)
    ap.add_argument("--steps", default="100,60,40",
                    help="pasos de grilla en metros, coma-separados (fino primero da igual)")
    ap.add_argument("--rps", type=float, default=2)
    ap.add_argument("--concurrency", type=int, default=3)
    args = ap.parse_args()

    steps = sorted({int(s) for s in args.steps.split(",") if s.strip()}, reverse=True)

    session = SIISession()
    client = SIIClient(
        session=session,
        rate_limiter=RateLimiter(args.rps),
        semaphore=asyncio.Semaphore(args.concurrency),
    )
    try:
        predios_servicio = await client.get_predios_servicio(args.comuna)
        if predios_servicio is None:
            print(f"✗ Comuna {args.comuna}: sin capa de Predios en listServiciosComunas.")
            return
        lat = predios_servicio["latitud"]
        lon = predios_servicio["longitud"]
        bbox = bbox_around(lat, lon, args.radius_m)
        print(f"▶ Comuna {args.comuna}: sub-zona radio {args.radius_m:.0f} m "
              f"centrada en ({lat:.5f},{lon:.5f})")
        print(f"▶ rps={args.rps} concurrency={args.concurrency}\n")

        resultados = []
        union_fina = set()
        for step in steps:
            npts, vistas = await _barrer_grilla(
                client, args.comuna, predios_servicio, bbox, step)
            resultados.append((step, npts, vistas))
            union_fina |= vistas
            print(f"  paso {step:>3} m · {npts:>5} puntos · {len(vistas):>4} manzanas únicas")
    finally:
        await session.close()

    print("\n── Resumen ─────────────────────────────────────────")
    base = next((v for (s, n, v) in resultados if s == max(s2 for s2, _, _ in resultados)), set())
    n_base = len(base)
    n_union = len(union_fina)
    print(f"  Manzanas con el paso MÁS GRUESO ({max(s for s,_,_ in resultados)} m): {n_base}")
    print(f"  Manzanas con TODOS los pasos (unión):              {n_union}")
    if n_base > 0:
        factor = n_union / n_base
        print(f"  Factor de subcaptura del paso grueso:  {factor:.2f}×  "
              f"← el paso fino encontró {factor:.2f}× manzanas")
        print(f"  → extrapolando, Las Condes tendría ~{int(1099*factor)} manzanas "
              f"(hoy 1.099) y ~{int(1099*factor*73)} predios a 73/manzana")
    if n_base == 0:
        print("  ⚠ 0 manzanas en el paso grueso — ¿sub-zona sin predios o 429s? "
              "revisar el centro/radio o bajar el ritmo.")


if __name__ == "__main__":
    asyncio.run(main())
