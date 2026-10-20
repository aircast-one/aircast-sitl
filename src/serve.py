import json
import os
import re
import subprocess
import time
import urllib.request
from contextlib import closing
from difflib import get_close_matches
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from pymavlink import mavutil

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/html")
VEHICLE_FILE = os.environ.get("VEHICLE_FILE", "/var/lib/aircast/vehicle")
HOME_FILE = os.environ.get("HOME_FILE", "/var/lib/aircast/home")
PARAMS_FILE = os.environ.get("PARAMS_FILE", "/var/lib/aircast/params.parm")
CAR_FILE = os.environ.get("CAR_FILE", "/var/lib/aircast/car")
CAR_SPEED_MS = 8.0
CAR_MAX_SPEED_MS = 20
PARAM_NAME = re.compile(r"[A-Z][A-Z0-9_]{0,15}")
FLOAT32_MAX = 3.4028235e38
VEHICLES = ("copter", "plane", "quadplane")
DEFAULT_HOME = {"lat": -35.363261, "lng": 149.165230, "alt": 584.0, "heading": 353.0}
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lng}"
ELEVATION_TIMEOUT_S = 5
SITL_PROCESS = "ardu(copter|plane)"
RESTART_TIMEOUT_S = 15
MAVLINK_URL = os.environ.get("MAVLINK_URL", "tcp:127.0.0.1:5760")
CHECK_TIMEOUT_S = 5
READ_TIMEOUT_S = 2
LIST_TIMEOUT_S = 15
READY_TIMEOUT_S = 30
PARAM_RETRY_S = 0.5
PARAM_LIST_QUIET_S = 1
READY_PARAM = "FORMAT_VERSION"


def current_vehicle():
    try:
        with open(VEHICLE_FILE) as f:
            vehicle = f.read().strip()
    except OSError:
        return VEHICLES[0]
    return vehicle if vehicle in VEHICLES else VEHICLES[0]


def current_car_speed():
    try:
        with open(CAR_FILE) as f:
            return float(f.read())
    except (OSError, ValueError):
        return CAR_SPEED_MS


def current_home():
    try:
        with open(HOME_FILE) as f:
            values = [float(v) for v in f.read().split(",")]
    except (OSError, ValueError):
        return DEFAULT_HOME
    return dict(zip(DEFAULT_HOME, values)) if len(values) == len(DEFAULT_HOME) else DEFAULT_HOME


def current_params():
    try:
        with open(PARAMS_FILE) as f:
            lines = f.read().splitlines()
    except OSError:
        return {}
    return {name: float(value) for name, value in (line.split() for line in lines if line.strip())}


def valid_params(params):
    return isinstance(params, dict) and all(
        PARAM_NAME.fullmatch(name) and type(value) in (int, float) and -FLOAT32_MAX <= value <= FLOAT32_MAX
        for name, value in params.items()
    )


def autopilot_target(conn, deadline):
    while time.monotonic() < deadline:
        msg = conn.recv_match(type="HEARTBEAT", blocking=True, timeout=max(0, deadline - time.monotonic()))
        if msg and msg.autopilot != mavutil.mavlink.MAV_AUTOPILOT_INVALID:
            return msg.get_srcSystem(), msg.get_srcComponent()
    return None


def open_autopilot(deadline):
    while time.monotonic() < deadline:
        try:
            conn = mavutil.mavlink_connection(MAVLINK_URL, retries=0)
        except OSError:
            time.sleep(PARAM_RETRY_S)
            continue
        target = autopilot_target(conn, deadline)
        if target:
            return conn, target
        conn.close()
    return None, None


def read_params(conn, target, names, deadline):
    found = {}
    while names - found.keys() and time.monotonic() < deadline:
        for name in names - found.keys():
            conn.mav.param_request_read_send(*target, name.encode(), -1)
        retry_at = min(deadline, time.monotonic() + PARAM_RETRY_S)
        while time.monotonic() < retry_at:
            msg = conn.recv_match(type="PARAM_VALUE", blocking=True, timeout=max(0, retry_at - time.monotonic()))
            if msg and msg.get_srcSystem() == target[0] and msg.param_id in names:
                found[msg.param_id] = msg.param_value
    return found


def listed_params(conn, target, deadline):
    conn.mav.param_request_list_send(*target)
    names = set()
    while time.monotonic() < deadline:
        msg = conn.recv_match(type="PARAM_VALUE", blocking=True, timeout=PARAM_LIST_QUIET_S)
        if not msg:
            break
        names.add(msg.param_id)
    return names


def unknown_params(names):
    deadline = time.monotonic() + CHECK_TIMEOUT_S
    conn, target = open_autopilot(deadline)
    if not conn:
        return {}
    with closing(conn):
        unknown = sorted(names - read_params(conn, target, names, time.monotonic() + READ_TIMEOUT_S).keys())
        listed = listed_params(conn, target, time.monotonic() + LIST_TIMEOUT_S) if unknown else set()
    return {name: next(iter(get_close_matches(name, listed, n=1)), None) for name in unknown}


def unknown_message(unknown):
    names = ", ".join(f"{name} (did you mean {match}?)" if match else name for name, match in unknown.items())
    vehicle = current_vehicle()
    return f"{names} is not a {vehicle} parameter" if len(unknown) == 1 else f"{names} are not {vehicle} parameters"


def autopilot_answers(deadline):
    conn, target = open_autopilot(deadline)
    if not conn:
        return False
    with closing(conn):
        return bool(read_params(conn, target, {READY_PARAM}, deadline))


def ground_elevation(lat, lng):
    with urllib.request.urlopen(ELEVATION_URL.format(lat=lat, lng=lng), timeout=ELEVATION_TIMEOUT_S) as res:
        return float(json.load(res)["elevation"][0])


def coordinate(value, limit):
    return value if type(value) in (int, float) and -limit <= value <= limit else None


def sitl_pids():
    return set(subprocess.run(["pgrep", "-x", SITL_PROCESS], capture_output=True, text=True).stdout.split())


def restart_sitl():
    before = sitl_pids()
    if not before:
        return False
    subprocess.run(["pkill", "-KILL", "-x", SITL_PROCESS], capture_output=True)
    deadline = time.monotonic() + RESTART_TIMEOUT_S
    while time.monotonic() < deadline:
        if sitl_pids() - before:
            return autopilot_answers(time.monotonic() + READY_TIMEOUT_S)
        time.sleep(0.2)
    return False


class SITLHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        if self.path == "/api/vehicle":
            self._send_json(200, {"vehicle": current_vehicle(), "vehicles": list(VEHICLES)})
            return
        if self.path == "/api/home":
            self._send_json(200, current_home())
            return
        if self.path == "/api/params":
            self._send_json(200, {"params": current_params()})
            return
        if self.path == "/api/car":
            self._send_json(200, {"speed": current_car_speed(), "max": CAR_MAX_SPEED_MS})
            return
        path = self.translate_path(self.path)
        if not os.path.exists(path) or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html"))):
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/reset":
            self._handle_reset()
            return
        if self.path == "/api/vehicle":
            self._handle_vehicle()
            return
        if self.path == "/api/home":
            self._handle_home()
            return
        if self.path == "/api/params":
            self._handle_params()
            return
        if self.path == "/api/car":
            self._handle_car()
            return
        self._send_json(404, {"error": "not found"})

    def _handle_car(self):
        speed = self._read_json().get("speed")
        if type(speed) not in (int, float) or not 0 <= speed <= CAR_MAX_SPEED_MS:
            self._send_json(400, {"error": f"speed must be from 0 to {CAR_MAX_SPEED_MS} m/s"})
            return
        os.makedirs(os.path.dirname(CAR_FILE), exist_ok=True)
        with open(CAR_FILE, "w") as f:
            f.write(str(speed))
        self._send_json(200, {"speed": speed, "max": CAR_MAX_SPEED_MS})

    def _handle_reset(self):
        if restart_sitl():
            self._send_json(200, {"status": "resetting"})
        else:
            self._send_json(503, {"error": "no SITL process running"})

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    def _handle_home(self):
        body = self._read_json()
        lat, lng = coordinate(body.get("lat"), 90), coordinate(body.get("lng"), 180)
        if lat is None or lng is None:
            self._send_json(400, {"error": "lat must be within ±90 and lng within ±180"})
            return
        try:
            alt = ground_elevation(lat, lng)
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            self._send_json(502, {"error": "could not look up the ground elevation there"})
            return
        home = {"lat": lat, "lng": lng, "alt": alt, "heading": 0.0}
        os.makedirs(os.path.dirname(HOME_FILE), exist_ok=True)
        with open(HOME_FILE, "w") as f:
            f.write(",".join(str(v) for v in home.values()))
        if restart_sitl():
            self._send_json(200, home)
        else:
            self._send_json(503, {"error": "the SITL did not come back up"})

    def _handle_params(self):
        params = self._read_json().get("params")
        if not valid_params(params):
            self._send_json(400, {"error": "params must map ArduPilot parameter names (A-Z, 0-9 and _, up to 16) to numbers"})
            return
        unknown = unknown_params(set(params)) if params else {}
        if unknown:
            self._send_json(400, {"error": unknown_message(unknown), "unknown": unknown})
            return
        os.makedirs(os.path.dirname(PARAMS_FILE), exist_ok=True)
        with open(PARAMS_FILE, "w") as f:
            f.write("".join(f"{name} {value}\n" for name, value in params.items()))
        if restart_sitl():
            self._send_json(200, {"params": current_params()})
        else:
            self._send_json(503, {"error": "the SITL did not come back up"})

    def _handle_vehicle(self):
        vehicle = self._read_json().get("vehicle")
        if vehicle not in VEHICLES:
            self._send_json(400, {"error": f"vehicle must be one of {', '.join(VEHICLES)}"})
            return
        os.makedirs(os.path.dirname(VEHICLE_FILE), exist_ok=True)
        with open(VEHICLE_FILE, "w") as f:
            f.write(vehicle)
        if restart_sitl():
            self._send_json(200, {"vehicle": vehicle})
        else:
            self._send_json(503, {"error": "the SITL did not come back up"})

    def end_headers(self):
        immutable = self.path.startswith("/assets/")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if immutable else "no-cache")
        super().end_headers()

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(os.environ.get("HTTP_PORT", "8888"))
    server = ThreadingHTTPServer(("0.0.0.0", port), SITLHandler)
    print(f"SPA server on http://0.0.0.0:{port} (root: {WEB_DIR})")
    server.serve_forever()
