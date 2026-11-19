"""F15: the "no server" install route's build and bridge, on Linux. The route itself (pairing, LocalDevVPN, AFC,
installation_proxy) needs a phone; this checks what can be checked here: idevice is pinned to one commit and built
from source with only the features the route uses, the bridge registers every call its header lists and refuses the
jailbreak build, and (where native/build.sh has built the app) the executable carries idevice statically."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def pin():
    out = {}
    for line in read("pin.env").splitlines():
        line = line.split(" #", 1)[0].strip()
        if line and not line.startswith("#"):
            k, v = line.split("=", 1)
            out[k] = v
    return out


class Pin(unittest.TestCase):
    def test_one_commit_from_upstream(self):
        p = pin()
        self.assertEqual(p["IDEVICE_REPO"], "https://github.com/jkcoxson/idevice.git")
        self.assertRegex(p["IDEVICE_COMMIT"], r"^[0-9a-f]{40}$")

    def test_only_the_route_features(self):
        feats = set(pin()["IDEVICE_FEATURES"].split(","))
        need = {"tcp", "afc", "installation_proxy", "heartbeat", "rsd", "remote_pairing", "core_device_proxy"}
        self.assertLessEqual(need, feats)
        self.assertIn("ring", feats)  # aws-lc and openssl don't cross-build from Linux without a Mac toolchain
        self.assertFalse(feats & {"aws-lc", "openssl", "full", "usbmuxd", "debug_proxy", "dvt", "restore"}, feats)

    def test_build_is_locked_and_static(self):
        b = read("build.sh")
        self.assertIn("--locked", b)  # upstream's Cargo.lock at the pinned commit, nothing newer
        self.assertIn("--no-default-features", b)
        self.assertIn("libidevice_ffi.a", b)

    def test_app_build_uses_it(self):
        with open(os.path.join(NATIVE, "build.sh")) as f:
            b = f.read()
        self.assertIn("sideload/idevice/build.sh --probe", b)
        self.assertIn("sideload/idevice/*.swift", b)
        self.assertIn("-lidevice_ffi", b)


class Bridge(unittest.TestCase):
    def test_every_listed_call_is_registered(self):
        src = read("IDeviceBridge.swift")
        listed = set(re.findall(r"^//\s+(idevice\.\w+)", src, re.M))
        registered = set(re.findall(r'b\.on\("(idevice\.\w+)"\)', src))
        self.assertTrue(listed)
        self.assertEqual(listed, registered)

    def test_registered_with_the_signing_calls(self):
        with open(os.path.join(NATIVE, "Sources", "SignBridge.swift")) as f:
            self.assertIn("IDeviceBridge.register(b)", f.read())

    def test_jailbreak_build_refused(self):
        self.assertIn("AppMode.current != .jailbreak", read("IDeviceBridge.swift"))

    def test_pairing_stays_on_this_device(self):
        src = read("IDevice.swift")
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", src)
        self.assertNotIn("UserDefaults", src)


class PairOnPhone(unittest.TestCase):
    # idevice's all-in-one pairable_host_accept (IPv4-only listener, its own mDNS responder) was resolved by the
    # iPhone 15 Pro but never reached: the app listens and publishes with Apple's APIs, idevice only pairs.
    def test_apple_networking_idevice_pairing(self):
        src = read("IDevice.swift")
        self.assertIn("pairable_host_prepare(", src)
        self.assertIn("pairable_host_accept_fd(", src)
        self.assertNotIn("pairable_host_accept(", src)
        self.assertIn("DNSServiceRegister(", src)
        self.assertIn("IPV6_V6ONLY", src)

    def test_bonjour_declared(self):
        import plistlib
        with open(os.path.join(NATIVE, "Info-sideload.plist"), "rb") as f:
            info = plistlib.load(f)
        self.assertIn("_remotepairing-pairable-host._tcp", info["NSBonjourServices"])
        self.assertTrue(info["NSLocalNetworkUsageDescription"])
        self.assertIn('"_remotepairing-pairable-host._tcp"', read("IDevice.swift"))


class Built(unittest.TestCase):
    # The built IPA is checked by mkipa.py check right after native/build.sh builds it (the gate's last step). A
    # check here would read whatever native/build/ipa a checkout last built, from before a merge brought idevice in.
    def test_ipa_check_looks_for_idevice(self):
        with open(os.path.join(NATIVE, "mkipa.py")) as f:
            src = f.read()
        self.assertIn('b"ifizbox.idevice.pairing"', src)  # the Keychain service: IDevice.swift is in
        self.assertIn('b"_remotepairing-pairable-host._tcp"', src)  # idevice's pairable host made it past dead_strip


if __name__ == "__main__":
    unittest.main()
