import asyncio
import logging
import os

from ..client.sii_client import RetriesExhausted
from ..domain.models import parse_predio, slugify_comuna
from ..storage.checkpoint import Checkpoint
from ..storage.jsonl_writer import JsonlWriter
from ._io import read_jsonl

logger = logging.getLogger(__name__)


async def _fetch_predio(client, comuna_id, manzana_id, predio_id, writer, ckpt):
    key = f"{manzana_id}-{predio_id}"
    try:
        raw = await client.fetch_predio(comuna_id, manzana_id, predio_id)
        predio = parse_predio(raw or {}, comuna_id)
    except RetriesExhausted as exc:
        logger.warning("comuna %s manzana %s predio %s: agotados los reintentos, "
                        "se reintentará en la próxima corrida: %s",
                        comuna_id, manzana_id, predio_id, exc)
        return
    except Exception:
        logger.warning("comuna %s manzana %s predio %s: error inesperado, "
                        "se reintentará en la próxima corrida",
                        comuna_id, manzana_id, predio_id, exc_info=True)
        return

    if predio is not None:
        writer.append(predio.__dict__)
    ckpt.mark_done(key)


async def run_predios_stage(client, config) -> None:
    for comuna in config.comunas:
        slug = slugify_comuna(comuna.nombre_comuna)
        manzanas = read_jsonl(
            os.path.join(config.output_dir, "manzanas", f"{slug}.jsonl"))
        out_path = os.path.join(config.output_dir, "predios", f"{slug}.jsonl")
        ck_path = os.path.join(config.output_dir, "checkpoints", f"predios_{slug}.json")
        ckpt = Checkpoint(ck_path)
        with JsonlWriter(out_path) as writer:
            tasks = []
            for m in manzanas:
                manzana_id = m["manzana_id"]
                for predio_id in range(config.predio_max):
                    if ckpt.is_processed(f"{manzana_id}-{predio_id}"):
                        continue
                    tasks.append(_fetch_predio(
                        client, comuna.comuna_id, manzana_id, predio_id,
                        writer, ckpt))
            await asyncio.gather(*tasks)
