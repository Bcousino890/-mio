import asyncio
import logging
import os

from ..client.sii_client import RetriesExhausted
from ..domain.models import parse_manzana, slugify_comuna, Manzana
from ..storage.checkpoint import Checkpoint
from ..storage.jsonl_writer import JsonlWriter

logger = logging.getLogger(__name__)


async def discover_manzana(client, comuna_id: int, manzana_id: int,
                           probe_depth: int) -> Manzana | None:
    for predio_id in range(probe_depth):
        raw = await client.fetch_predio(comuna_id, manzana_id, predio_id)
        manzana = parse_manzana(raw or {}, comuna_id, manzana_id)
        if manzana is not None:
            return manzana
    return None


async def _process_one(client, comuna_id, manzana_id, probe_depth, writer, ckpt):
    key = str(manzana_id)
    try:
        manzana = await discover_manzana(client, comuna_id, manzana_id, probe_depth)
    except RetriesExhausted as exc:
        logger.warning("comuna %s manzana %s: agotados los reintentos, "
                        "se reintentará en la próxima corrida: %s",
                        comuna_id, manzana_id, exc)
        return
    except Exception:
        logger.warning("comuna %s manzana %s: error inesperado, "
                        "se reintentará en la próxima corrida",
                        comuna_id, manzana_id, exc_info=True)
        return

    if manzana is not None:
        writer.append(manzana.__dict__)
        ckpt.mark_done(key)
        logger.info("comuna %s manzana %s: encontrada", comuna_id, manzana_id)
    else:
        ckpt.mark_discarded(key)


async def run_manzanas_stage(client, config) -> None:
    for comuna in config.comunas:
        slug = slugify_comuna(comuna.nombre_comuna)
        out_path = os.path.join(config.output_dir, "manzanas", f"{slug}.jsonl")
        ck_path = os.path.join(config.output_dir, "checkpoints", f"manzanas_{slug}.json")
        ckpt = Checkpoint(ck_path)
        with JsonlWriter(out_path) as writer:
            tasks = [
                _process_one(client, comuna.comuna_id, mid,
                             config.manzana_probe_depth, writer, ckpt)
                for mid in range(config.manzana_min, config.manzana_max)
                if not ckpt.is_processed(str(mid))
            ]
            await asyncio.gather(*tasks)
