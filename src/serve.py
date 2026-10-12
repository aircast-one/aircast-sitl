import json
import os
import subprocess
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/html")
VEHICLE_FILE = os.environ.get("VEHICLE_FILE", "/var/lib/aircast/vehicle")
VEHICLES = ("copter", "plane", "quadplane")
SITL_PROCESS = "ardu(copter|plane)"
RESTART_TIMEOUT_S = 15


def current_vehicle():
    try:
        with open(VEHICLE_FILE) as f:
            vehicle = f.read().strip()
    except OSError:
        return VEHICLES[0]
    return vehicle if vehicle in VEHICLES else VEHICLES[0]


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
        self._send_json(404, {"error": "not found"})

    def _handle_reset(self):
        if restart_sitl():
            self._send_json(200, {"status": "resetting"})
        else:
            self._send_json(503, {"error": "no SITL process running"})

    def _handle_vehicle(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            vehicle = json.loads(self.rfile.read(length) or b"{}").get("vehicle")
        except (ValueError, AttributeError):
            vehicle = None
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
