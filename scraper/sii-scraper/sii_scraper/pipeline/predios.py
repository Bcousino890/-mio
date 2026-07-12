import asyncio
import logging
import os

from ..client.sii_client import RetriesExhausted
from ..domain.models import parse_predio, slugify_comuna
from ..storage.checkpoint import Checkpoint
from ..storage.jsonl_writer import JsonlWriter
from ._io import read_jsonl

logger = logging.getLogger(__name__)


async def _fetch(client, comuna_id, manzana_id, predio_id):
    """Devuelve (estado, predio):
      estado True  → existe un predio válido,
             False → vacío (respuesta OK sin predio),
             None  → incierto (reintentos agotados / error de red)."""
    try:
        raw = await client.fetch_predio(comuna_id, manzana_id, predio_id)
    except RetriesExhausted:
        return None, None
    except Exception:
        logger.warning("comuna %s manzana %s predio %s: error inesperado",
                       comuna_id, manzana_id, predio_id, exc_info=True)
        return None, None
    predio = parse_predio(raw or {}, comuna_id)
    return (predio is not None), predio


async def _scrape_manzana(client, config, comuna_id, manzana_id, writer, done_ckpt):
    """Sondea los predios de UNA manzana enumerando predio_id 0,1,2,… y
    cortando tras `predio_probe_depth` vacíos consecutivos (una vez visto al
    menos un predio válido) o `predio_initial_scan` vacíos iniciales si la
    manzana no arranca en 0. `predio_max` es un TECHO de seguridad, no el tamaño
    esperado. Reemplaza al cap fijo range(predio_max) que truncaba manzanas
    densas y desperdiciaba requests en las chicas.

    Al terminar (naturalmente) marca la manzana en `done_ckpt`. Si un bloqueo
    sostenido (429) impide avanzar, ABANDONA sin marcarla, para reintentarla en
    la próxima corrida. No usa checkpoint por-predio: si el proceso muere a mitad
    de una manzana, se re-scrapea entera en el reinicio (barato) y los duplicados
    en el JSONL son inofensivos (ingest idempotente ON CONFLICT DO UPDATE)."""
    probe_depth = config.predio_probe_depth
    initial_scan = config.predio_initial_scan
    ceiling = config.predio_max

    consecutivos_vacios = 0
    inciertos_seguidos = 0
    hubo_incierto = False
    visto_valido = False
    pid = 0
    while pid < ceiling:
        estado, predio = await _fetch(client, comuna_id, manzana_id, pid)

        if estado is None:
            # Incierto (bloqueo): no cuenta como vacío para no cortar antes de
            # tiempo. Si se repite mucho seguido, la manzana está bloqueada:
            # abandonarla (sin marcar done) para reintentar en otra corrida.
            hubo_incierto = True
            inciertos_seguidos += 1
            if inciertos_seguidos >= config.predio_max_inciertos:
                logger.warning("comuna %s manzana %s: bloqueo sostenido en "
                               "predio %s, se reintenta en la próxima corrida",
                               comuna_id, manzana_id, pid)
                return
            pid += 1
            continue

        inciertos_seguidos = 0
        if estado:
            writer.append(predio.__dict__)
            visto_valido = True
            consecutivos_vacios = 0
        else:
            consecutivos_vacios += 1

        if visto_valido and consecutivos_vacios >= probe_depth:
            break
        if not visto_valido and consecutivos_vacios >= initial_scan:
            break
        pid += 1

    # Solo marcar la manzana COMPLETA si no hubo ningún predio incierto: si un
    # 429 dejó un predio sin confirmar, se re-scrapea la manzana entera en la
    # próxima corrida (duplicados en el JSONL son inofensivos por el ingest
    # idempotente). Así no se pierden predios por bloqueos transitorios.
    if not hubo_incierto:
        done_ckpt.mark_done(str(manzana_id))


async def run_predios_stage(client, config) -> None:
    for comuna in config.comunas:
        slug = slugify_comuna(comuna.nombre_comuna)
        manzanas = read_jsonl(
            os.path.join(config.output_dir, "manzanas", f"{slug}.jsonl"))
        out_path = os.path.join(config.output_dir, "predios", f"{slug}.jsonl")
        # Checkpoint por manzana TERMINADA (no por predio): chico (≈ nº de
        # manzanas), evita el O(n²) de un checkpoint por-predio con cientos de
        # miles de claves. Reanuda saltando manzanas ya completas.
        done_path = os.path.join(config.output_dir, "checkpoints",
                                 f"predios_done_{slug}.json")
        done_ckpt = Checkpoint(done_path)

        pendientes = []
        for m in manzanas:
            mid = m["manzana_id"]
            if not done_ckpt.is_processed(str(mid)):
                pendientes.append(mid)

        logger.info("comuna %s: %d manzanas, %d pendientes de predios",
                    comuna.comuna_id, len(manzanas), len(pendientes))

        cola: asyncio.Queue = asyncio.Queue()
        for mid in pendientes:
            cola.put_nowait(mid)

        with JsonlWriter(out_path) as writer:
            async def worker():
                while True:
                    try:
                        mid = cola.get_nowait()
                    except asyncio.QueueEmpty:
                        return
                    try:
                        await _scrape_manzana(client, config, comuna.comuna_id,
                                              mid, writer, done_ckpt)
                    finally:
                        cola.task_done()

            # Un worker por unidad de concurrencia: cada uno scrapea una manzana
            # entera (secuencial en sus predios) y pasa a la siguiente, así las
            # manzanas se COMPLETAN de a poco (y se marcan done) en vez de
            # avanzar todas a la vez y no terminar ninguna hasta el final.
            n_workers = max(1, config.max_concurrency)
            workers = [asyncio.create_task(worker()) for _ in range(n_workers)]
            try:
                await asyncio.gather(*workers)
            finally:
                done_ckpt.flush()
