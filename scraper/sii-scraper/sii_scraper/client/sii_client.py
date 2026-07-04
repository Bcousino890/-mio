import asyncio
import logging

import aiohttp

from .session import SERVICE_URL, SERVICE_HEADERS

logger = logging.getLogger(__name__)


class RetriesExhausted(Exception):
    """Se agotaron los reintentos sin obtener una respuesta valida del SII."""


def build_predio_payload(comuna_id: int, manzana_id: int, predio_id: int,
                          servicios: list[dict]) -> dict:
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/getPredioNacional"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "getPredioNacional",
        },
        "data": {
            "predio": {
                "comuna": f"{comuna_id}",
                "manzana": f"{manzana_id}",
                "predio": f"{predio_id}",
            },
            "servicios": servicios,
        },
    }


def _servicios_comuna_payload(comuna_id: int) -> dict:
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/listServiciosComunas"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "listServiciosComunas",
        },
        "data": {"comuna": f"{comuna_id}"},
    }


def _extract_servicios(raw: dict, comuna_id: int) -> tuple[list[dict], list[str]]:
    """A partir de la respuesta de listServiciosComunas, arma la lista
    `servicios` que getPredioNacional necesita: la capa "Predios" (unica,
    aliasServicio "P") y la capa de "Area Homogenea" mas vigente
    (aliasServicio "AH", la de menor `orden` entre todas las disponibles) --
    en vez de hardcodear valores validos solo para una comuna y ademas
    desactualizados. Devuelve (servicios, roles_faltantes): roles_faltantes
    lista cuales de "Predios"/"Area Homogenea" no se encontraron para esta
    comuna (para que el llamador pueda advertir sin crashear).
    """
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data:
        return [], ["Predios", "Area Homogenea"]

    predios = next((s for s in data if s.get("aliasServicio") == "P"), None)
    ah_opciones = [s for s in data if s.get("aliasServicio") == "AH"]
    area_homogenea = min(ah_opciones, key=lambda s: s.get("orden", float("inf"))) if ah_opciones else None

    faltantes = []
    if predios is None:
        faltantes.append("Predios")
    if area_homogenea is None:
        faltantes.append("Area Homogenea")

    servicios = []
    for s in (predios, area_homogenea):
        if s is not None:
            servicios.append({
                "comuna": comuna_id,
                "layer": s["layer"],
                "style": s["style"],
                "eac": s.get("eac", 0),
                "eacano": s.get("eacano", 0),
            })
    return servicios, faltantes


def _comunas_payload() -> dict:
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/listComunas"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "listComunas",
        }
    }


def _regiones_payload() -> dict:
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/listRegiones"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "listRegiones",
        }
    }


def _feature_info_payload(comuna_id: int, predios_servicio: dict,
                          sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float,
                          x: int, y: int, width: int, height: int) -> dict:
    """POST de getFeatureInfo: mapea el pixel (x, y) dentro del bbox
    [sw..ne] a un punto geografico y devuelve el predio ahi.
    OJO con los ejes: southwestx/northeastx son LATITUDES;
    southwesty/northeasty son LONGITUDES (asi lo espera el SII)."""
    servicio = {
        "comuna": comuna_id,
        "layer": predios_servicio["layer"],
        "style": predios_servicio["style"],
        "eac": predios_servicio.get("eac", 0),
        "eacano": predios_servicio.get("eacano", 0),
    }
    return {
        "metaData": {
            "namespace": ("cl.sii.sdi.lob.bbrr.mapas.data.api.interfaces."
                          "MapasFacadeService/getFeatureInfo"),
            "conversationId": "UNAUTHENTICATED-CALL",
            "transactionId": "getFeatureInfo",
        },
        "data": {"clickInfo": {
            "x": x, "y": y,
            "southwestx": sw_lat, "southwesty": sw_lon,
            "northeastx": ne_lat, "northeasty": ne_lon,
            "layer": predios_servicio["layer"],
            "width": width, "height": height,
            "servicios": [servicio],
        }},
    }


class SIIClient:
    def __init__(self, session, rate_limiter, semaphore,
                 max_retries: int = 5, backoff_base: float = 2.0,
                 sleep=asyncio.sleep):
        self.session = session
        self.rate_limiter = rate_limiter
        self.semaphore = semaphore
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self._sleep = sleep
        self._servicios_cache: dict[int, list[dict]] = {}
        self._predios_servicio_cache: dict[int, dict | None] = {}
        self._servicios_lock = asyncio.Lock()

    async def _get_servicios(self, comuna_id: int) -> list[dict]:
        if comuna_id in self._servicios_cache:
            return self._servicios_cache[comuna_id]
        async with self._servicios_lock:
            if comuna_id not in self._servicios_cache:
                raw = await self._post("listServiciosComunas",
                                       _servicios_comuna_payload(comuna_id))
                servicios, faltantes = _extract_servicios(raw, comuna_id)
                if faltantes:
                    logger.warning(
                        "comuna %s: no se encontraron capas WMS para %s; "
                        "esos campos pueden salir vacios o incorrectos",
                        comuna_id, ", ".join(faltantes),
                    )
                self._servicios_cache[comuna_id] = servicios
        return self._servicios_cache[comuna_id]

    async def fetch_predio(self, comuna_id: int, manzana_id: int,
                           predio_id: int) -> dict:
        servicios = await self._get_servicios(comuna_id)
        return await self._post(
            "getPredioNacional",
            build_predio_payload(comuna_id, manzana_id, predio_id, servicios),
        )

    async def get_comunas(self) -> dict:
        return await self._post("listComunas", _comunas_payload())

    async def get_regiones(self) -> dict:
        return await self._post("listRegiones", _regiones_payload())

    async def get_predios_servicio(self, comuna_id: int) -> dict | None:
        """Registro crudo del servicio de Predios (aliasServicio 'P') de
        listServiciosComunas: trae comuna/layer/style/eac/eacano (para el
        payload de getFeatureInfo) y latitud/longitud/zoom (para el bbox).
        None si la comuna no expone capa de Predios. Cacheado por comuna."""
        if comuna_id in self._predios_servicio_cache:
            return self._predios_servicio_cache[comuna_id]
        async with self._servicios_lock:
            if comuna_id not in self._predios_servicio_cache:
                raw = await self._post("listServiciosComunas",
                                       _servicios_comuna_payload(comuna_id))
                data = raw.get("data") if isinstance(raw, dict) else None
                predios = None
                if data:
                    predios = next(
                        (s for s in data if s.get("aliasServicio") == "P"), None)
                self._predios_servicio_cache[comuna_id] = predios
        return self._predios_servicio_cache[comuna_id]

    async def get_feature_info(self, comuna_id: int, predios_servicio: dict,
                               sw_lat: float, sw_lon: float,
                               ne_lat: float, ne_lon: float,
                               x: int, y: int, width: int, height: int) -> dict:
        return await self._post("getFeatureInfo", _feature_info_payload(
            comuna_id, predios_servicio, sw_lat, sw_lon, ne_lat, ne_lon,
            x, y, width, height))

    async def _post(self, method: str, payload: dict) -> dict:
        url = f"{SERVICE_URL}/{method}"
        for attempt in range(1, self.max_retries + 1):
            await self.rate_limiter.acquire()
            status = None
            exc_to_report = None
            async with self.semaphore:
                session = await self.session.get()
                # Lectura sincronica inmediata, sin await de por medio, ver
                # session.py:proxy_url (invariante de no-race explicado ahi).
                proxy = self.session.proxy_url
                try:
                    async with session.post(url, headers=SERVICE_HEADERS,
                                            json=payload, proxy=proxy) as resp:
                        ctype = resp.headers.get("Content-Type", "")
                        if resp.status == 200 and "application/json" in ctype:
                            try:
                                return await resp.json()
                            except (aiohttp.ContentTypeError, ValueError) as exc:
                                exc_to_report = exc
                        else:
                            status = resp.status
                except aiohttp.ClientError as exc:
                    exc_to_report = exc

            if exc_to_report is not None:
                logger.warning("%s error de red (intento %d/%d): %s",
                               method, attempt, self.max_retries, exc_to_report)
            else:
                logger.warning("%s respondió %d (intento %d/%d); renovando sesión...",
                               method, status, attempt, self.max_retries)
                await self.session.refresh(session)
            await self._sleep(self.backoff_base ** attempt)
        raise RetriesExhausted(
            f"{method}: agotados los reintentos ({self.max_retries})")
