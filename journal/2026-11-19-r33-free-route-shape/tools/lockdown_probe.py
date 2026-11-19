"""Read-only lockdownd probe: connect to host:62078, send QueryType, print the reply.

No pairing, no session, no writes. Usage: python3 -I lockdown_probe.py <host> [port]
"""
import plistlib
import socket
import struct
import sys
import time

host = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 62078
t0 = time.time()
try:
    s = socket.create_connection((host, port), timeout=8)
except OSError as e:
    print(f"connect {host}:{port} failed after {time.time()-t0:.1f}s: {e!r}")
    sys.exit(1)
print(f"connected {host}:{port} in {time.time()-t0:.2f}s")
body = plistlib.dumps({"Label": "probe", "Request": "QueryType"})
s.sendall(struct.pack(">I", len(body)) + body)
s.settimeout(8)
try:
    hdr = s.recv(4)
    if len(hdr) < 4:
        print("closed without a reply", hdr)
        sys.exit(2)
    n = struct.unpack(">I", hdr)[0]
    data = b""
    while len(data) < n:
        chunk = s.recv(n - len(data))
        if not chunk:
            break
        data += chunk
    print(plistlib.loads(data))
except OSError as e:
    print(f"no reply: {e!r}")
    sys.exit(3)
