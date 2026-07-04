import asyncio
import logging
from dataclasses import replace

from .client.rate_limiter import RateLimiter
from .client.session import SIISession
from .client.sii_client import SIIClient
from .pipeline.manzanas import run_manzanas_stage
from .pipeline.manzanas_geo import run_manzanas_geo_stage
from .pipeline.predios import run_predios_stage
from .pipeline.found_predios import run_found_predios_stage
from .pipeline.regiones import run_regiones_stage, resolve_comunas

logger = logging.getLogger(__name__)

STAGES = {
    "regiones": run_regiones_stage,
    "manzanas": run_manzanas_stage,
    "manzanas-geo": run_manzanas_geo_stage,
    "predios": run_predios_stage,
    "found-predios": run_found_predios_stage,
}

SCRAPING_STAGES = {"manzanas", "manzanas-geo", "predios", "found-predios"}


async def run_stage(stage: str, config) -> None:
    if stage not in STAGES:
        raise ValueError(f"etapa desconocida: {stage!r}. "
                         f"Opciones: {sorted(STAGES)}")

    session = SIISession()
    client = SIIClient(
        session=session,
        rate_limiter=RateLimiter(config.requests_per_second),
        semaphore=asyncio.Semaphore(config.max_concurrency),
        max_retries=config.max_retries,
        backoff_base=config.backoff_base,
    )
    try:
        try:
            catalogo = await client.get_comunas()
            n = len(catalogo.get("data", [])) if isinstance(catalogo, dict) and isinstance(catalogo.get("data"), list) else "?"
            logger.info("Catálogo SII: %s comunas (sanity check)", n)
        except Exception:
            logger.warning("No se pudo obtener el catálogo de comunas (sanity check best-effort)", exc_info=True)
        if stage in SCRAPING_STAGES:
            config = replace(config, comunas=await resolve_comunas(client, config))
            if not config.comunas:
                raise ValueError(
                    "No hay comunas para procesar: define 'comunas' o "
                    "'regiones' en el config")
        await STAGES[stage](client, config)
    finally:
        await session.close()
