# Proof for F160: read MinimumOSVersion and UIDeviceFamily from a remote IPA with HTTP Range requests (zip central
# directory, then only Payload/*.app/Info.plist). python3 tools/ipa-plist-probe.py <ipa url>...
import sys, struct, zlib, plistlib, urllib.request
def rng(url, a, b=None):
    h = {"Range": f"bytes={a}-{'' if b is None else b}", "User-Agent": "probe"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
        tot = int(r.headers["Content-Range"].split("/")[1]); return r.read(), tot
def info(url):
    got = 0
    tail, size = rng(url, -0) if False else rng(url, 0, 0); tail, _ = rng(url, max(0, size - 65536)); got += len(tail)
    e = tail.rfind(b"PK\x05\x06"); cd_size, cd_off = struct.unpack("<II", tail[e+12:e+20])
    if cd_off == 0xFFFFFFFF:  # zip64
        l = tail.rfind(b"PK\x06\x06"); cd_size, cd_off = struct.unpack("<QQ", tail[l+40:l+56])
    cd, _ = rng(url, cd_off, cd_off + cd_size - 1); got += len(cd); p = 0
    while p < len(cd) and cd[p:p+4] == b"PK\x01\x02":
        meth, = struct.unpack("<H", cd[p+10:p+12]); csz, usz = struct.unpack("<II", cd[p+20:p+28])
        nl, xl, cl = struct.unpack("<HHH", cd[p+28:p+34]); off, = struct.unpack("<I", cd[p+42:p+46])
        name = cd[p+46:p+46+nl].decode("utf8", "replace"); p += 46 + nl + xl + cl
        parts = name.split("/")
        if len(parts) == 3 and parts[0] == "Payload" and parts[1].endswith(".app") and parts[2] == "Info.plist":
            hdr, _ = rng(url, off, off + 29); got += 30; n2, x2 = struct.unpack("<HH", hdr[26:30])
            data, _ = rng(url, off + 30 + n2 + x2, off + 30 + n2 + x2 + csz - 1); got += len(data)
            raw = zlib.decompress(data, -15) if meth == 8 else data
            pl = plistlib.loads(raw)
            return pl.get("MinimumOSVersion"), pl.get("UIDeviceFamily"), size, got
for u in sys.argv[1:]:
    try: m, fam, size, got = info(u); print(f"min iOS {m}, family {fam}: read {got//1024} KB of {size//1048576} MB")
    except Exception as ex: print("failed:", ex)
