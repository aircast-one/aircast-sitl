import math
import os
import time

from car import connect, offset
from serve import current_home

SYSID = 3
RATE_HZ = 20
SPEED_MS = float(os.environ.get("TARGET_SPEED_MS", "40"))
ALTITUDE_M = float(os.environ.get("TARGET_ALTITUDE_M", "200"))
LEG_M = 3000
TURN_RADIUS_M = 300
ALTITUDE_SWING_M = 15
ALTITUDE_WAVE_M = 2500
LAP_M = 2 * LEG_M + 2 * math.pi * TURN_RADIUS_M


def racetrack(distance):
    s = distance % LAP_M
    turn = math.pi * TURN_RADIUS_M
    if s < LEG_M:
        return -LEG_M / 2 + s, -TURN_RADIUS_M, 0.0
    if s < LEG_M + turn:
        angle = -math.pi / 2 + (s - LEG_M) / TURN_RADIUS_M
        return LEG_M / 2 + TURN_RADIUS_M * math.cos(angle), TURN_RADIUS_M * math.sin(angle), angle + math.pi / 2
    if s < 2 * LEG_M + turn:
        return LEG_M / 2 - (s - LEG_M - turn), TURN_RADIUS_M, math.pi
    angle = math.pi / 2 + (s - 2 * LEG_M - turn) / TURN_RADIUS_M
    return -LEG_M / 2 + TURN_RADIUS_M * math.cos(angle), TURN_RADIUS_M * math.sin(angle), angle + math.pi / 2


def altitude(distance):
    return ALTITUDE_M + ALTITUDE_SWING_M * math.sin(2 * math.pi * distance / ALTITUDE_WAVE_M)


def place(home, distance):
    along, across, _ = racetrack(distance)
    ahead = offset((home["lat"], home["lng"]), home["heading"], along)
    return offset(ahead, home["heading"] + 90, across + TURN_RADIUS_M)


def state(home, distance):
    _, _, track = racetrack(distance)
    heading = math.radians(home["heading"]) + track
    climb = SPEED_MS * 2 * math.pi * ALTITUDE_SWING_M / ALTITUDE_WAVE_M * math.cos(2 * math.pi * distance / ALTITUDE_WAVE_M)
    return SPEED_MS * math.cos(heading), SPEED_MS * math.sin(heading), climb, heading


def main():
    home = current_home()
    conn = connect(SYSID)
    print(f"Target drone (sysid {SYSID}) flying a {LAP_M / 1000:.1f} km racetrack at {SPEED_MS:g} m/s, {ALTITUDE_M:g} m")
    started = last = time.monotonic()
    distance = 0.0
    while True:
        now = time.monotonic()
        distance += SPEED_MS * (now - last)
        last = now
        lat, lng = place(home, distance)
        up = altitude(distance)
        north, east, climb, heading = state(home, distance)
        conn.mav.global_position_int_send(
            int((now - started) * 1000),
            int(lat * 1e7),
            int(lng * 1e7),
            int((home["alt"] + up) * 1000),
            int(up * 1000),
            int(north * 100),
            int(east * 100),
            int(-climb * 100),
            int(math.degrees(heading) % 360 * 100),
        )
        time.sleep(1 / RATE_HZ)


if __name__ == "__main__":
    main()
