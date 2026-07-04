import pytest
from sii_scraper.geo import half_extent_m, bbox_around, grid_points


def test_half_extent_m_vitacura_zoom13():
    # Vitacura: zoom 13, lat ~-33.4 -> ~9.6 km de semi-extension
    h = half_extent_m(13, -33.4)
    assert h == pytest.approx(9570, rel=0.05)


def test_bbox_around_centered_and_lon_wider_than_lat():
    sw_lat, sw_lon, ne_lat, ne_lon = bbox_around(-33.4, -70.6, 9570.0)
    # queda centrado en el punto
    assert (sw_lat + ne_lat) / 2 == pytest.approx(-33.4, abs=1e-9)
    assert (sw_lon + ne_lon) / 2 == pytest.approx(-70.6, abs=1e-9)
    # semi-extension en lat = metros/111320
    assert ne_lat - (-33.4) == pytest.approx(9570.0 / 111320.0, rel=1e-6)
    # en longitud abarca mas grados (se divide por cos(lat) < 1)
    assert (ne_lon - (-70.6)) > (ne_lat - (-33.4))


def test_grid_points_count_and_order():
    # bbox de 0.0025deg de lado, paso ~0.001deg -> 3x3 = 9 puntos
    pts = grid_points(0.0, 0.0, 0.0025, 0.0025, step_m=111.32)
    assert len(pts) == 9
    assert pts[0] == pytest.approx((0.0, 0.0))
    # filas sur->norte: la latitud crece a lo largo de la lista
    assert pts[0][0] <= pts[-1][0]
    lats = sorted({round(p[0], 4) for p in pts})
    assert lats == pytest.approx([0.0, 0.001, 0.002], abs=1e-4)


def test_grid_points_single_point_when_bbox_tiny():
    pts = grid_points(-33.4, -70.6, -33.4, -70.6, step_m=100)
    assert pts == [pytest.approx((-33.4, -70.6))]
