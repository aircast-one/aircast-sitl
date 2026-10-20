import json
import math
import time
import urllib.request
from bisect import bisect_right
from itertools import accumulate

from pymavlink import mavutil

from serve import current_home

SYSID = 2
SPEED_MS = 8
ROUTE_M = 2000
RATE_HZ = 10
EARTH_RADIUS_M = 6371000
ROUTER = "tcp:127.0.0.1:5760"
ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/{0[1]},{0[0]};{1[1]},{1[0]}?overview=full&geometries=geojson"
ROUTE_TIMEOUT_S = 10
RETRY_S = 30


def offset(point, bearing_deg, distance_m):
    lat, lng = point
    bearing = math.radians(bearing_deg)
    return (
        lat + math.degrees(distance_m * math.cos(bearing) / EARTH_RADIUS_M),
        lng + math.degrees(distance_m * math.sin(bearing) / (EARTH_RADIUS_M * math.cos(math.radians(lat)))),
    )


def leg(a, b):
    north = math.radians(b[0] - a[0]) * EARTH_RADIUS_M
    east = math.radians(b[1] - a[1]) * EARTH_RADIUS_M * math.cos(math.radians(a[0]))
    return north, east


def road(points):
    stations = list(accumulate((math.hypot(*leg(a, b)) for a, b in zip(points, points[1:])), initial=0))
    keep = max(bisect_right(stations, ROUTE_M), 2)
    return points[:keep], stations[:keep]


def along(route, s):
    points, stations = route
    i = min(bisect_right(stations, s), len(points) - 1)
    a, b = points[i - 1], points[i]
    span = stations[i] - stations[i - 1]
    f = (s - stations[i - 1]) / span if span else 0
    north, east = leg(a, b)
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), math.atan2(east, north)


def drive(route, t):
    length = route[1][-1]
    s = (SPEED_MS * t) % (2 * length)
    point, heading = along(route, min(s, 2 * length - s))
    return point, heading if s <= length else heading + math.pi


def fetch_route(home):
    start = (home["lat"], home["lng"])
    url = ROUTE_URL.format(start, offset(start, home["heading"], ROUTE_M))
    with urllib.request.urlopen(url, timeout=ROUTE_TIMEOUT_S) as res:
        coordinates = json.load(res)["routes"][0]["geometry"]["coordinates"]
    return road([(lat, lng) for lng, lat in coordinates])


def find_route(home):
    while True:
        try:
            return fetch_route(home)
        except (OSError, ValueError, KeyError, IndexError) as e:
            print(f"No road found near {home['lat']}, {home['lng']} ({e}), retrying in {RETRY_S} s")
            time.sleep(RETRY_S)


def connect():
    while True:
        try:
            return mavutil.mavlink_connection(ROUTER, source_system=SYSID, autoreconnect=True)
        except OSError as e:
            print(f"Waiting for mavlink-router at {ROUTER}... ({e})")
            time.sleep(2)


def main():
    home = current_home()
    route = find_route(home)
    conn = connect()
    print(f"Car (sysid {SYSID}) driving {route[1][-1]:.0f} m of road and back at {SPEED_MS} m/s")
    started = time.monotonic()
    while True:
        t = time.monotonic() - started
        (lat, lng), heading = drive(route, t)
        conn.mav.global_position_int_send(
            int(t * 1000),
            int(lat * 1e7),
            int(lng * 1e7),
            int(home["alt"] * 1000),
            0,
            int(SPEED_MS * math.cos(heading) * 100),
            int(SPEED_MS * math.sin(heading) * 100),
            0,
            int(math.degrees(heading) % 360 * 100),
        )
        time.sleep(1 / RATE_HZ)


if __name__ == "__main__":
    main()
