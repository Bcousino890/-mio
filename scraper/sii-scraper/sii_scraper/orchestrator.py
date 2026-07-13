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


class _ClientPool:
    """Reparte cada llamada entre N SIIClient en round-robin, cada uno con su
    propia SIISession (su propia identidad de proxy/IP). El proveedor de
    proxy confirmó que no hay límite de sesiones concurrentes: en vez de una
    sola sesión al ritmo seguro por IP, se corren N en paralelo —cada una a
    ese mismo ritmo seguro— multiplicando el throughput total sin que ninguna
    IP individual supere el ritmo que el WAF tolera.

    Expone la misma interfaz duck-typed que SIIClient, así que los pipelines
    (manzanas.py, predios.py, etc.) no necesitan saber que hay un pool detrás.
    `_pick()` no es async y no cede el control entre leer/incrementar
    `_next`, así que es seguro sin lock (invariante de un solo hilo de
    asyncio, sin `await` de por medio).
    """

    def __init__(self, clients: list[SIIClient]):
        self._clients = clients
        self._next = 0

    def _pick(self) -> SIIClient:
        client = self._clients[self._next % len(self._clients)]
        self._next += 1
        return client

    async def get_comunas(self):
        return await self._pick().get_comunas()

    async def get_regiones(self):
        return await self._pick().get_regiones()

    async def fetch_predio(self, comuna_id, manzana_id, predio_id):
        return await self._pick().fetch_predio(comuna_id, manzana_id, predio_id)

    async def get_predios_servicio(self, comuna_id):
        return await self._pick().get_predios_servicio(comuna_id)

    async def get_feature_info(self, *args, **kwargs):
        return await self._pick().get_feature_info(*args, **kwargs)


async def run_stage(stage: str, config) -> None:
    if stage not in STAGES:
        raise ValueError(f"etapa desconocida: {stage!r}. "
                         f"Opciones: {sorted(STAGES)}")

    n_sessions = max(1, getattr(config, "sessions", 1))
    sessions = [SIISession() for _ in range(n_sessions)]
    clients = [
        SIIClient(
            session=s,
            rate_limiter=RateLimiter(config.requests_per_second),
            semaphore=asyncio.Semaphore(config.max_concurrency),
            max_retries=config.max_retries,
            backoff_base=config.backoff_base,
        )
        for s in sessions
    ]
    client = _ClientPool(clients)
    try:
        try:
            catalogo = await client.get_comunas()
            n = len(catalogo.get("data", [])) if isinstance(catalogo, dict) and isinstance(catalogo.get("data"), list) else "?"
            logger.info("Catálogo SII: %s comunas (sanity check, %d sesión(es) en paralelo)", n, n_sessions)
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
        await asyncio.gather(*(s.close() for s in sessions), return_exceptions=True)
