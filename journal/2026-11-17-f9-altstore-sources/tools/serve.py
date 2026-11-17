"""Static server for web/app plus a fake /api/fetch: the fixture AltStore source at https://example.dev/apps.json
(after `touch bump` beside this file: Legacy bumped to 3.2), 404 for everything else.
Usage: python3 serve.py <repo root> <port>"""
import json, sys, os, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

root, port = sys.argv[1], int(sys.argv[2])
fixture = os.path.join(root, "web/app/core/fixtures/altstore-source.json")
here = os.path.dirname(os.path.abspath(__file__))

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(root, "web/app"), **k)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/fetch":
            return super().do_GET()
        url = urllib.parse.parse_qs(u.query).get("url", [""])[0]
        if url == "https://example.dev/apps.json":
            data = json.load(open(fixture))
            if os.path.exists(os.path.join(here, "bump")):
                data["apps"][1]["version"] = "3.2"
            return self.send(200, json.dumps(data).encode(), "application/json")
        self.send(404, json.dumps({"code": "not_found", "error": "not found"}).encode(), "application/json")
    def send(self, code, body, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
