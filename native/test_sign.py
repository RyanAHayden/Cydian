"""I6: the on-device signer (native/sign/), built for Linux with the Swift toolchain and run against throwaway signing
material from native/testkit.py. The Swift tests (native/sign/tests/main.swift) sign a fixture IPA and check
the signatures with openssl; this file makes the fixtures, runs them, and then checks the signed IPA once more with
its own Python reading (DER entitlements, CodeResources against the files). Without a Swift toolchain
(SWIFT_TOOLCHAIN, or swiftc on PATH) the tests skip and say so."""
import hashlib
import io
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)


def toolchain():
    tc = os.environ.get("SWIFT_TOOLCHAIN")
    if not tc and shutil.which("swiftc"):
        tc = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(shutil.which("swiftc")))))
    swiftc = os.path.join(tc, "usr/bin/swiftc") if tc else None
    return swiftc if swiftc and os.access(swiftc, os.X_OK) else None


def disk_tmpdir(prefix):
    """A scratch dir for a Swift build on the checkout's own disk (native/build/tmp, gitignored), not in /tmp. /tmp can
    be a size-capped tmpfs shared by every session on the machine, and swiftc -O's object files ran it out of quota
    ("Disk quota exceeded") when other gates ran beside this one. Pass swift_env(dir) to swiftc so its own
    temporaries (TMPDIR) go there too."""
    base = os.path.join(HERE, "build", "tmp")
    os.makedirs(base, exist_ok=True)
    return tempfile.mkdtemp(prefix=prefix, dir=base)


def swift_env(tmp, env=None):
    """env (default os.environ) with TMPDIR inside tmp, so swiftc's TemporaryDirectory.* stays off /tmp."""
    env = dict(os.environ if env is None else env)
    t = os.path.join(tmp, "tmpdir")
    os.makedirs(t, exist_ok=True)
    env["TMPDIR"] = t
    return env


SWIFTC = toolchain()
OPENSSL = shutil.which("openssl")
MISSING = ""
try:
    import testkit as T  # noqa: E402  (native/testkit.py; needs `cryptography`)
    from cryptography.hazmat.primitives import serialization
except ImportError as e:  # pragma: no cover
    T = None
    MISSING = f"{e} (pip install cryptography for {sys.executable})"

A = "Payload/Fixture.app/"


def macho(filetype=2, encrypted=False):
    b = bytearray(T.macho())
    struct.pack_into("<I", b, 12, filetype)
    if encrypted:  # LC_ENCRYPTION_INFO_64 with cryptid 1, in the room after the load commands
        ncmds, size = struct.unpack_from("<II", b, 16)
        struct.pack_into("<IIIIII", b, 32 + size, 0x2C, 24, 0x4000 - 64, 4, 1, 0)
        struct.pack_into("<II", b, 16, ncmds + 1, size + 24)
    return bytes(b)


def fat():
    thin = macho()
    arm7 = struct.pack("<IiiIIIII", 0xFEEDFACE, 12, 9, 2, 0, 0, 0, 0)
    head = struct.pack(">II", 0xCAFEBABE, 2)
    head += struct.pack(">IIIII", 12, 9, 0x4000, len(arm7), 14)
    head += struct.pack(">IIIII", 0x0100000C, 0, 0x8000, len(thin), 14)
    body = bytearray(0x8000 + len(thin))
    body[:len(head)] = head
    body[0x4000:0x4000 + len(arm7)] = arm7
    body[0x8000:] = thin
    return bytes(body)


def info(bundle_id, exe, name="Fixture", **extra):
    d = {"CFBundleExecutable": exe, "CFBundleIdentifier": bundle_id, "CFBundleName": name,
         "CFBundleShortVersionString": "1.0", "CFBundleVersion": "1", "CFBundlePackageType": "APPL"}
    d.update(extra)
    return plistlib.dumps(d, fmt=plistlib.FMT_BINARY)


def rich_ipa(main_binary=None):
    """An app with a framework, a loose dylib, a share extension, localisations, a symlink and leftovers of an old
    signature."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def put(name, data, mode=0o100644):
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 17, 0, 0, 0))
            zi.create_system = 3
            zi.external_attr = mode << 16
            zi.compress_type = zipfile.ZIP_STORED if name.endswith("/") else zipfile.ZIP_DEFLATED
            z.writestr(zi, data)
        put("Payload/", b"", 0o40755)
        put(A, b"", 0o40755)
        put(A + "Info.plist", info("dev.ifizbox.fixture", "Fixture", CFBundleDisplayName="Fixture",
                                   UISupportedDevices=["iPhone14,2"]))
        put(A + "Fixture", main_binary or macho(), 0o100755)
        put(A + "hello.txt", b"Hello from iFizBox's on-device signer test.\n")
        put(A + "link.txt", b"hello.txt", 0o120777)
        put(A + "en.lproj/Localizable.strings", b'"hi" = "hi";\n')
        put(A + "Base.lproj/Main.storyboardc", b"storyboard")
        put(A + "OldStuff/_CodeSignature/CodeResources", b"old seal")
        put(A + "_CodeSignature/CodeResources", b"old seal")
        put(A + "embedded.mobileprovision", b"old profile")
        put(A + "Frameworks/Kit.framework/Info.plist", info("dev.ifizbox.kit", "Kit", "Kit", CFBundlePackageType="FMWK"))
        put(A + "Frameworks/Kit.framework/Kit", macho(6), 0o100755)
        put(A + "Frameworks/libloose.dylib", macho(6), 0o100755)
        put(A + "PlugIns/Share.appex/Info.plist", info("dev.ifizbox.fixture.share", "Share", "Share",
                                                       CFBundlePackageType="XPC!"))
        put(A + "PlugIns/Share.appex/Share", macho(), 0o100755)
        put("iTunesMetadata.plist", plistlib.dumps({"itemName": "Fixture"}))
    return buf.getvalue()


def small_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return buf.getvalue()


def der_read(b, i=0):
    """(tag, body, next index) of one DER TLV."""
    tag, n = b[i], b[i + 1]
    i += 2
    if n & 0x80:
        k = n & 0x7F
        n = int.from_bytes(b[i:i + k], "big")
        i += k
    return tag, b[i:i + n], i + n


def der_entitlements(b):
    """Apple's DER entitlements back to Python values."""
    def value(tag, body):
        if tag == 0x01:
            return body != b"\0"
        if tag == 0x02:
            return int.from_bytes(body, "big", signed=True)
        if tag == 0x0C:
            return body.decode()
        if tag == 0x30:
            out, i = [], 0
            while i < len(body):
                t, v, i = der_read(body, i)
                out.append(value(t, v))
            return out
        if tag == 0xB0:
            out, i = {}, 0
            while i < len(body):
                _, pair, i = der_read(body, i)
                _, k, j = der_read(pair)
                t, v, _ = der_read(pair, j)
                out[k.decode()] = value(t, v)
            return out
        raise ValueError(hex(tag))
    tag, body, _ = der_read(b)
    assert tag == 0x70
    t, v, j = der_read(body)
    assert (t, v) == (0x02, b"\x01")
    t, v, _ = der_read(body, j)
    return value(t, v)


def slots(binary):
    magic, _, _, _, ncmds, _, _, _ = struct.unpack_from("<IiiIIIII", binary)
    assert magic == 0xFEEDFACF
    off = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack_from("<II", binary, off)
        if cmd == 0x1D:
            so, ss = struct.unpack_from("<II", binary, off + 8)
        off += size
    blob = binary[so:so + ss]
    assert struct.unpack_from(">I", blob)[0] == 0xFADE0CC0
    out = {}
    for i in range(struct.unpack_from(">I", blob, 8)[0]):
        typ, o = struct.unpack_from(">II", blob, 12 + 8 * i)
        out[typ] = blob[o:o + struct.unpack_from(">I", blob, o + 4)[0]]
    return out


@unittest.skipUnless(T, f"the signer's fixtures can't be made: {MISSING}")
@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/ not tested")
@unittest.skipUnless(OPENSSL, "openssl not on PATH: signatures can't be checked")
class OnDeviceSigner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disk_tmpdir("ifizbox-signtest-")
        cls.fx = os.path.join(cls.tmp, "fixtures")
        cls.work = os.path.join(cls.tmp, "work")
        os.makedirs(cls.fx)
        key, cert, ca = T.identity()
        other_key, other, _ = T.identity(name="Apple Development: Someone Else (ZZZZZ99999)")
        der = serialization.Encoding.DER

        def w(name, data):
            with open(os.path.join(cls.fx, name), "wb") as f:
                f.write(data)
        w("key.pem", key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                        serialization.NoEncryption()))
        w("cert.der", cert.public_bytes(der))
        w("ca.der", ca.public_bytes(der))
        w("ca.pem", ca.public_bytes(serialization.Encoding.PEM))
        w("other.der", other.public_bytes(der))
        cls.profile = T.profile(key, cert)
        w("profile.mobileprovision", cls.profile)
        w("profile-explicit.mobileprovision", T.profile(key, cert, app_id="com.me.fixture"))
        w("profile-prefix.mobileprovision", T.profile(key, cert, app_id="com.me.*"))
        w("profile-expired.mobileprovision", T.profile(key, cert, days=-1))
        w("rich.ipa", rich_ipa())
        w("unsigned.macho", macho())
        w("fat.macho", fat())
        w("notanipa.ipa", small_zip({"hello.txt": "hi"}))
        w("escape.ipa", small_zip({"Payload/X.app/Info.plist": info("a.b", "X"), "Payload/../evil": "x"}))
        # B21: nested bundles naming a missing executable (YouMod's YTUHD.bundle) are sealed, not signed; the app's
        # own missing executable is still refused.
        shutil.copy(os.path.join(ROOT, "web", "fixtures", "missing-exe.ipa"), os.path.join(cls.fx, "missing-exe.ipa"))
        w("noexe.ipa", small_zip({"Payload/X.app/Info.plist": info("a.b", "X"), "Payload/X.app/hello.txt": "hi"}))
        enc = io.BytesIO(rich_ipa(macho(encrypted=True)))
        w("encrypted.ipa", enc.getvalue())
        cls.binary = os.path.join(cls.tmp, "signtest")
        env = swift_env(cls.tmp)
        # The ubuntu toolchain wants libncurses.so.6; Arch has only the wide one (as native/build.sh does).
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        sign = os.path.join(HERE, "sign")
        sources = sorted(os.path.join(sign, f) for f in os.listdir(sign) if f.endswith(".swift"))
        r = subprocess.run([SWIFTC, "-O", "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            "-import-objc-header", os.path.join(sign, "zlib-shim.h"), *sources,
                            os.path.join(sign, "tests", "main.swift"), "-lz", "-o", cls.binary],
                           capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        env = swift_env(self.tmp)  # the signer's own scratch files (openssl, unzip) stay off /tmp too
        real =os.path.join(HERE, "build", "iFizBox.ipa")  # the sideload build, where tools/check.sh made one
        if os.path.exists(real):
            env["IFIZBOX_REAL_IPA"] = real
        r = subprocess.run([self.binary, self.fx, self.work], capture_output=True, text=True, timeout=600, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("all passed", r.stdout)
        # Then Python reads what Swift signed.
        with zipfile.ZipFile(os.path.join(self.work, "signed.ipa")) as z:
            self.assertIsNone(z.testzip())
            files = {n: z.read(n) for n in z.namelist() if not n.endswith("/")}
        self.assertEqual(files["iTunesMetadata.plist"], plistlib.dumps({"itemName": "Fixture"}))
        info_plist = plistlib.loads(files[A + "Info.plist"])
        self.assertNotIn("UISupportedDevices", info_plist)
        s = slots(files[A + "Fixture"])
        xml = plistlib.loads(s[5][8:])
        self.assertEqual(der_entitlements(s[7][8:]), xml)  # the DER slot says what the XML one says
        self.assertEqual(xml["com.apple.developer.team-identifier"], T.TEAM)
        self.assertIs(xml["get-task-allow"], False)
        cr = plistlib.loads(files[A + "_CodeSignature/CodeResources"])
        sealed = set(cr["files2"])
        expected = {n[len(A):] for n in files if n.startswith(A)} - {
            "_CodeSignature/CodeResources", "Fixture", "Info.plist"}
        self.assertEqual(sealed, expected)
        for rel, entry in cr["files2"].items():
            if "symlink" in entry:
                continue
            self.assertEqual(entry["hash2"], hashlib.sha256(files[A + rel]).digest(), rel)
            self.assertEqual(entry["hash"], hashlib.sha1(files[A + rel]).digest(), rel)
        self.assertEqual(files[A + "embedded.mobileprovision"], self.profile)

class BridgeSourceTest(unittest.TestCase):
    """F73: the phone half can't run here, so read the sources: signing.export is registered, answers the three
    fields from the kept Keychain item, and the item is written on import and deleted on remove."""

    @classmethod
    def setUpClass(cls):
        src = os.path.join(HERE, "Sources")
        with open(os.path.join(src, "SignBridge.swift")) as f:
            cls.bridge = f.read()
        with open(os.path.join(src, "SignStore.swift")) as f:
            cls.store = f.read()

    def test_export_handler(self):
        self.assertIn('b.on("signing.export")', self.bridge)
        start = self.bridge.index("static func export()")
        body = self.bridge[start:self.bridge.index("\n    }\n", start)]
        for key in ('"p12"', '"profile"', '"password"', "SignStore.exportP12()", "NSNull()"):
            self.assertIn(key, body)

    def test_kept_p12(self):
        self.assertIn("kSecClassGenericPassword", self.store)
        keep = self.store[self.store.index("static func keepP12"):]
        keep = keep[:keep.index("\n    }\n")]
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", keep)
        imp = self.store[self.store.index("static func importIdentity"):self.store.index("static func identity()")]
        self.assertIn("try keepP12(", imp)
        rm = self.store[self.store.index("static func removeIdentity"):]
        rm = rm[:rm.index("\n    }\n")]
        self.assertIn("deleteP12()", rm)


if __name__ == "__main__":
    unittest.main()
