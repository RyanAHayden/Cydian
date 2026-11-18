"""Static server for web/app plus a fake /api/fetch for F37's screenshots: the F9 fixture AltStore source at
https://example.dev/apps.json and a small flat APT repo at https://repo.example/ (Release + Packages with tweaks and
themes for both architectures); 404 for everything else. Usage: python3 serve.py <repo root> <port>"""
import json, sys, os, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

root, port = sys.argv[1], int(sys.argv[2])
fixture = os.path.join(root, "web/app/core/fixtures/altstore-source.json")
RELEASE = "Origin: Example Repo\nLabel: Example Repo\nSuite: stable\nVersion: 1.0\nCodename: ios\nArchitectures: iphoneos-arm64 iphoneos-arm\nComponents: main\nDescription: F37 test repo\n"
def pkg(id, name, arch, section, desc):
    return f"Package: {id}\nName: {name}\nVersion: 1.0\nArchitecture: {arch}\nSection: {section}\nAuthor: Example Dev <dev@example.dev>\nDescription: {desc}\nFilename: debs/{id}.deb\n"
PACKAGES = "\n".join([
    pkg("com.example.springtweak", "Spring Tweak", "iphoneos-arm64", "Tweaks", "an example app tweak for SpringBoard"),
    pkg("com.example.darktheme", "Dark Example Theme", "iphoneos-arm64", "Themes", "an example theme"),
    pkg("com.example.oldtweak", "Old Example Tweak", "iphoneos-arm", "Tweaks", "an example tweak for rootful"),
    pkg("com.example.exampleutil", "Example Util", "all", "Utilities", "an example command line util"),
])

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(root, "web/app"), **k)
    def log_message(self, *a): pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/fetch":
            return super().do_GET()
        qs = urllib.parse.parse_qs(u.query)
        url = qs.get("url", [""])[0]
        if url == "https://example.dev/apps.json":
            return self.send(200, open(fixture, "rb").read(), "application/json")
        if url.startswith("https://repo.example/"):
            if qs.get("kind", [""])[0] == "packages":
                return self.send(200, PACKAGES.encode(), "text/plain")
            if url.endswith("/Release"):
                return self.send(200, RELEASE.encode(), "text/plain")
        self.send(404, json.dumps({"code": "not_found", "error": "not found"}).encode(), "application/json")
    def send(self, code, body, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
