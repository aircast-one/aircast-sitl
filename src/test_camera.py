import math

from camera import HFOV_DEG, MAV, ZOOM_MAX_X, zoom_after, zoomed_hfov


def test_zoom_spans_wide_to_ten_times_tele():
    assert math.isclose(zoomed_hfov(0), HFOV_DEG)
    assert math.isclose(math.tan(math.radians(zoomed_hfov(100) / 2)) * ZOOM_MAX_X, math.tan(math.radians(HFOV_DEG / 2)))


def test_zoom_steps_ten_percent_and_jumps_to_a_level_within_range():
    assert zoom_after(0.0, MAV.ZOOM_TYPE_STEP, 2) == 20.0
    assert zoom_after(10.0, MAV.ZOOM_TYPE_STEP, -5) == 0.0
    assert zoom_after(40.0, MAV.ZOOM_TYPE_RANGE, 150) == 100.0
    assert zoom_after(40.0, MAV.ZOOM_TYPE_CONTINUOUS, 1) is None
    assert zoom_after(40.0, math.nan, 1) is None
