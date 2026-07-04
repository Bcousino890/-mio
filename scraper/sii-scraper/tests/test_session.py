import asyncio
import re
from urllib.parse import unquote, urlsplit

import aiohttp
import pytest
from aioresponses import aioresponses
from sii_scraper.client.session import SIISession, VIEWER_URL, _new_sticky_proxy_url


async def _no_sleep(_delay):
    # Sustituye asyncio.sleep en tests: no debe dormir tiempo real, solo
    # ceder el control del event loop para que las tareas en background
    # (p.ej. _drain_and_close vía ensure_future) tengan chance de avanzar.
    return None


def _fast_session(**kwargs):
    kwargs.setdefault("drain_delay", 0)
    kwargs.setdefault("sleep", _no_sleep)
    return SIISession(**kwargs)


async def test_get_bootstraps_once_and_visits_viewer():
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok")
        sess = _fast_session()
        s1 = await sess.get()
        s2 = await sess.get()          # no re-bootstrapea
        assert s1 is s2
        await sess.close()


async def test_refresh_creates_new_session():
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        sess = _fast_session()
        s1 = await sess.get()
        await sess.refresh()
        # Deja correr el drain en background (drain_delay=0) antes de
        # comprobar que s1 efectivamente se cerró.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        s2 = await sess.get()
        assert s1 is not s2
        assert s1.closed
        await sess.close()


async def test_get_retries_bootstrap_after_failure():
    with aioresponses() as m:
        m.get(VIEWER_URL, exception=aiohttp.ClientConnectionError("boom"))
        m.get(VIEWER_URL, status=200, body="ok")
        sess = _fast_session()
        with pytest.raises(aiohttp.ClientConnectionError):
            await sess.get()
        s = await sess.get()  # should retry bootstrap, not reuse a broken session
        assert s is not None and not s.closed
        await sess.close()


async def test_concurrent_refresh_of_same_stale_session_bootstraps_once():
    # Simula varias tareas concurrentes que reciben una respuesta mala de la
    # MISMA generación de sesión (p.ej. una ráfaga de 429 del WAF) y llaman
    # refresh(stale_session) casi al mismo tiempo. Solo debe ocurrir UN
    # re-bootstrap real (una sola visita adicional a VIEWER_URL), no N.
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok")  # bootstrap inicial via get()
        m.get(VIEWER_URL, status=200, body="ok")  # único refresh real esperado

        sess = _fast_session()
        s1 = await sess.get()  # bootstrap inicial (1ra visita a VIEWER_URL)

        await asyncio.gather(*(sess.refresh(s1) for _ in range(5)))
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        s2 = await sess.get()
        assert s2 is not None and not s2.closed
        assert s2 is not s1  # sí ocurrió un refresh real
        assert s1.closed

        # Si hubiera habido re-bootstraps redundantes, se habrían consumido
        # más de las 2 respuestas mockeadas y aioresponses habría fallado
        # antes (no quedarían respuestas para matchear). Verificamos
        # explícitamente el conteo real de GETs a VIEWER_URL.
        get_calls = [calls for (method, _url), calls in m.requests.items()
                     if method == "GET"]
        total_gets = sum(len(calls) for calls in get_calls)
        assert total_gets == 2  # 1 bootstrap inicial + 1 único refresh

        await sess.close()


async def test_old_session_still_drained_when_rebootstrap_fails():
    # Prueba de regresión (fix drain-close): si el re-bootstrap disparado por
    # refresh() falla (p.ej. el WAF sigue caído), old_session igual debe
    # quedar programada para drain-and-close. Antes del fix, el
    # ensure_future(self._drain_and_close(old_session)) solo se agendaba
    # después de un GET exitoso a VIEWER_URL, así que un re-bootstrap fallido
    # dejaba old_session huérfana ("Unclosed client session").
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok")  # bootstrap inicial
        m.get(VIEWER_URL, exception=aiohttp.ClientConnectionError("boom"))  # re-bootstrap de refresh() falla

        sess = _fast_session()
        s1 = await sess.get()  # bootstrap inicial

        with pytest.raises(aiohttp.ClientConnectionError):
            await sess.refresh(s1)

        # Deja correr el drain en background (drain_delay=0) antes de
        # comprobar que s1 efectivamente se cerró.
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert s1.closed

        await sess.close()


async def test_refresh_does_not_close_old_session_synchronously():
    # Prueba del fix: al hacer refresh(), la sesión vieja NO debe cerrarse
    # de inmediato (todavía puede haber un request en vuelo sobre ella,
    # tomado fuera del lock por otro llamador). Debe cerrarse recién
    # después del plazo de gracia (drain_delay), en background.
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)

        drain_started = asyncio.Event()
        drain_can_finish = asyncio.Event()

        async def controlled_sleep(_delay):
            drain_started.set()
            await drain_can_finish.wait()

        sess = SIISession(drain_delay=999, sleep=controlled_sleep)
        old_session = await sess.get()  # bootstrap inicial

        await sess.refresh()  # dispara un segundo bootstrap

        # Justo después de refresh(), la sesión vieja sigue viva: el drain
        # está en curso (bloqueado en controlled_sleep) pero no ha cerrado
        # nada todavía.
        await drain_started.wait()
        assert not old_session.closed

        # Al liberar el "sleep" del drain, la tarea en background debería
        # terminar de cerrar la sesión vieja.
        drain_can_finish.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert old_session.closed

        await sess.close()


async def test_close_closes_pending_drain_sessions_immediately():
    # Prueba de regresión (fix drain-close-at-exit): si el programa entero
    # termina (close() del orquestador) ANTES de que se cumpla el
    # drain_delay de una sesión vieja programada para drenaje, close() debe
    # cerrar esa sesión de inmediato en vez de dejarla huérfana esperando un
    # asyncio.sleep() que nunca va a terminar de correr (el event loop se
    # apaga junto con el proceso). Antes del fix, esto producía warnings
    # reales de "Unclosed client session"/"Unclosed connector" al salir en
    # corridas que terminan en menos de drain_delay segundos después del
    # último refresh (p.ej. una etapa sin trabajo pendiente).
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)

        drain_started = asyncio.Event()
        drain_can_finish = asyncio.Event()

        async def controlled_sleep(_delay):
            drain_started.set()
            await drain_can_finish.wait()

        sess = SIISession(drain_delay=999, sleep=controlled_sleep)
        old_session = await sess.get()  # bootstrap inicial

        await sess.refresh()  # dispara un segundo bootstrap, agenda drain de old_session

        # El drain está en curso pero bloqueado (nunca se libera
        # drain_can_finish): simula que el proceso termina antes de que se
        # cumpla drain_delay.
        await drain_started.wait()
        assert not old_session.closed

        current_session = await sess.get()
        assert current_session is not old_session

        await sess.close()

        # close() debió cerrar tanto la sesión actual...
        assert current_session.closed
        # ...como la vieja que seguía pendiente de drenaje, sin esperar el
        # plazo de gracia (que en este test nunca se cumple: drain_can_finish
        # no se seteó).
        assert old_session.closed
        assert sess._pending_drains == set()

        # Limpieza: liberamos el controlled_sleep para que la tarea de
        # _drain_and_close en background (todavía "viva", solo abandonada
        # por close()) termine de correr en vez de quedar pendiente para
        # siempre -- eso es justo lo que asyncio.run() haría de forma
        # transparente al cerrar el loop del proceso real (ver punto 3 del
        # fix), pero en el loop del test nadie lo hace por nosotros.
        drain_can_finish.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)


async def test_close_with_no_pending_drains_still_works():
    # Caso simple/común (el de la mayoría de los tests existentes): sin
    # ningún drain pendiente, close() debe seguir cerrando solo la sesión
    # actual, sin romperse por iterar un set vacío.
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok")
        sess = _fast_session()
        s1 = await sess.get()
        assert not sess._pending_drains

        await sess.close()

        assert s1.closed
        assert sess._pending_drains == set()


_PROXY_ENV_VARS = (
    "SMARTPROXY_CL_HOST",
    "SMARTPROXY_CL_PORT",
    "SMARTPROXY_CL_USER",
    "SMARTPROXY_CL_PASS",
)


def _clear_proxy_env(monkeypatch):
    for name in _PROXY_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def _set_proxy_env(monkeypatch, host="proxy.example.com", port="3121", username="myuser", password="mypass"):
    monkeypatch.setenv("SMARTPROXY_CL_HOST", host)
    monkeypatch.setenv("SMARTPROXY_CL_PORT", port)
    monkeypatch.setenv("SMARTPROXY_CL_USER", username)
    monkeypatch.setenv("SMARTPROXY_CL_PASS", password)


def test_new_sticky_proxy_url_returns_none_without_env_vars(monkeypatch):
    _clear_proxy_env(monkeypatch)
    assert _new_sticky_proxy_url() is None


def test_new_sticky_proxy_url_raises_on_partial_config(monkeypatch):
    _clear_proxy_env(monkeypatch)
    monkeypatch.setenv("SMARTPROXY_CL_HOST", "proxy.example.com")
    monkeypatch.setenv("SMARTPROXY_CL_USER", "myuser")
    with pytest.raises(RuntimeError) as excinfo:
        _new_sticky_proxy_url()
    assert "SMARTPROXY_CL_PORT" in str(excinfo.value)
    assert "SMARTPROXY_CL_PASS" in str(excinfo.value)
    assert "SMARTPROXY_CL_HOST" not in str(excinfo.value)
    assert "SMARTPROXY_CL_USER" not in str(excinfo.value)


def test_new_sticky_proxy_url_builds_url_with_session_suffix(monkeypatch):
    _clear_proxy_env(monkeypatch)
    _set_proxy_env(monkeypatch)

    pattern = re.compile(r"^http://myuser-session-([0-9a-f]+):mypass@proxy\.example\.com:3121$")

    url1 = _new_sticky_proxy_url()
    assert pattern.match(url1) is not None


def test_new_sticky_proxy_url_rotates_session_id_across_calls(monkeypatch):
    _clear_proxy_env(monkeypatch)
    _set_proxy_env(monkeypatch)

    pattern = re.compile(r"^http://myuser-session-([0-9a-f]+):mypass@proxy\.example\.com:3121$")

    session_ids = set()
    for _ in range(20):
        url = _new_sticky_proxy_url()
        m = pattern.match(url)
        assert m is not None
        session_ids.add(m.group(1))

    # Cada llamada saca un id de sesión nuevo (aleatorio): 20 llamadas
    # deberían dar 20 ids distintos, no un valor fijo.
    assert len(session_ids) == 20


def test_new_sticky_proxy_url_escapes_reserved_url_characters(monkeypatch):
    _clear_proxy_env(monkeypatch)
    _set_proxy_env(monkeypatch, password="pass:word@x")

    url = _new_sticky_proxy_url()
    parsed = urlsplit(url)
    assert unquote(parsed.password) == "pass:word@x"


async def test_bootstrap_uses_fresh_proxy_identity_on_refresh(monkeypatch):
    _clear_proxy_env(monkeypatch)
    _set_proxy_env(monkeypatch)

    pattern = re.compile(r"^http://myuser-session-([0-9a-f]+):mypass@proxy\.example\.com:3121$")

    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        sess = _fast_session()

        await sess.get()
        proxy_before = sess.proxy_url
        assert proxy_before is not None
        session_before = pattern.match(proxy_before).group(1)

        await sess.refresh()
        proxy_after = sess.proxy_url
        assert proxy_after is not None
        session_after = pattern.match(proxy_after).group(1)

        # rotó a una identidad (id de sesión/IP) nueva.
        assert session_after != session_before

        await sess.close()
