import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone


def slugify_comuna(nombre: str) -> str:
    s = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    s = s.strip().lower()
    return re.sub(r"\s+", "_", s)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_capa_value(capas, titulo_substr: str, etiqueta_substr: str):
    if not capas:
        return None
    for capa in capas:
        if titulo_substr.lower() in str(capa.get("titulo", "")).lower():
            for dato in capa.get("datos", []) or []:
                if etiqueta_substr.lower() in str(dato.get("etiqueta", "")).lower():
                    return dato.get("valor")
    return None


def split_rol(rol: str) -> tuple[int, int]:
    manzana_str, predio_str = rol.split("-", 1)
    return int(manzana_str), int(predio_str)


@dataclass
class Manzana:
    manzana_id: int
    comuna_id: int
    area_homogenea: str | None
    extraction_datetime: str


@dataclass
class ComunaRef:
    comuna_id: int
    nombre: str


@dataclass
class Region:
    region_id: int
    nombre: str
    comunas: list[ComunaRef]


@dataclass
class Predio:
    rol_predio: str | None
    comuna: str | None
    comuna_id: int
    avaluo_total: object
    avaluo_afecto: object
    avaluo_exento: object
    latitud: object
    longitud: object
    nombre_propiedad: str | None
    direccion: str | None
    area_homogenea: str | None
    superficie: str | None
    extraction_datetime: str
    extra_data: dict = field(default_factory=dict)


def parse_manzana(raw: dict, comuna_id: int, manzana_id: int) -> Manzana | None:
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data:
        return None
    return Manzana(
        manzana_id=manzana_id,
        comuna_id=comuna_id,
        area_homogenea=_extract_capa_value(data.get("datosCapas"), "Homo", "Homo"),
        extraction_datetime=_now_iso(),
    )


def parse_predio(raw: dict, comuna_id: int) -> Predio | None:
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data:
        return None
    capas = data.get("datosCapas")
    return Predio(
        rol_predio=data.get("rol"),
        comuna=data.get("nombreComuna"),
        comuna_id=comuna_id,
        avaluo_total=data.get("valorTotal"),
        avaluo_afecto=data.get("valorAfecto"),
        avaluo_exento=data.get("valorExento"),
        latitud=data.get("ubicacionX"),
        longitud=data.get("ubicacionY"),
        nombre_propiedad=data.get("nombreProp"),
        direccion=data.get("direccion"),
        area_homogenea=_extract_capa_value(capas, "Homo", "Homo"),
        superficie=_extract_capa_value(capas, "Homo", "superficie"),
        extraction_datetime=_now_iso(),
    )


def parse_feature_info(raw: dict) -> dict | None:
    """De la respuesta de getFeatureInfo (clic sobre una parcela), si hay un
    predio en ese punto (`existePredio == 1`), devuelve
    {comuna, manzana, predio, area_homogenea}. Si no, None."""
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data or data.get("existePredio") != 1:
        return None
    return {
        "comuna": data.get("comuna"),
        "manzana": data.get("manzana"),
        "predio": data.get("predio"),
        "area_homogenea": data.get("ah"),
    }


def parse_regiones(raw: dict) -> list[Region]:
    data = raw.get("data") if isinstance(raw, dict) else None
    if not data:
        return []
    regiones = []
    for r in data:
        comunas = [
            ComunaRef(comuna_id=int(c["codigo"]), nombre=c["nombre"])
            for c in (r.get("comunas") or [])
        ]
        regiones.append(Region(
            region_id=int(r["codigo"]),
            nombre=r["nombre"],
            comunas=comunas,
        ))
    return regiones
