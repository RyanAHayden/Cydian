#!/usr/bin/env python3
"""R30: one GrandSlam (gsa.apple.com) SRP `init` with anisette headers from a public anisette server and a made-up
Apple ID on a reserved domain, to see which headers Apple wants and what it answers. No real account, no password:
the reply can only be "no such account" (or a refusal of the request's shape).

Usage: python3 -I gsa_init_probe.py ANISETTE_URL CAFILE [EMAIL] [--no-anisette]
CAFILE must hold Apple Root CA (gsa.apple.com chains to it; Cloudflare's cfssl_trust ca-bundle.crt does).
"""
import json, os, plistlib, secrets, ssl, sys, urllib.request

# RFC 5054 2048-bit group, the one GSA's SRP uses
N = int("AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D"
        "CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF"
        "747359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D5"
        "7D5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DB"
        "FBB694B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73", 16)
G = 2


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ani_url, cafile = args[0], args[1]
    email = args[2] if len(args) > 2 else "r30-probe-%s@example.invalid" % secrets.token_hex(4)
    ctx = ssl.create_default_context(cafile=cafile)
    ani = json.load(urllib.request.urlopen(ani_url.rstrip("/") + "/", timeout=15))
    a = secrets.randbits(256)
    A = pow(G, a, N).to_bytes(256, "big")
    cpd = {"bootstrap": True, "icscrec": True, "pbe": False, "prkgen": True, "svct": "iCloud",
           "loc": "en_US", "X-Apple-Locale": "en_US", "X-Apple-I-TimeZone": "UTC"}
    if "--no-anisette" not in sys.argv:
        for k in ("X-Apple-I-Client-Time", "X-Apple-I-MD", "X-Apple-I-MD-M", "X-Apple-I-MD-RINFO", "X-Apple-I-MD-LU",
                  "X-Apple-I-SRL-NO", "X-Mme-Device-Id"):
            if k in ani:
                cpd[k] = ani[k]
    body = plistlib.dumps({"Header": {"Version": "1.0.1"},
                           "Request": {"A2k": A, "cpd": cpd, "o": "init", "ps": ["s2k", "s2k_fo"], "u": email}})
    req = urllib.request.Request("https://gsa.apple.com/grandslam/GsService2", data=body, method="POST", headers={
        "Content-Type": "text/x-xml-plist", "Accept": "*/*", "User-Agent": "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0",
        "X-MMe-Client-Info": ani.get("X-MMe-Client-Info", "<MacBookPro13,2> <macOS;13.1;22C65> <com.apple.AuthKit/1 (com.apple.akd/1.0)>")})
    try:
        r = urllib.request.urlopen(req, context=ctx, timeout=20)
        code, hdrs, data = r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        code, hdrs, data = e.code, e.headers, e.read()
    print("email", email)
    print("http", code, "| access-control-allow-origin:", hdrs.get("Access-Control-Allow-Origin"))
    try:
        resp = plistlib.loads(data)
        st = resp.get("Response", {}).get("Status", {})
        print("status", json.dumps(st))
        print("keys", sorted(resp.get("Response", {}).keys()))
    except Exception:
        print("body", data[:300])


main()
