"""SPA-aware HTTP server for the React frontend."""
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

WEB_DIR = os.environ.get("WEB_DIR", "/var/www/html")


class SPAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        # Serve static files if they exist, otherwise fall back to index.html
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html")):
            self.path = "/index.html"
        super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("HTTP_PORT", "8888"))
    server = HTTPServer(("0.0.0.0", port), SPAHandler)
    print(f"SPA server on http://0.0.0.0:{port} (root: {WEB_DIR})")
    server.serve_forever()
