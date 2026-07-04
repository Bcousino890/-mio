import asyncio
import logging
import os

from ..client.sii_client import RetriesExhausted
from ..domain.models import parse_predio, split_rol, slugify_comuna
from ..storage.checkpoint import Checkpoint
from ..storage.jsonl_writer import JsonlWriter
from ._io import read_jsonl

logger = logging.getLogger(__name__)


async def _reprocess_one(client, comuna_id, rol, writer, ckpt):
    try:
        manzana_id, predio_id = split_rol(rol)
    except Exception:
        logger.warning("rol %r malformado, no se puede reprocesar", rol, exc_info=True)
        ckpt.mark_done(rol)
        return

    try:
        raw = await client.fetch_predio(comuna_id, manzana_id, predio_id)
        predio = parse_predio(raw or {}, comuna_id)
        if predio is not None:
            extra = {"comuna_id": comuna_id}
            if predio.superficie:
                extra["superficie"] = predio.superficie
            predio.extra_data = extra
            writer.append(predio.__dict__)
    except RetriesExhausted as exc:
        logger.warning("rol %r: agotados los reintentos, "
                        "se reintentará en la próxima corrida: %s", rol, exc)
        return
    except Exception:
        logger.warning("no se pudo reprocesar rol %r", rol, exc_info=True)

    ckpt.mark_done(rol)


async def run_found_predios_stage(client, config) -> None:
    for comuna in config.comunas:
        slug = slugify_comuna(comuna.nombre_comuna)
        predios = read_jsonl(
            os.path.join(config.output_dir, "predios", f"{slug}.jsonl"))
        out_path = os.path.join(config.output_dir, "found_predios", f"{slug}.jsonl")
        ck_path = os.path.join(
            config.output_dir, "checkpoints", f"found_predios_{slug}.json")
        ckpt = Checkpoint(ck_path)
        with JsonlWriter(out_path) as writer:
            tasks = []
            for row in predios:
                rol = row.get("rol_predio")
                if not rol or ckpt.is_processed(rol):
                    continue
                tasks.append(_reprocess_one(
                    client, comuna.comuna_id, rol, writer, ckpt))
            await asyncio.gather(*tasks)
