import json
import os
import re
import subprocess
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/html")
VEHICLE_FILE = os.environ.get("VEHICLE_FILE", "/var/lib/aircast/vehicle")
HOME_FILE = os.environ.get("HOME_FILE", "/var/lib/aircast/home")
PARAMS_FILE = os.environ.get("PARAMS_FILE", "/var/lib/aircast/params.parm")
PARAM_NAME = re.compile(r"[A-Z][A-Z0-9_]{0,15}")
FLOAT32_MAX = 3.4028235e38
VEHICLES = ("copter", "plane", "quadplane")
DEFAULT_HOME = {"lat": -35.363261, "lng": 149.165230, "alt": 584.0, "heading": 353.0}
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lng}"
ELEVATION_TIMEOUT_S = 5
SITL_PROCESS = "ardu(copter|plane)"
RESTART_TIMEOUT_S = 15


def current_vehicle():
    try:
        with open(VEHICLE_FILE) as f:
            vehicle = f.read().strip()
    except OSError:
        return VEHICLES[0]
    return vehicle if vehicle in VEHICLES else VEHICLES[0]


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
            return True
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
        self._send_json(404, {"error": "not found"})

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
