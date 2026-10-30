import math

from target import LAP_M, racetrack


def test_racetrack_is_continuous_and_heads_along_travel():
    points = [racetrack(s) for s in range(int(LAP_M) + 2)]
    steps = list(zip(points, points[1:]))
    assert all(math.dist(a[:2], b[:2]) < 1.01 for a, b in steps)
    assert all(abs(math.remainder(math.atan2(b[1] - a[1], b[0] - a[0]) - a[2], math.tau)) < 0.01 for a, b in steps)
