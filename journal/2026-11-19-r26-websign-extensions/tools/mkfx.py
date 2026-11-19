# R26: throwaway identity (.p12, password hunter2), an explicit profile (com.me.r26only) and a test IPA (the Tiny
# binary from the repo fixture, as com.ryha.ifizbox.r26test, with one widget extension). Usage: mkfx.py REPO OUTDIR
import io, os, plistlib, sys, zipfile
repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(repo, "native"))
import testkit as T

key, cert, ca = T.identity()
def w(n, d):
    with open(os.path.join(out, n), "wb") as f: f.write(d)
w("key.p12", T.p12(key, cert, ca))
w("profile.mobileprovision", T.profile(key, cert, app_id=os.environ.get("APPID", "com.me.r26only")))

src = zipfile.ZipFile(os.path.join(repo, "web/app/core/fixtures/signing/tiny-ifizbox.ipa"))
tiny = next(src.read(n) for n in src.namelist() if n.endswith("Tiny.app/Tiny"))
ID = "com.ryha.ifizbox.r26test"
def info(bid, extra=None):
    d = {"CFBundleIdentifier": bid, "CFBundleExecutable": "Tiny", "CFBundleName": "Tiny", "CFBundleDisplayName": "R26 Test",
         "CFBundleShortVersionString": "1", "CFBundleVersion": "1", "MinimumOSVersion": "14.0", "CFBundlePackageType": "APPL",
         "CFBundleSupportedPlatforms": ["iPhoneOS"]}
    d.update(extra or {})
    return plistlib.dumps(d, fmt=plistlib.FMT_XML)
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    def put(name, data, mode=0o100644):
        zi = zipfile.ZipInfo(name); zi.external_attr = mode << 16; zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, data)
    put("Payload/Tiny.app/Info.plist", info(ID))
    put("Payload/Tiny.app/Tiny", tiny, 0o100755)
    put("Payload/Tiny.app/PlugIns/Ext.appex/Info.plist", info(ID + ".ext", {"CFBundlePackageType": "XPC!",
        "NSExtension": {"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"}}))
    put("Payload/Tiny.app/PlugIns/Ext.appex/Tiny", tiny, 0o100755)
w("test.ipa", buf.getvalue())
print("ok")
