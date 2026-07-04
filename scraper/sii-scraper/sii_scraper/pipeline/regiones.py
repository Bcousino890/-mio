import logging
import os

from ..config import ComunaConfig
from ..domain.models import parse_regiones
from ..storage.jsonl_writer import JsonlWriter

logger = logging.getLogger(__name__)


async def run_regiones_stage(client, config) -> None:
    """Baja el catálogo región→comunas y lo escribe en <output_dir>/regiones.jsonl,
    una línea JSON por región con sus comunas anidadas."""
    raw = await client.get_regiones()
    regiones = parse_regiones(raw)
    out_path = os.path.join(config.output_dir, "regiones.jsonl")
    # El catálogo es un volcado completo (no incremental como las etapas de
    # scraping): se reescribe entero en cada corrida para no duplicar líneas.
    if os.path.exists(out_path):
        os.remove(out_path)
    with JsonlWriter(out_path) as writer:
        for region in regiones:
            writer.append({
                "region_id": region.region_id,
                "nombre": region.nombre,
                "comunas": [
                    {"comuna_id": c.comuna_id, "nombre": c.nombre}
                    for c in region.comunas
                ],
            })
    logger.info("regiones: %d regiones escritas en %s", len(regiones), out_path)


async def resolve_comunas(client, config) -> list[ComunaConfig]:
    """Comunas a procesar: las explícitas de config.comunas más la expansión de
    config.regiones (todas las comunas de esas regiones), deduplicadas por
    comuna_id (la explícita conserva su nombre_comuna). Si config.regiones está
    vacío, no hace ninguna llamada de red."""
    result: dict[int, ComunaConfig] = {}
    for c in config.comunas:
        result.setdefault(c.comuna_id, c)

    if config.regiones:
        regiones = parse_regiones(await client.get_regiones())
        by_id = {r.region_id: r for r in regiones}
        for region_id in config.regiones:
            region = by_id.get(region_id)
            if region is None:
                logger.warning("región %s no existe en listRegiones; se omite",
                               region_id)
                continue
            for cref in region.comunas:
                if cref.comuna_id not in result:
                    result[cref.comuna_id] = ComunaConfig(
                        comuna_id=cref.comuna_id, nombre_comuna=cref.nombre)

    return list(result.values())
