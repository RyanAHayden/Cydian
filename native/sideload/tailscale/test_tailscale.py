"""The Tailscale connection's build and bridge, on Linux (README.md beside this file): Go is pinned by version and
sha256 and tailscale.com by go.mod/go.sum, the c-archive goes into the sideload executable only, every listed bridge
call is registered, and nothing is logged to Tailscale's servers."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.normpath(os.path.join(HERE, "..", ".."))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


class Pin(unittest.TestCase):
    def test_go_and_tailscale_pinned(self):
        pin = read("pin.env")
        self.assertRegex(pin, r"GO_VERSION=go1\.\d+\.\d+")
        self.assertRegex(pin, r"GO_SHA256=[0-9a-f]{64}")
        self.assertRegex(read("go.mod"), r"tailscale\.com v\d+\.\d+\.\d+")
        self.assertIn("tailscale.com v", read("go.sum"))
        b = read("build.sh")
        self.assertIn("sha256sum -c", b)
        self.assertIn("-mod=readonly", b)
        self.assertIn("GOTOOLCHAIN=local", b)
        self.assertIn("-buildmode=c-archive", b)

    def test_licence_next_to_it(self):
        self.assertTrue(read("LICENSE").startswith("BSD 3-Clause License"))


class Build(unittest.TestCase):
    def test_sideload_only(self):
        with open(os.path.join(NATIVE, "build.sh")) as f:
            b = f.read()
        self.assertIn("sideload/tailscale/build.sh --probe", b)
        self.assertIn("sideload/tailscale/*.swift", b)
        self.assertIn('link "$out/tsnet-stub.o" -o "$out/$BRAND_NAME"', b)
        self.assertRegex(b, r'link "\$out/tailscale/libtsnet\.a".*\n.*-o "\$out/\$BRAND_NAME-sideload"')
        self.assertIn("exe=$out/$BRAND_NAME-sideload", b)

    def test_stub_matches_header(self):
        h = set(re.findall(r"\b(TS\w+)\(", read("tsnet_ffi.h")))
        self.assertEqual(h, set(re.findall(r"\b(TS\w+)\(", read("stub.c"))) & h)
        exported = set(re.findall(r"^//export (TS\w+)", read("tsnet.go"), re.M))
        self.assertEqual(h, exported)

    def test_idevice_port_map_patch(self):
        p = read("..", "idevice", "patches", "0002-tunnel-port-map.patch")
        self.assertIn("tunnel_set_port_map", p)
        self.assertIn("map_tunnel_port(tunnel_port)", p)


class Bridge(unittest.TestCase):
    def test_every_listed_call_is_registered(self):
        src = read("Tailscale.swift")
        listed = set(re.findall(r"^//\s+(tailscale\.\w+)", src, re.M))
        registered = set(re.findall(r'b\.on\("(tailscale\.\w+)"\)', src))
        self.assertTrue(listed)
        self.assertEqual(listed, registered)
        with open(os.path.join(NATIVE, "Sources", "SignBridge.swift")) as f:
            self.assertIn("TailscaleBridge.register(b)", f.read())

    def test_no_logs_to_tailscale_and_not_ephemeral(self):
        go = read("tsnet.go")
        self.assertIn('os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")', go)
        self.assertNotIn("Ephemeral: true", go)

    def test_install_session_uses_it(self):
        with open(os.path.join(NATIVE, "sideload", "idevice", "IDevice.swift")) as f:
            s = f.read()
        self.assertIn("Tailscale.useForInstall()", s)
        self.assertIn("Tailscale.beginInstall(port:", s)
        self.assertIn("Tailscale.endInstall()", s)


if __name__ == "__main__":
    unittest.main()
