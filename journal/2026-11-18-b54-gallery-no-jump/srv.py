# B54 check server: serves web/app and a harness; /shot/<n>.png?ms=D answers a phone-sized PNG after D ms,
# /dead/<n>.png a 404 after D ms.
import http.server, os, struct, sys, time, zlib
from urllib.parse import urlparse, parse_qs

ROOT, HARNESS, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])

def png(w, h, rgb):
    row = b"\x00" + bytes(rgb) * w
    raw = zlib.compress(row * h)
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")

COLORS = [(200, 60, 60), (60, 160, 80), (60, 90, 200), (200, 160, 40)]

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/fetch":  # the site's proxy, as the http backend's assetUrl asks it
            inner = urlparse(parse_qs(u.query)["url"][0])
            u = urlparse(inner.path + ("?" + inner.query if inner.query else ""))
        ms = int(parse_qs(u.query).get("ms", ["0"])[0])
        if u.path.startswith("/shot/") or u.path.startswith("/dead/"):
            time.sleep(ms / 1000)
            if u.path.startswith("/dead/"):
                self.send_error(404); return
            n = int(u.path.split("/")[-1].split(".")[0])
            body = png(390, 844, COLORS[n % 4])
            self.send_response(200); self.send_header("Content-Type", "image/png"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        if u.path == "/b54.html":
            body = open(HARNESS, "rb").read()
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        super().do_GET()

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
