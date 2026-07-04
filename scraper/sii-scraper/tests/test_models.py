from sii_scraper.domain.models import (
    slugify_comuna, parse_predio, parse_manzana, split_rol, Predio, Manzana,
    parse_regiones, Region, ComunaRef,
)

RAW = {
    "data": {
        "rol": "123-45",
        "nombreComuna": "VITACURA",
        "valorTotal": 1000,
        "valorAfecto": 800,
        "valorExento": 200,
        "ubicacionX": -33.4,
        "ubicacionY": -70.6,
        "nombreProp": "Juan Perez",
        "direccion": "Av Siempre Viva 1",
        "datosCapas": [
            {"titulo": "Area Homogenea",
             "datos": [
                 {"etiqueta": "Cod. Area Homogenea", "valor": "AH-7"},
                 {"etiqueta": "Superficie", "valor": "250"},
             ]},
        ],
    }
}


def test_slugify_comuna():
    assert slugify_comuna("Lo Barnechea") == "lo_barnechea"
    assert slugify_comuna("Ñuñoa") == "nunoa"


def test_parse_predio_full():
    p = parse_predio(RAW, comuna_id=15160)
    assert isinstance(p, Predio)
    assert p.rol_predio == "123-45"
    assert p.comuna == "VITACURA"
    assert p.comuna_id == 15160
    assert p.avaluo_total == 1000
    assert p.latitud == -33.4
    assert p.area_homogenea == "AH-7"
    assert p.superficie == "250"
    assert p.extraction_datetime  # no vacío


def test_parse_predio_no_data_returns_none():
    assert parse_predio({"data": None}, 1) is None
    assert parse_predio({}, 1) is None


def test_parse_predio_missing_fields_are_none():
    p = parse_predio({"data": {"rol": "1-2"}}, comuna_id=9)
    assert p.rol_predio == "1-2"
    assert p.avaluo_total is None
    assert p.area_homogenea is None
    assert p.superficie is None


def test_parse_manzana():
    m = parse_manzana(RAW, comuna_id=15160, manzana_id=123)
    assert isinstance(m, Manzana)
    assert m.manzana_id == 123
    assert m.comuna_id == 15160
    assert m.area_homogenea == "AH-7"


def test_parse_manzana_no_data():
    assert parse_manzana({"data": None}, 1, 2) is None


def test_split_rol():
    assert split_rol("123-45") == (123, 45)


REGIONES_RAW = {
    "data": [
        {"codigo": 1, "nombre": "REGIÓN DE TARAPACÁ",
         "comunas": [{"codigo": "1201", "nombre": "IQUIQUE"},
                     {"codigo": "1211", "nombre": "ALTO HOSPICIO"}]},
        {"codigo": 13, "nombre": "REGIÓN METROPOLITANA DE SANTIAGO",
         "comunas": [{"codigo": "15160", "nombre": "VITACURA"}]},
    ]
}


def test_parse_regiones():
    regs = parse_regiones(REGIONES_RAW)
    assert len(regs) == 2
    assert regs[0] == Region(
        region_id=1, nombre="REGIÓN DE TARAPACÁ",
        comunas=[ComunaRef(1201, "IQUIQUE"), ComunaRef(1211, "ALTO HOSPICIO")])
    # el codigo de comuna viene string y se normaliza a int
    assert regs[1].comunas[0] == ComunaRef(15160, "VITACURA")
    assert isinstance(regs[1].comunas[0].comuna_id, int)


def test_parse_regiones_empty():
    assert parse_regiones({"data": None}) == []
    assert parse_regiones({"data": []}) == []
    assert parse_regiones({}) == []


from sii_scraper.domain.models import parse_feature_info

# Respuesta real de getFeatureInfo (Vitacura, clic sobre una parcela), recortada.
FEATUREINFO_RAW = {"data": {"comuna": 15160, "manzana": 111, "predio": 10,
                            "existePredio": 1, "rol": "111-10", "ah": "EAB590"}}


def test_parse_feature_info_hit():
    assert parse_feature_info(FEATUREINFO_RAW) == {
        "comuna": 15160, "manzana": 111, "predio": 10, "area_homogenea": "EAB590"}


def test_parse_feature_info_no_predio():
    assert parse_feature_info({"data": {"comuna": 15160, "existePredio": 0}}) is None
    assert parse_feature_info({"data": None}) is None
    assert parse_feature_info({}) is None
