# R26: for every Mach-O in a signed IPA, print the Info.plist ID beside it, the code signature's identifier, team,
# the entitlements blob's application-identifier and keychain groups, and whether a CMS blob is there; plus which
# bundles carry embedded.mobileprovision and what each CodeResources seals. Usage: inspect.py IPA
import plistlib, struct, sys, zipfile

z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()

def slices(b):
    magic = struct.unpack(">I", b[:4])[0]
    if magic in (0xCAFEBABE,):
        n = struct.unpack(">I", b[4:8])[0]
        for i in range(n):
            _, _, off, size, _ = struct.unpack(">iiIII", b[8 + 20 * i:28 + 20 * i])
            yield b[off:off + size]
    else:
        yield b

def sig(m):
    assert struct.unpack("<I", m[:4])[0] == 0xFEEDFACF, "not a 64-bit Mach-O"
    ncmds = struct.unpack("<I", m[16:20])[0]
    p = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack("<II", m[p:p + 8])
        if cmd == 0x1D:  # LC_CODE_SIGNATURE
            off, ln = struct.unpack("<II", m[p + 8:p + 16])
            return m[off:off + ln]
        p += size
    return None

def blobs(sb):
    magic, ln, count = struct.unpack(">III", sb[:12])
    assert magic == 0xFADE0CC0
    for i in range(count):
        typ, off = struct.unpack(">II", sb[12 + 8 * i:20 + 8 * i])
        bm, bl = struct.unpack(">II", sb[off:off + 8])
        yield typ, bm, sb[off:off + bl]

for n in names:
    if not n.endswith("/Tiny"):
        continue
    bundle = n.rsplit("/", 1)[0]
    info = plistlib.loads(z.read(bundle + "/Info.plist"))
    for m in slices(z.read(n)):
        out = {"file": n, "Info.plist ID": info["CFBundleIdentifier"]}
        for typ, bm, b in blobs(sig(m)):
            if bm == 0xFADE0C02 and typ == 0:  # the CodeDirectory
                ident_off, = struct.unpack(">I", b[20:24])
                out["code identifier"] = b[ident_off:b.index(b"\0", ident_off)].decode()
                ver, = struct.unpack(">I", b[8:12])
                if ver >= 0x20200:
                    team_off, = struct.unpack(">I", b[48:52])
                    if team_off: out["team"] = b[team_off:b.index(b"\0", team_off)].decode()
            elif bm == 0xFADE7171:
                e = plistlib.loads(b[8:])
                out["application-identifier"] = e.get("application-identifier")
                out["keychain-access-groups"] = e.get("keychain-access-groups")
                out["get-task-allow"] = e.get("get-task-allow")
            elif bm == 0xFADE7172:
                out["DER entitlements"] = len(b)
            elif bm == 0xFADE0B01:
                out["CMS bytes"] = len(b)
        for k, v in out.items(): print(f"  {k}: {v}")
        print()

for n in names:
    if n.endswith(("embedded.mobileprovision",)): print("profile:", n)
for n in names:
    if n.endswith("_CodeSignature/CodeResources"):
        cr = plistlib.loads(z.read(n))
        print(n, "seals:", sorted(cr.get("files2", {})))
