"""SPA-aware HTTP server with API endpoints for SITL control."""
import json
import os
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/html")


class SITLHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        # Serve static files if they exist, otherwise fall back to index.html
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html")):
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/reset":
            self._handle_reset()
            return
        self._send_json(404, {"error": "not found"})

    def _handle_reset(self):
        """Kill ArduCopter process to trigger restart via the startup script loop."""
        try:
            result = subprocess.run(
                ["pkill", "-x", "arducopter"],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                self._send_json(200, {"status": "resetting"})
            else:
                self._send_json(503, {"error": "no ArduCopter process running"})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(os.environ.get("HTTP_PORT", "8888"))
    server = HTTPServer(("0.0.0.0", port), SITLHandler)
    print(f"SPA server on http://0.0.0.0:{port} (root: {WEB_DIR})")
    server.serve_forever()
