"""Read-only paired lockdownd probe: StartSession with a pairing record, then GetValue a few keys.

Usage: python3 -I lockdown_session.py <host> <pairing-record.plist>
Writes nothing to the device. Prints only non-secret values.
"""
import os
import plistlib
import socket
import ssl
import struct
import sys
import tempfile

host, rec_path = sys.argv[1], sys.argv[2]
rec = plistlib.load(open(rec_path, "rb"))


def send(s, obj):
    body = plistlib.dumps(obj)
    s.sendall(struct.pack(">I", len(body)) + body)


def recv(s):
    hdr = b""
    while len(hdr) < 4:
        c = s.recv(4 - len(hdr))
        if not c:
            raise EOFError("closed")
        hdr += c
    n = struct.unpack(">I", hdr)[0]
    data = b""
    while len(data) < n:
        c = s.recv(n - len(data))
        if not c:
            raise EOFError("closed mid-reply")
        data += c
    return plistlib.loads(data)


s = socket.create_connection((host, 62078), timeout=10)
send(s, {"Label": "probe", "Request": "QueryType"})
print("QueryType:", recv(s).get("Type"))
send(s, {"Label": "probe", "Request": "StartSession", "HostID": rec["HostID"],
         "SystemBUID": rec["SystemBUID"]})
r = recv(s)
print("StartSession:", {k: v for k, v in r.items() if k != "SessionID"})
if "Error" in r:
    sys.exit(2)
if r.get("EnableSessionSSL"):
    d = tempfile.mkdtemp()
    cert = os.path.join(d, "c.pem")
    key = os.path.join(d, "k.pem")
    open(cert, "wb").write(rec["HostCertificate"])
    open(key, "wb").write(rec["HostPrivateKey"])
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.set_ciphers("ALL:@SECLEVEL=0")
    ctx.load_cert_chain(cert, key)
    s = ctx.wrap_socket(s)
    os.remove(cert)
    os.remove(key)
    os.rmdir(d)
for domain, key in [(None, "ProductType"), (None, "ProductVersion"), (None, "BuildVersion"),
                    (None, "UniqueDeviceID"), ("com.apple.mobile.wireless_lockdown", "EnableWifiConnections"),
                    ("com.apple.security.mac.amfi", "DeveloperModeStatus")]:
    q = {"Label": "probe", "Request": "GetValue", "Key": key}
    if domain:
        q["Domain"] = domain
    send(s, q)
    a = recv(s)
    print(f"{domain or '-'} {key}:", a.get("Value", a.get("Error")))
send(s, {"Label": "probe", "Request": "StopSession", "SessionID": r.get("SessionID")})
