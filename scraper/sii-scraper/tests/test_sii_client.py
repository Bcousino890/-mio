import asyncio
import re
import aiohttp
import pytest
from aioresponses import aioresponses
from sii_scraper.client.session import SIISession, SERVICE_URL, VIEWER_URL
from sii_scraper.client.rate_limiter import RateLimiter
from sii_scraper.client.sii_client import (
    SIIClient, build_predio_payload, RetriesExhausted, _extract_servicios,
)


SERVICIOS_COMUNA_PAYLOAD = {
    "data": [
        {"aliasServicio": "P", "layer": "sii:BR_CART_VITACURA_WMS",
         "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0, "orden": 1},
        {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
         "style": "AH_MUESTRA_EAC_15_2025", "eac": 15, "eacano": 2025, "orden": 11},
    ]
}


def _mock_servicios(m, comuna_id=15160, repeat=False):
    url = f"{SERVICE_URL}/listServiciosComunas"
    m.post(url, status=200, payload=SERVICIOS_COMUNA_PAYLOAD,
           headers={"Content-Type": "application/json"}, repeat=repeat)


def _make_client(max_retries=3):
    async def _no_sleep(_):
        return None
    # drain_delay=0 + sleep sin espera real: evita que el cierre en
    # background de la sesión reemplazada (ver SIISession._drain_and_close)
    # quede pendiente al terminar el test y deje un "Unclosed client
    # session" cuando pytest cierra el event loop.
    sess = SIISession(drain_delay=0, sleep=_no_sleep)
    return SIIClient(
        session=sess,
        rate_limiter=RateLimiter(1000),
        semaphore=asyncio.Semaphore(4),
        max_retries=max_retries,
        backoff_base=2.0,
        sleep=_no_sleep,
    )


def test_build_predio_payload():
    servicios = [{"comuna": 15160, "layer": "X", "style": "Y", "eac": 1, "eacano": 2024}]
    p = build_predio_payload(15160, 123, 45, servicios)
    assert p["data"]["predio"] == {"comuna": "15160", "manzana": "123", "predio": "45"}
    assert p["data"]["servicios"] == servicios
    assert p["metaData"]["transactionId"] == "getPredioNacional"


async def test_fetch_predio_ok():
    url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(url, status=200, payload={"data": {"rol": "1-2"}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.fetch_predio(15160, 1, 2)
        assert out == {"data": {"rol": "1-2"}}
        await client.session.close()


async def test_post_retries_on_429_then_succeeds():
    url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(url, status=429, body="rate limited")  # 1er intento
        m.post(url, status=200, payload={"data": {"rol": "9-9"}},
               headers={"Content-Type": "application/json"})  # 2do intento
        client = _make_client()
        out = await client.fetch_predio(15160, 9, 9)
        assert out == {"data": {"rol": "9-9"}}
        await client.session.close()


async def test_post_raises_when_retries_exhausted():
    url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(url, status=429, body="rate limited", repeat=True)
        client = _make_client(max_retries=2)
        with pytest.raises(RetriesExhausted):
            await client.fetch_predio(15160, 1, 1)
        await client.session.close()


async def test_fetch_predio_ok_with_proxy_configured(monkeypatch):
    # End-to-end (SIISession + SIIClient reales, HTTP mockeado) con las 4
    # variables de entorno de proxy SmartProxy CL configuradas: confirma que
    # _post lee session.proxy_url y lo pasa a session.post(...) sin romper el
    # flujo normal. La construcción de la URL de proxy en sí ya está cubierta
    # a fondo en test_session.py.
    for name in ("SMARTPROXY_CL_HOST", "SMARTPROXY_CL_PORT",
                 "SMARTPROXY_CL_USER", "SMARTPROXY_CL_PASS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SMARTPROXY_CL_HOST", "proxy.example.com")
    monkeypatch.setenv("SMARTPROXY_CL_PORT", "3121")
    monkeypatch.setenv("SMARTPROXY_CL_USER", "myuser")
    monkeypatch.setenv("SMARTPROXY_CL_PASS", "mypass")

    url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(url, status=200, payload={"data": {"rol": "1-2"}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.fetch_predio(15160, 1, 2)
        assert out == {"data": {"rol": "1-2"}}
        assert client.session.proxy_url is not None
        assert re.match(
            r"^http://myuser-session-[0-9a-f]+:mypass@proxy\.example\.com:3121$",
            client.session.proxy_url,
        )
        await client.session.close()


async def test_post_retries_on_network_error_then_succeeds():
    url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(url, exception=aiohttp.ClientConnectionError("boom"))
        m.post(url, status=200, payload={"data": {"rol": "5-5"}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.fetch_predio(15160, 5, 5)
        assert out == {"data": {"rol": "5-5"}}
        await client.session.close()


def test_extract_servicios_picks_lowest_orden_among_ah():
    raw = {
        "data": [
            {"aliasServicio": "M", "layer": "sii:BR_CART_MANZANAS",
             "style": "MANZANAS_V2", "eac": 0, "eacano": 0, "orden": 2},
            {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
             "style": "AH_MUESTRA_EAC_14_2022", "eac": 14, "eacano": 2022, "orden": 25},
            {"aliasServicio": "P", "layer": "sii:BR_CART_VITACURA_WMS",
             "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0, "orden": 1},
            {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
             "style": "AH_MUESTRA_EAC_15_2024", "eac": 15, "eacano": 2024, "orden": 23},
            {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
             "style": "AH_MUESTRA_EAC_15_2025", "eac": 15, "eacano": 2025, "orden": 11},
            {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
             "style": "AH_MUESTRA_EAC_15_2023", "eac": 15, "eacano": 2023, "orden": 24},
        ]
    }
    servicios, faltantes = _extract_servicios(raw, 15160)
    assert faltantes == []
    assert servicios == [
        {"comuna": 15160, "layer": "sii:BR_CART_VITACURA_WMS",
         "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0},
        {"comuna": 15160, "layer": "sii:BR_CART_AH_MUESTRAS",
         "style": "AH_MUESTRA_EAC_15_2025", "eac": 15, "eacano": 2025},
    ]


def test_extract_servicios_no_predios():
    raw = {"data": [
        {"aliasServicio": "AH", "layer": "sii:BR_CART_AH_MUESTRAS",
         "style": "AH_MUESTRA_EAC_15_2025", "eac": 15, "eacano": 2025, "orden": 11},
    ]}
    servicios, faltantes = _extract_servicios(raw, 15160)
    assert faltantes == ["Predios"]
    assert servicios == [
        {"comuna": 15160, "layer": "sii:BR_CART_AH_MUESTRAS",
         "style": "AH_MUESTRA_EAC_15_2025", "eac": 15, "eacano": 2025},
    ]


def test_extract_servicios_no_ah():
    raw = {"data": [
        {"aliasServicio": "P", "layer": "sii:BR_CART_VITACURA_WMS",
         "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0, "orden": 1},
    ]}
    servicios, faltantes = _extract_servicios(raw, 15160)
    assert faltantes == ["Area Homogenea"]
    assert servicios == [
        {"comuna": 15160, "layer": "sii:BR_CART_VITACURA_WMS",
         "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0},
    ]


def test_extract_servicios_empty_data():
    assert _extract_servicios({}, 15160) == ([], ["Predios", "Area Homogenea"])
    assert _extract_servicios({"data": []}, 15160) == ([], ["Predios", "Area Homogenea"])
    assert _extract_servicios({"data": None}, 15160) == ([], ["Predios", "Area Homogenea"])


async def test_get_servicios_cached_across_fetch_predio_calls():
    predio_url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m, repeat=False)  # sin repeat=True: una 2da llamada sin mock fallaria
        m.post(predio_url, status=200, payload={"data": {"rol": "1-1"}},
               headers={"Content-Type": "application/json"})
        m.post(predio_url, status=200, payload={"data": {"rol": "2-2"}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out1, out2 = await asyncio.gather(
            client.fetch_predio(15160, 1, 1),
            client.fetch_predio(15160, 2, 2),
        )
        assert out1 == {"data": {"rol": "1-1"}}
        assert out2 == {"data": {"rol": "2-2"}}
        await client.session.close()


async def test_get_servicios_failure_raises_and_does_not_poison_cache():
    servicios_url = f"{SERVICE_URL}/listServiciosComunas"
    predio_url = f"{SERVICE_URL}/getPredioNacional"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(servicios_url, status=429, body="rate limited", repeat=True)
        client = _make_client(max_retries=2)
        with pytest.raises(RetriesExhausted):
            await client.fetch_predio(15160, 1, 1)
        assert 15160 not in client._servicios_cache
        await client.session.close()

    # Una corrida nueva, con el endpoint funcionando, debe seguir sirviendo bien
    # (prueba de que no quedo un valor invalido/parcial "pegado").
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        _mock_servicios(m)
        m.post(predio_url, status=200, payload={"data": {"rol": "3-3"}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.fetch_predio(15160, 3, 3)
        assert out == {"data": {"rol": "3-3"}}
        await client.session.close()


def test_regiones_payload_namespace():
    from sii_scraper.client.sii_client import _regiones_payload
    p = _regiones_payload()
    assert p["metaData"]["transactionId"] == "listRegiones"
    assert p["metaData"]["namespace"].endswith("/listRegiones")
    assert "data" not in p


async def test_get_regiones_ok():
    url = f"{SERVICE_URL}/listRegiones"
    payload = {"data": [{"codigo": 1, "nombre": "REGIÓN DE TARAPACÁ",
                         "comunas": [{"codigo": "1201", "nombre": "IQUIQUE"}]}]}
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(url, status=200, payload=payload,
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.get_regiones()
        assert out == payload
        await client.session.close()


SERVICIOS_RAW_GEO = {"data": [
    {"aliasServicio": "P", "comuna": 15160, "layer": "sii:BR_CART_VITACURA_WMS",
     "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0,
     "latitud": -33.3794, "longitud": -70.573, "zoom": 13, "orden": 1},
    {"aliasServicio": "M", "layer": "sii:BR_CART_MANZANAS", "style": "MANZANAS_V2",
     "eac": 0, "eacano": 0, "orden": 2},
]}


def test_feature_info_payload_axes():
    from sii_scraper.client.sii_client import _feature_info_payload
    servicio = {"comuna": 15160, "layer": "sii:BR_CART_VITACURA_WMS",
                "style": "PREDIOS_WMS_V0", "eac": 0, "eacano": 0}
    p = _feature_info_payload(15160, servicio, -33.5, -70.7, -33.3, -70.5,
                              128, 128, 256, 256)
    ci = p["data"]["clickInfo"]
    assert ci["southwestx"] == -33.5 and ci["northeastx"] == -33.3   # latitudes
    assert ci["southwesty"] == -70.7 and ci["northeasty"] == -70.5   # longitudes
    assert ci["x"] == 128 and ci["y"] == 128 and ci["width"] == 256
    assert ci["layer"] == "sii:BR_CART_VITACURA_WMS"
    assert ci["servicios"] == [servicio]
    assert p["metaData"]["transactionId"] == "getFeatureInfo"


async def test_get_predios_servicio_returns_p_entry():
    url = f"{SERVICE_URL}/listServiciosComunas"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(url, status=200, payload=SERVICIOS_RAW_GEO,
               headers={"Content-Type": "application/json"})
        client = _make_client()
        p = await client.get_predios_servicio(15160)
        assert p["layer"] == "sii:BR_CART_VITACURA_WMS"
        assert p["zoom"] == 13 and p["latitud"] == -33.3794
        await client.session.close()


async def test_get_predios_servicio_none_when_no_predios():
    url = f"{SERVICE_URL}/listServiciosComunas"
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(url, status=200,
               payload={"data": [{"aliasServicio": "M", "layer": "x", "style": "y"}]},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        assert await client.get_predios_servicio(15160) is None
        await client.session.close()


async def test_get_feature_info_ok():
    url = f"{SERVICE_URL}/getFeatureInfo"
    servicio = {"comuna": 15160, "layer": "L", "style": "S", "eac": 0, "eacano": 0}
    with aioresponses() as m:
        m.get(VIEWER_URL, status=200, body="ok", repeat=True)
        m.post(url, status=200,
               payload={"data": {"manzana": 111, "predio": 10, "existePredio": 1}},
               headers={"Content-Type": "application/json"})
        client = _make_client()
        out = await client.get_feature_info(15160, servicio, -33.5, -70.7, -33.3,
                                            -70.5, 128, 128, 256, 256)
        assert out["data"]["manzana"] == 111
        await client.session.close()
