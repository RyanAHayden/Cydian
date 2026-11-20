"""N9: the share sheet and Open in iFizBox.

- SwiftShare: native/share/tests/main.swift, built on Linux with Share.swift, ../intents/Core.swift,
  ../sign/Updates.swift and ../sign/Hash.swift (F133's SHA256), classifies shared links, text and files (repo, AltStore source, ipa, deb, unknown) and runs
  each mode's route against the fake helper (native/fake/ifizbox-helper, simulate-deb / install-deb / install-ipa)
  and a fake signer. Skips, and says so, without a Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH).
- Declared: the document types and UTTypes (.ipa, .deb) in both Info.plists, the ifizbox:// scheme in the jailbreak
  build too, the share extension's Info.plist and its activation rule.
- Built: when native/build.sh has built the .deb and the IPA, both carry PlugIns/iFizBoxShare.appex.
- Wiring: the text that ties it together (the shell's Incoming, the bridge, the page)."""
import os
import plistlib
import shutil
import subprocess
import sys
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(HERE)
REPO = os.path.dirname(NATIVE)
sys.path.insert(0, NATIVE)

from test_sign import toolchain  # noqa: E402
import brand  # noqa: E402
import disktmp  # noqa: E402

SWIFTC = toolchain()
INFO_PLIST = b"""<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.ifizbox.demo</string>
<key>CFBundleShortVersionString</key><string>2.1</string><key>CFBundleName</key><string>Demo</string></dict></plist>"""


def read(*p):
    with open(os.path.join(NATIVE, *p)) as f:
        return f.read()


def make_files(d):
    def ipa(name):
        with zipfile.ZipFile(os.path.join(d, name), "w") as z:
            z.writestr("Payload/Demo.app/Info.plist", INFO_PLIST)
            z.writestr("Payload/Demo.app/Demo", b"\xcf\xfa\xed\xfe")
    ipa("Demo.ipa")
    ipa("Payload.bin")
    with zipfile.ZipFile(os.path.join(d, "Archive.zip"), "w") as z:
        z.writestr("readme.txt", "hi")
    files = {
        # the fake helper's .deb: an ar magic line, then the control stanza (fake/ifizbox-helper drops the first line)
        "Tweak.deb": "!<arch>\nPackage: com.example.shared\nVersion: 1.2\nName: Shared\nDepends: bash, apt\n",
        "Bad.deb": "!<arch>\nPackage: com.example.broken\nVersion: 1.0\nDepends: com.example.nowhere\n",
        "apps.json": '{"name": "A Source", "apps": []}',
        "notes.txt": "just text",
        "fake.deb": "not an ar archive",
        "fake.ipa": "not a zip",
    }
    for n, t in files.items():
        with open(os.path.join(d, n), "w") as f:
            f.write(t)


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/share/Share.swift not tested")
class SwiftShare(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = disktmp.build_dir("ifizbox-sharetest-")  # off the shared /tmp tmpfs: see native/disktmp.py
        binary = os.path.join(cls.tmp, "sharetest")
        env = disktmp.swift_env(dict(os.environ), cls.tmp)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            os.path.join(HERE, "Share.swift"), os.path.join(HERE, "HTTPStream.swift"),
                            os.path.join(NATIVE, "intents", "Core.swift"),
                            os.path.join(NATIVE, "sign", "Updates.swift"), os.path.join(NATIVE, "sign", "Hash.swift"),
                            os.path.join(NATIVE, "sign", "Brand.swift"),
                            os.path.join(HERE, "tests", "main.swift"),
                            "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None
        if not cls.build_error:
            files = os.path.join(cls.tmp, "files")
            os.makedirs(files)
            make_files(files)
            fake = os.path.join(NATIVE, "fake")
            cls.out = subprocess.run([binary, os.path.join(fake, "ifizbox-helper"), os.path.join(fake, "fixture", "prefix"),
                                      os.path.join(fake, "fixture", "remote"), files],
                                     capture_output=True, text=True, timeout=300, env=dict(os.environ, TMPDIR=cls.tmp))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        for name in ("classify links: repo, AltStore source, ipa, deb, unknown", "classify files by their bytes, then their name",
                     "route: sources open Add Source in both modes", "route: ipa in jailbreak mode goes to the helper, AppSync Unified or not (F189: the app installs it first)",
                     "route: ipa in sideload mode is signed with the user's certificate (fake signer)",
                     "route: deb is the Confirm sheet in jailbreak mode, needs a jailbreak in sideload mode",
                     "jailbreak ipa: install-ipa through the helper, version for I3",
                     "jailbreak deb: simulate-deb resolves dependencies, install-deb installs",
                     "F133: a downloaded .deb checked against its stanza's SHA256 or MD5sum",
                     "http stream: Content-Length, chunked, close-delimited, any split",
                     "B163: a file opened in place is copied in pieces into My IPAs, big ones too, never moved"):
            self.assertIn("ok   " + name, self.out.stdout)
        self.assertIn("all passed", self.out.stdout)


class Declared(unittest.TestCase):
    def plist(self, *p):
        with open(os.path.join(NATIVE, *p), "rb") as f:
            return plistlib.load(f)

    def types(self, info):
        return {t for d in info.get("CFBundleDocumentTypes", []) for t in d.get("LSItemContentTypes", [])}

    def test_document_types(self):
        base = self.plist("Info.plist")
        side = dict(base)
        side.update(self.plist("Info-sideload.plist"))  # mkipa.py merge_plist: the overlay's keys win whole
        for name, info in (("jailbreak", base), ("sideload", side)):
            with self.subTest(build=name):
                self.assertLessEqual({"com.apple.itunes.ipa", "org.debian.deb-archive"}, self.types(info))
                imported = {t["UTTypeIdentifier"]: t for t in info.get("UTImportedTypeDeclarations", [])}
                deb = imported.get("org.debian.deb-archive")
                self.assertIsNotNone(deb, "no UTType for .deb")
                self.assertIn("deb", deb["UTTypeTagSpecification"]["public.filename-extension"])
                self.assertIn("public.data", deb["UTTypeConformsTo"])
                schemes = [s for t in info.get("CFBundleURLTypes", []) for s in t.get("CFBundleURLSchemes", [])]
                self.assertIn("ifizbox", schemes)  # the share extension opens ifizbox://share?url=…
                self.assertIn("LSSupportsOpeningDocumentsInPlace", info)
        # sideload keeps F77's types
        self.assertLessEqual({"com.rsa.pkcs-12", "com.apple.mobileprovision"}, self.types(side))

    def test_extension_plist(self):
        info = self.plist("share", "Info.plist")
        self.assertEqual(info["CFBundleIdentifier"], "com.ryha.ifizbox.share")
        self.assertEqual(info["CFBundlePackageType"], "XPC!")
        ext = info["NSExtension"]
        self.assertEqual(ext["NSExtensionPointIdentifier"], "com.apple.share-services")
        rule = ext["NSExtensionAttributes"]["NSExtensionActivationRule"]
        self.assertEqual(rule.get("NSExtensionActivationSupportsWebURLWithMaxCount"), 1)
        self.assertEqual(rule.get("NSExtensionActivationSupportsText"), True)
        self.assertEqual(ext["NSExtensionPrincipalClass"], "$(BRAND_NAME)Share.ShareViewController")  # build.sh fills it in


BUILD = os.path.join(NATIVE, "build")


class Built(unittest.TestCase):
    def test_deb_app(self):
        app = os.path.join(BUILD, "root", "var", "jb", "Applications", "iFizBox.app")
        exe = os.path.join(app, "PlugIns", "iFizBoxShare.appex", "iFizBoxShare")
        if not os.path.exists(os.path.join(app, "iFizBox")) or os.path.getmtime(os.path.join(app, "iFizBox")) < os.path.getmtime(os.path.join(HERE, "Share.swift")):
            self.skipTest("no fresh native build (tools/check.sh builds it after the tests, where the toolchain is)")
        self.assertTrue(os.path.exists(exe), "PlugIns/iFizBoxShare.appex missing from the .deb's app")
        with open(os.path.join(app, "Info.plist"), "rb") as f:
            self.assertIn("CFBundleDocumentTypes", plistlib.load(f))

    def test_ipa(self):
        ipa = os.path.join(BUILD, "iFizBox.ipa")
        if not os.path.exists(ipa) or os.path.getmtime(ipa) < os.path.getmtime(os.path.join(HERE, "Share.swift")):
            self.skipTest("no fresh native build (tools/check.sh builds it after the tests, where the toolchain is)")
        with zipfile.ZipFile(ipa) as z:
            self.assertIn("Payload/iFizBox.app/PlugIns/iFizBoxShare.appex/iFizBoxShare", z.namelist())


class Wiring(unittest.TestCase):
    def test_shell(self):
        self.assertIn("SharedInbox.receive(", read("Sources", "App.swift"))
        self.assertIn('"shared"', read("sign", "Handoff.swift"))
        bridge = read("share", "App", "ShareBridge.swift")
        for call in ("share.ipaInstall", "share.debFetch", "share.debSimulate", "share.debInstall", "share.discard"):
            self.assertIn('"%s"' % call, bridge)
        self.assertIn("ShareBridge.register(", read("Sources", "Bridge.swift") + read("Sources", "App.swift"))
        build = read("build.sh")
        self.assertIn("share/*.swift", build)
        self.assertIn("share/build.sh", build)

    def test_in_place_file(self):
        # B163: the sideload build opens documents in place, so a handed-over file (Safari's download preview) is
        # read through its security scope, started as iOS hands the URL over (before the queue hop), under a file
        # coordinator; IPAs are copied with the page's progress HUD, and every failure is an alert, never silence.
        bridge = read("share", "App", "ShareBridge.swift")
        receive = bridge[bridge.index("static func receive("):bridge.index("static func file(")]
        self.assertLess(receive.index("startAccessingSecurityScopedResource()"), receive.index("queue.async"))
        self.assertIn("stopAccessingSecurityScopedResource()", bridge)
        self.assertIn("NSFileCoordinator(", bridge)
        self.assertIn("ShareInbox.copyIn(", bridge)
        self.assertIn("ShareInbox.isOurInbox(", bridge)
        self.assertNotIn('lastPathComponent == "Inbox"', bridge)
        myipas = read("Sources", "MyIPAs.swift")
        recv = myipas[myipas.index("static func receive("):myipas.index("// ---- installing")]
        self.assertLess(recv.index("startAccessingSecurityScopedResource()"), recv.index(".async"))
        self.assertNotIn("try?", recv)
        self.assertIn("ifizbox:receiving", read("Sources", "App.swift"))
        with open(os.path.join(REPO, "web", "app", "incoming.js")) as f:
            self.assertIn('"ifizbox:receiving"', f.read())
        with open(os.path.join(NATIVE, "Info-sideload.plist"), "rb") as f:
            side = plistlib.load(f)
        ipa = [d for d in side["CFBundleDocumentTypes"] if "com.apple.itunes.ipa" in d["LSItemContentTypes"]][0]
        self.assertEqual(ipa["LSHandlerRank"], "Owner")
        self.assertTrue(side["LSSupportsOpeningDocumentsInPlace"])  # Files' On My iPhone needs it with UIFileSharingEnabled

    def test_page(self):
        with open(os.path.join(REPO, "web", "app", "incoming.js")) as f:
            self.assertIn("ifizbox://shared", f.read())


if __name__ == "__main__":
    unittest.main()
