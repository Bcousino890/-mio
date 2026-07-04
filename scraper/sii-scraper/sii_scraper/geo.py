"""Geometría pura para el descubrimiento geográfico de manzanas.

Sin red ni estado: solo convierte centro/zoom/paso en un bbox y una grilla de
puntos (lat, lon). El SII usa Web Mercator para el zoom del visor; para armar la
grilla en grados usamos la aproximación esférica estándar (1° lat ≈ 111.320 m,
1° lon ≈ 111.320 m · cos(lat)), suficiente a escala de una comuna.
"""
import math

# Metros por grado de latitud (aprox. esférica; constante).
_M_PER_DEG_LAT = 111_320.0
# Resolución Web Mercator en el ecuador a zoom 0, en m/px.
_EARTH_CIRC_OVER_256 = 156_543.033_92
# Mitad del ancho asumido del visor del SII (≈1200 px de mapa) en px.
_HALF_VIEWPORT_PX = 600.0


def half_extent_m(zoom: int, lat: float) -> float:
    """Semi-extensión (en metros) del bbox por defecto, derivada del `zoom` con
    que el SII encuadra la comuna. A mayor zoom, área más chica."""
    m_per_px = _EARTH_CIRC_OVER_256 * math.cos(math.radians(lat)) / (2 ** zoom)
    return m_per_px * _HALF_VIEWPORT_PX


def _m_per_deg_lon(lat: float) -> float:
    return _M_PER_DEG_LAT * math.cos(math.radians(lat))


def bbox_around(lat: float, lon: float, half_m: float) -> tuple[float, float, float, float]:
    """Bbox cuadrado (en metros) centrado en (lat, lon).
    Devuelve (sw_lat, sw_lon, ne_lat, ne_lon)."""
    dlat = half_m / _M_PER_DEG_LAT
    dlon = half_m / _m_per_deg_lon(lat)
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def grid_points(sw_lat: float, sw_lon: float, ne_lat: float, ne_lon: float,
                step_m: float) -> list[tuple[float, float]]:
    """Puntos de una grilla regular que cubre el bbox, con paso `step_m`.
    Orden determinístico: filas de sur a norte, columnas de oeste a este.
    Usa índices enteros (no acumula error de punto flotante)."""
    lat0 = (sw_lat + ne_lat) / 2.0
    dlat = step_m / _M_PER_DEG_LAT
    dlon = step_m / _m_per_deg_lon(lat0)
    n_rows = int((ne_lat - sw_lat) / dlat) + 1
    n_cols = int((ne_lon - sw_lon) / dlon) + 1
    pts = []
    for i in range(n_rows):
        lat = sw_lat + i * dlat
        for j in range(n_cols):
            pts.append((lat, sw_lon + j * dlon))
    return pts
