# Static web/app plus a fake /api/fetch answering every repo with testrepo's files (render check only).
import http.server, sys, os, urllib.parse
APP, REPO = sys.argv[1], sys.argv[2]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=APP, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/fetch": return super().do_GET()
        q = urllib.parse.parse_qs(u.query)
        url = q.get("url", [""])[0]; kind = q.get("kind", [""])[0]
        name = "Packages" if kind == "packages" else url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        f = {"Release": "apt/Release", "Packages": "apt/Packages"}.get(name)
        if f is None and url.endswith(".json"): f = "altstore.json"
        if f is None:
            self.send_response(404); self.send_header("content-type", "application/json"); self.end_headers()
            self.wfile.write(b'{"code":"not_found","error":"nope"}'); return
        data = open(os.path.join(REPO, f), "rb").read()
        self.send_response(200); self.send_header("content-type", "text/plain"); self.send_header("content-length", str(len(data))); self.end_headers()
        self.wfile.write(data)
http.server.ThreadingHTTPServer(("127.0.0.1", 8767), H).serve_forever()
