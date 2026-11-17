"""Static server for web/app plus a fake /api/fetch for F29's walk-through: the version fixtures as two flat APT
repos (https://a.example/, https://b.example/) and an AltStore source (https://alt.example/apps.json); 404 else.
Usage: python3 serve.py <repo root> <port>"""
import json, sys, os, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

root, port = sys.argv[1], int(sys.argv[2])
fx = os.path.join(root, "web/app/core/fixtures/versions")
FILES = {
    "https://a.example/": ("repo-a-Packages", "text/plain"),
    "https://b.example/": ("repo-b-Packages", "text/plain"),
    "https://alt.example/apps.json": ("altstore-history.json", "application/json"),
}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(root, "web/app"), **k)
    def log_message(self, *a):
        pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/fetch":
            return super().do_GET()
        q = urllib.parse.parse_qs(u.query)
        url = q.get("url", [""])[0]
        if url in FILES:
            name, ctype = FILES[url]
            return self.send(200, open(os.path.join(fx, name), "rb").read(), ctype)
        if url.endswith("Release") and url.rsplit("/", 1)[0] + "/" in FILES:
            label = "Repo A" if "a.example" in url else "Repo B"
            return self.send(200, f"Origin: {label}\nLabel: {label}\n".encode(), "text/plain")
        self.send(404, json.dumps({"code": "not_found", "error": "not found"}).encode(), "application/json")
    def send(self, code, body, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
