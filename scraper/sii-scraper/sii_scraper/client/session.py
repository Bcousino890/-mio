import asyncio
import os
import secrets
from urllib.parse import quote

import aiohttp

BASE_URL = "https://www4.sii.cl"
VIEWER_URL = f"{BASE_URL}/mapasui/internet/"
SERVICE_URL = f"{BASE_URL}/mapasui/services/data/mapasFacadeService"
USER_AGENT = ("Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) "
              "Gecko/20100101 Firefox/127.0")

SERVICE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-CL,es;q=0.8,en-US;q=0.5,en;q=0.3",
    "Referer": VIEWER_URL,
    "Content-Type": "application/json",
    "Origin": BASE_URL,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

_PROXY_ENV_VARS = (
    "SMARTPROXY_CL_HOST",
    "SMARTPROXY_CL_PORT",
    "SMARTPROXY_CL_USER",
    "SMARTPROXY_CL_PASS",
)


def _new_sticky_proxy_url() -> str | None:
    """Arma la URL de un proxy HTTP a partir de la cuenta SmartProxy CL ya
    usada en el resto del proyecto (ver `scraper/lib/fetch.mjs`, perfil
    'portalinmobiliario', y `.env.example`) -- misma cuenta residencial
    dedicada a Chile, compartida con el scraping de Portalinmobiliario y la
    geocodificación de roles SII.

    SmartProxy rota la IP de salida por SESIÓN: agregar "-session-<id>" al
    username ata la conexión a una IP fija mientras dure esa sesión; un
    <id> nuevo (generado aquí en cada llamada) pide una IP distinta. Igual
    que antes, cada generación de SIISession (bootstrap inicial, y cada
    refresh() tras un 429/bloqueo sostenido) saca un <id> de sesión nuevo:
    identidad (IP + cookies) realmente nueva al recuperarse de un bloqueo,
    mientras se mantiene una única IP consistente durante la vida de una
    sesión que sí funciona (coherente con las cookies que esa IP obtuvo) --
    igual invariante que antes (WAF ata cookies a la IP que las emitió),
    solo que la identidad sticky se codifica en el username en vez del
    puerto.

    Sin las 4 variables configuradas, no se usa proxy (conexión directa,
    comportamiento por defecto). Si están parcialmente configuradas, se
    lanza un error claro en vez de arrancar con un proxy mal armado.
    """
    values = {name: os.environ.get(name) for name in _PROXY_ENV_VARS}
    if not any(values.values()):
        return None
    missing = [name for name, v in values.items() if not v]
    if missing:
        raise RuntimeError(
            "Configuracion de proxy incompleta; faltan variables de entorno: "
            + ", ".join(missing)
        )
    host = values["SMARTPROXY_CL_HOST"]
    port = values["SMARTPROXY_CL_PORT"]
    session_id = secrets.token_hex(6)
    # quote(): el usuario/password reales pueden traer caracteres reservados
    # de URL (@, :, etc.); sin escapar, romperian el parseo de la URL del
    # proxy de forma confusa.
    username = quote(f'{values["SMARTPROXY_CL_USER"]}-session-{session_id}')
    password = quote(values["SMARTPROXY_CL_PASS"])
    return f"http://{username}:{password}@{host}:{port}"


class SIISession:
    def __init__(self, drain_delay: float = 5.0, sleep=asyncio.sleep):
        self._session: aiohttp.ClientSession | None = None
        self._proxy_url: str | None = None
        # Serializa bootstrap/refresh/close: bajo max_concurrency>1, varias
        # tareas pueden detectar una sesión caída al mismo tiempo (p.ej. tras
        # una ráfaga de 429 del WAF). Sin este lock, cada una cierra/reemplaza
        # self._session de forma independiente y las demás terminan usando un
        # ClientSession/Connector ya cerrado ("Connector is closed"), además
        # de dejar sesiones sin cerrar ("Unclosed client session").
        self._lock = asyncio.Lock()
        # Cuánto esperar antes de cerrar de verdad una sesión reemplazada, y
        # con qué función dormir (inyectable para tests, igual que
        # SIIClient.__init__(..., sleep=asyncio.sleep)).
        self._drain_delay = drain_delay
        self._sleep = sleep
        # Sesiones viejas ya programadas para drain-and-close en background
        # (ver _bootstrap/_drain_and_close). Se necesita este registro para
        # que close() pueda cerrarlas de inmediato si el programa entero
        # termina antes de que se cumpla drain_delay (ver close() más abajo).
        self._pending_drains: set[aiohttp.ClientSession] = set()

    @property
    def proxy_url(self) -> str | None:
        # INVARIANTE: llamar a esto justo despues de `await self.session.get()`,
        # sin ningun `await` en el medio. asyncio solo cede el control en
        # puntos `await`, asi que dos accesos sincronicos consecutivos
        # (get() ya retorno -> leer .proxy_url) no pueden ser interrumpidos
        # por otra corrutina que reemplace self._session/self._proxy_url en
        # el medio. Si en el futuro se inserta un `await` entre ambas
        # lecturas, se reintroduce una carrera: el proxy podria terminar
        # desincronizado de las cookies de la sesion que efectivamente se usa.
        return self._proxy_url

    async def get(self) -> aiohttp.ClientSession:
        async with self._lock:
            if self._session is None or self._session.closed:
                await self._bootstrap()
            return self._session

    async def _bootstrap(self) -> None:
        # Solo se debe invocar con self._lock ya adquirido (por get()/refresh()).
        old_session = self._session
        self._session = None
        # Programamos el drain-and-close de old_session de forma incondicional,
        # ANTES de intentar el nuevo bootstrap: la limpieza de la sesión vieja
        # no depende lógicamente de que el nuevo bootstrap tenga éxito. Si el
        # GET a VIEWER_URL de abajo falla (algo realista: los refresh ocurren
        # justo cuando el SII/WAF ya se está portando mal), old_session igual
        # debe drenarse y cerrarse; de lo contrario queda huérfana y
        # reintroducimos el leak de "Unclosed client session" que este fix
        # existe para eliminar. No "simplificar" esto moviéndolo de vuelta a
        # después del try/except: eso lo vuelve a hacer condicional al éxito.
        if old_session is not None and not old_session.closed:
            self._pending_drains.add(old_session)
            asyncio.ensure_future(self._drain_and_close(old_session))
        # Nueva identidad de proxy (nuevo puerto sticky -> nueva IP de
        # salida) para esta generación de sesión: se pide ANTES/junto con
        # crear el ClientSession nuevo, y se usa ya en el propio GET de
        # bootstrap, para que cookies e IP queden pareadas desde el primer
        # request de la generación.
        proxy_url = _new_sticky_proxy_url()
        session = aiohttp.ClientSession(headers={"User-Agent": USER_AGENT})
        try:
            # Visitar el visor establece las cookies de sesión y del WAF (TS..., JSESSIONID).
            async with session.get(VIEWER_URL, proxy=proxy_url) as resp:
                await resp.read()
        except Exception:
            await session.close()
            raise
        self._session = session
        # self._proxy_url se asigna recién aquí, junto con self._session, para
        # que siempre quede pareado con la sesión (cookies) que efectivamente
        # se estableció usándolo -- ver la nota de invariante en la property
        # proxy_url de más arriba.
        self._proxy_url = proxy_url
        # old_session no se cierra de forma síncrona (ver arriba): session.get()
        # entrega la referencia fuera de este lock (sii_client.py hace
        # `session = await self.session.get()` y luego `session.post(...)`
        # sin el lock sostenido), así que otra tarea puede tener un POST en
        # vuelo sobre old_session en este mismo instante. Cerrarla de
        # inmediato tumba su Connector a mitad de esa request y esa tarea
        # revienta con "Connector is closed" (confirmado en runs en vivo con
        # max_concurrency=2). En vez de eso, dejamos que drene: se cierra en
        # background tras un breve plazo de gracia.

    async def _drain_and_close(self, session: aiohttp.ClientSession) -> None:
        await self._sleep(self._drain_delay)
        if not session.closed:
            await session.close()
        # .discard() (no .remove()): close() puede haber cerrado y sacado ya
        # esta sesión de _pending_drains si el programa terminó antes de que
        # se cumpliera drain_delay -- esta tarea puede seguir corriendo (o
        # reanudarse) después de eso, y no debe reventar por un elemento que
        # ya no está.
        self._pending_drains.discard(session)

    async def refresh(self, stale_session: aiohttp.ClientSession | None = None) -> None:
        async with self._lock:
            # Si el llamador nos dice qué sesión vio fallar y self._session ya
            # cambió (otro llamador concurrente ya la refrescó), no hace falta
            # volver a bootstrapear: evita N re-bootstraps redundantes (y N
            # visitas a VIEWER_URL) para una misma ráfaga de fallos.
            if (stale_session is not None and self._session is not None
                    and self._session is not stale_session):
                return
            await self._bootstrap()

    async def close(self) -> None:
        async with self._lock:
            if self._session is not None and not self._session.closed:
                await self._session.close()
            # Además de la sesión actual, cerramos de inmediato cualquier
            # sesión vieja que siga esperando su plazo de gracia de drain
            # (_pending_drains). Esto es seguro SOLO porque el único llamador
            # real de close() es orchestrator.run_stage, en su bloque
            # `finally`, que se ejecuta después de que `await
            # STAGES[stage](client, config)` ya terminó por completo -- es
            # decir, después de que TODOS los `asyncio.gather(*tasks)` de esa
            # etapa ya resolvieron. En ese punto no puede quedar ningún
            # request legítimo en vuelo contra NINGUNA generación de sesión
            # (ni la actual ni las viejas en drenaje), así que la razón por
            # la que _bootstrap() no cierra old_session de forma síncrona
            # (evitar tumbar un Connector bajo un POST en curso) ya no
            # aplica aquí. Sin este cierre inmediato, una corrida que
            # termina rápido (p.ej. una etapa que no encuentra trabajo
            # pendiente y retorna en milisegundos) puede salir del proceso
            # antes de que el `asyncio.sleep(drain_delay)` en background
            # termine, dejando el ClientSession/Connector viejo sin cerrar
            # ("Unclosed client session" / "Unclosed connector" al salir).
            # NO "simplificar" esto quitándolo: reintroduciría exactamente
            # ese leak.
            pending = list(self._pending_drains)
            self._pending_drains.clear()
            for session in pending:
                if not session.closed:
                    await session.close()
