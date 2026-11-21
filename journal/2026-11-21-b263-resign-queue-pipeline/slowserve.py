#!/usr/bin/env python3
# Serves a directory on 127.0.0.1:PORT; files over 10 MB go out at about RATE MB/s, and every request is logged with
# its start and end time (the B263 order of events from the server's side).
import http.server, os, sys, time, functools

root, port, rate = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])

class H(http.server.SimpleHTTPRequestHandler):
    def copyfile(self, src, dst):
        try:
            size = os.fstat(src.fileno()).st_size
        except Exception:
            size = 0
        start = time.time()
        sys.stderr.write(f"{time.strftime('%H:%M:%S')} start {self.path} {size}\n"); sys.stderr.flush()
        if size <= 10 << 20:
            super().copyfile(src, dst)
        else:
            chunk = 256 << 10
            sent = 0
            while True:
                b = src.read(chunk)
                if not b:
                    break
                dst.write(b)
                sent += len(b)
                wait = start + sent / (rate * (1 << 20)) - time.time()
                if wait > 0:
                    time.sleep(wait)
        sys.stderr.write(f"{time.strftime('%H:%M:%S')} end {self.path} {time.time() - start:.1f}s\n"); sys.stderr.flush()

http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=root)).serve_forever()
