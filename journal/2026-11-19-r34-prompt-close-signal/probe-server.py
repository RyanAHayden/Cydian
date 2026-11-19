import http.server, sys, os, json
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe")
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe.log")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n)
        with open(LOG, "a") as f:
            for e in json.loads(body or b"[]"):
                f.write(json.dumps(e) + "\n")
        self.send_response(204); self.end_headers()
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
