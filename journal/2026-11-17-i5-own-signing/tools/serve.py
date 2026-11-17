"""I5 walk-through server: web/app plus the real signer blueprint (web/signer/), a fake /api/fetch serving one
AltStore source (https://alt.example/apps.json, one app whose IPA is http://ipa.example/Fixture.ipa), and that IPA
(signer/testkit.ipa) behind a fetcher that maps *.example to a public-looking IP and dials it locally, so the SSRF
guard runs unchanged. Writes the throwaway .p12 (password hunter2) and profile to <out>/ for the page to load.
Usage: CYDIAN_ZSIGN=<zsign> .venv/bin/python serve.py <repo root> <port> <out dir>"""
import json, os, socket, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root, port, out = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(root / "web"))
from flask import Flask, Response, request, send_from_directory  # noqa: E402
import fetch, signer  # noqa: E402
from signer import testkit as T  # noqa: E402

key, cert, ca = T.identity()
out.mkdir(parents=True, exist_ok=True)
(out / "test.p12").write_bytes(T.p12(key, cert, ca))
(out / "test.mobileprovision").write_bytes(T.profile(key, cert, devices=2, name="Walkthrough Profile"))
IPA = T.ipa(bundle_id="dev.example.fixture", name="Fixture", version="1.2")

class IpaHost(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header("Content-Length", str(len(IPA))); self.end_headers(); self.wfile.write(IPA)
    def log_message(self, *a): pass
ipa_srv = ThreadingHTTPServer(("127.0.0.1", 0), IpaHost)
threading.Thread(target=ipa_srv.serve_forever, daemon=True).start()

def resolve(host, port):
    return ["93.184.216.34"] if host.endswith(".example") else fetch.default_resolve(host, port)
def dial(ip, port, timeout):
    if ip == "93.184.216.34":
        return socket.create_connection(("127.0.0.1", ipa_srv.server_address[1]), timeout=timeout)
    raise OSError("walk-through dials nothing else")

SOURCE = {"name": "Walkthrough Apps", "identifier": "dev.example.walk", "apps": [{
    "name": "Fixture", "bundleIdentifier": "dev.example.fixture", "developerName": "Cydian Tests",
    "localizedDescription": "A tiny app for the signer walk-through.", "category": "utilities",
    "versions": [{"version": "1.2", "date": "2026-11-17", "downloadURL": "http://ipa.example/Fixture.ipa", "size": len(IPA)}]}]}

app = Flask(__name__, static_folder=None)
app.register_blueprint(signer.create_blueprint(fetch.Fetcher(resolve=resolve, dial=dial, timeout=10)))
log = []

@app.after_request
def note(r):
    if request.path.startswith("/sign"):
        print(request.method, request.path, r.status_code, (r.get_data(as_text=True)[:400] if r.mimetype == "application/json" else r.mimetype), flush=True)
    return r

@app.get("/api/fetch")
def api_fetch():
    if request.args.get("url") == "https://alt.example/apps.json":
        return Response(json.dumps(SOURCE), 200, {"Content-Type": "application/json"})
    return Response(json.dumps({"code": "not_found", "error": "not found"}), 404, {"Content-Type": "application/json"})

@app.get("/fx/<name>")
def fx(name):
    return send_from_directory(out, name)

@app.get("/")
def index():
    return send_from_directory(root / "web/app", "index.html")

@app.get("/<path:p>")
def static_file(p):
    r = send_from_directory(root / "web/app", p)
    if p.endswith(".js"): r.mimetype = "text/javascript"
    return r

app.run("127.0.0.1", port, threaded=True)
