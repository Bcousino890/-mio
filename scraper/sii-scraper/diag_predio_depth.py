#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# diag_predio_depth.py — DIAGNÓSTICO (no escribe en BD, no toca checkpoints).
#
# Mide la distribución REAL de predios por manzana para calibrar el nuevo
# sondeo por vacíos. El pipeline actual enumera predio_id 0..predio_max-1
# (predio_max=150), así que trunca manzanas densas (torres con >150 unidades).
# Este script toma una muestra de manzanas ya descubiertas y sondea predios SIN
# ese tope, reportando por manzana:
#   - cuántos predios válidos hay,
#   - el mayor predio_id válido (¿supera 150?),
#   - el mayor hueco interno (racha de predio_id vacíos ENTRE dos válidos) →
#     calibra cuántos vacíos consecutivos hay que tolerar antes de cortar.
#
# USO (en el VPS, dentro de scraper/sii-scraper con el venv y .env de proxy):
#   ./venv/bin/python diag_predio_depth.py \
#       --manzanas-file output/manzanas/las_condes.jsonl \
#       --comuna 15108 --sample 12 --ceiling 600 --probe-depth 50 \
#       --rps 8 --concurrency 8
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import asyncio
import json
import logging
import random

from sii_scraper.client.rate_limiter import RateLimiter
from sii_scraper.client.session import SIISession
from sii_scraper.client.sii_client import SIIClient, RetriesExhausted
from sii_scraper.domain.models import parse_predio

logging.basicConfig(level=logging.WARNING,
                    format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("diag")


def _load_manzana_ids(path: str) -> list[int]:
    ids = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ids.append(int(json.loads(line)["manzana_id"]))
            except (ValueError, KeyError, json.JSONDecodeError):
                continue
    return ids


async def _existe_predio(client, comuna_id, manzana_id, predio_id) -> bool:
    try:
        raw = await client.fetch_predio(comuna_id, manzana_id, predio_id)
    except RetriesExhausted:
        # Trato "reintentos agotados" como incierto: no cuenta como vacío para
        # no cortar antes de tiempo por un bloqueo transitorio.
        return None
    except Exception:
        return None
    return parse_predio(raw or {}, comuna_id) is not None


async def _sondear_manzana(client, comuna_id, manzana_id, ceiling, probe_depth,
                           initial_scan):
    """Sondea predio_id 0..ceiling-1, cortando tras `probe_depth` vacíos
    seguidos una vez visto al menos un válido (o tras `initial_scan` vacíos
    iniciales si la manzana no arranca en 0). Devuelve métricas."""
    validos = []
    consecutivos_vacios = 0
    max_hueco_interno = 0
    inciertos = 0
    pid = 0
    while pid < ceiling:
        exists = await _existe_predio(client, comuna_id, manzana_id, pid)
        if exists is None:
            inciertos += 1
            consecutivos_vacios += 1  # cuenta para el corte, pero se marca aparte
        elif exists:
            if validos:
                max_hueco_interno = max(max_hueco_interno, consecutivos_vacios)
            validos.append(pid)
            consecutivos_vacios = 0
        else:
            consecutivos_vacios += 1

        if validos and consecutivos_vacios >= probe_depth:
            break
        if not validos and consecutivos_vacios >= initial_scan:
            break
        pid += 1

    return {
        "manzana_id": manzana_id,
        "validos": len(validos),
        "max_id_valido": max(validos) if validos else None,
        "max_hueco_interno": max_hueco_interno,
        "inciertos": inciertos,
        "llego_al_techo": pid >= ceiling,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manzanas-file", required=True)
    ap.add_argument("--comuna", type=int, required=True)
    ap.add_argument("--sample", type=int, default=12)
    ap.add_argument("--ceiling", type=int, default=600)
    ap.add_argument("--probe-depth", type=int, default=50)
    ap.add_argument("--initial-scan", type=int, default=40)
    ap.add_argument("--rps", type=float, default=8)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    todas = _load_manzana_ids(args.manzanas_file)
    if not todas:
        print(f"✗ No se leyeron manzanas de {args.manzanas_file}")
        return
    random.seed(args.seed)
    muestra = sorted(random.sample(todas, min(args.sample, len(todas))))
    print(f"▶ Comuna {args.comuna}: {len(todas)} manzanas conocidas; "
          f"muestreando {len(muestra)}: {muestra}")
    print(f"▶ ceiling={args.ceiling} probe_depth={args.probe_depth} "
          f"rps={args.rps} concurrency={args.concurrency}\n")

    session = SIISession()
    client = SIIClient(
        session=session,
        rate_limiter=RateLimiter(args.rps),
        semaphore=asyncio.Semaphore(args.concurrency),
    )
    try:
        # Manzanas en paralelo (cada una sondea sus predios en orden).
        resultados = await asyncio.gather(*[
            _sondear_manzana(client, args.comuna, mid, args.ceiling,
                             args.probe_depth, args.initial_scan)
            for mid in muestra
        ])
    finally:
        await session.close()

    print(f"{'manzana':>10} {'validos':>8} {'max_id':>7} {'hueco':>6} "
          f"{'incierto':>8} {'techo':>6}")
    print("-" * 52)
    sobre_150 = 0
    max_id_global = 0
    max_hueco_global = 0
    total_validos = 0
    for r in sorted(resultados, key=lambda x: x["manzana_id"]):
        mid_valido = r["max_id_valido"]
        if mid_valido is not None and mid_valido >= 150:
            sobre_150 += 1
        if mid_valido is not None:
            max_id_global = max(max_id_global, mid_valido)
        max_hueco_global = max(max_hueco_global, r["max_hueco_interno"])
        total_validos += r["validos"]
        print(f"{r['manzana_id']:>10} {r['validos']:>8} "
              f"{str(mid_valido):>7} {r['max_hueco_interno']:>6} "
              f"{r['inciertos']:>8} {str(r['llego_al_techo']):>6}")

    n = len(resultados)
    print("\n── Resumen ─────────────────────────────────────────")
    print(f"  Manzanas muestreadas:            {n}")
    print(f"  Con predio válido de id >= 150:  {sobre_150} "
          f"({100*sobre_150//max(n,1)}%)  ← truncadas por el cap viejo")
    print(f"  Mayor predio_id válido visto:    {max_id_global}")
    print(f"  Mayor hueco interno (vacíos):    {max_hueco_global}  "
          f"← el probe_depth debe superarlo")
    print(f"  Promedio de predios/manzana:     {total_validos/max(n,1):.1f}  "
          f"(muestra)")
    if any(r['llego_al_techo'] for r in resultados):
        print("  ⚠ Alguna manzana llegó al techo → subir --ceiling y re-medir.")


if __name__ == "__main__":
    asyncio.run(main())
