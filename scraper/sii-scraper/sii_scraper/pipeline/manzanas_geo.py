import asyncio
import logging
import os
from datetime import datetime, timezone

from ..client.sii_client import RetriesExhausted
from ..domain.models import Manzana, parse_feature_info, slugify_comuna
from ..geo import bbox_around, grid_points, half_extent_m
from ..storage.checkpoint import Checkpoint
from ..storage.jsonl_writer import JsonlWriter
from ._io import read_jsonl

logger = logging.getLogger(__name__)

# Bbox chico (en grados) centrado en cada punto de la grilla: solo sirve para que
# el pixel central de la consulta caiga exactamente en el punto que queremos.
_EPS = 0.0005
_W = _H = 256


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _probe_point(client, comuna_id, predios_servicio, lat, lon,
                       writer, ckpt, vistas, key):
    try:
        raw = await client.get_feature_info(
            comuna_id, predios_servicio,
            lat - _EPS, lon - _EPS, lat + _EPS, lon + _EPS,
            _W // 2, _H // 2, _W, _H)
    except RetriesExhausted as exc:
        logger.warning("comuna %s punto %s: agotados los reintentos, "
                        "se reintentará en la próxima corrida: %s",
                        comuna_id, key, exc)
        return
    except Exception:
        logger.warning("comuna %s punto %s: error inesperado, "
                        "se reintentará en la próxima corrida",
                        comuna_id, key, exc_info=True)
        return

    info = parse_feature_info(raw or {})
    # Red de seguridad: solo si hay predio y es de ESTA comuna (la grilla puede
    # asomarse fuera del borde y tocar comunas vecinas).
    if info is not None and info.get("comuna") == comuna_id:
        manzana_id = info.get("manzana")
        if manzana_id is not None and manzana_id not in vistas:
            vistas.add(manzana_id)
            writer.append(Manzana(
                manzana_id=manzana_id,
                comuna_id=comuna_id,
                area_homogenea=info.get("area_homogenea"),
                extraction_datetime=_now_iso(),
            ).__dict__)
            logger.info("comuna %s manzana %s: encontrada (geo)",
                        comuna_id, manzana_id)
    ckpt.mark_done(key)


async def run_manzanas_geo_stage(client, config) -> None:
    """Descubre las manzanas de cada comuna consultando getFeatureInfo sobre una
    grilla de puntos que cubre su área (centro de listServiciosComunas ± extensión).
    Escribe el mismo manzanas/<comuna>.jsonl que la etapa `manzanas`, para que la
    etapa `predios` lo consuma igual."""
    for comuna in config.comunas:
        predios_servicio = await client.get_predios_servicio(comuna.comuna_id)
        if predios_servicio is None:
            logger.warning("comuna %s: sin capa de Predios en listServiciosComunas; "
                           "se salta", comuna.comuna_id)
            continue

        lat = predios_servicio["latitud"]
        lon = predios_servicio["longitud"]
        if config.geo_radius_km is not None:
            half_m = config.geo_radius_km * 1000.0
        else:
            half_m = half_extent_m(int(predios_servicio.get("zoom", 13)), lat)
        bbox = bbox_around(lat, lon, half_m)
        puntos = grid_points(*bbox, config.geo_grid_step_m)

        slug = slugify_comuna(comuna.nombre_comuna)
        out_path = os.path.join(config.output_dir, "manzanas", f"{slug}.jsonl")
        ck_path = os.path.join(config.output_dir, "checkpoints",
                               f"manzanas_geo_{slug}.json")
        ckpt = Checkpoint(ck_path)
        # Dedup entre corridas: sembramos las manzanas ya escritas.
        vistas = {row["manzana_id"] for row in read_jsonl(out_path)}
        logger.info("comuna %s: grilla de %d puntos (%d manzanas ya conocidas)",
                    comuna.comuna_id, len(puntos), len(vistas))

        with JsonlWriter(out_path) as writer:
            tasks = [
                _probe_point(client, comuna.comuna_id, predios_servicio,
                             plat, plon, writer, ckpt, vistas, str(i))
                for i, (plat, plon) in enumerate(puntos)
                if not ckpt.is_processed(str(i))
            ]
            await asyncio.gather(*tasks)
