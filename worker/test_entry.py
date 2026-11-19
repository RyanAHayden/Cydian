"""Each wrangler*.toml starts the Worker from a module that exports only its handler.

Local workerd (`wrangler dev`) refuses to start on a main module with plain named exports
("Incorrect type for map entry 'HOST_WAIT'"), and src/index.js exports constants for the tests and node.mjs.
node.mjs, the other way to start it, is run here too: a website-signed upload must come back whole.
"""
import hashlib
import json
import os
import pathlib
import random
import re
import shutil
import socket
import subprocess
import tomllib
import unittest
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent


class EntryTest(unittest.TestCase):
    def test_main_exports_default_only(self):
        configs = sorted(HERE.glob("wrangler*.toml"))
        self.assertTrue(configs)
        for cfg in configs:
            with self.subTest(cfg.name):
                main = HERE / tomllib.loads(cfg.read_text())["main"]
                self.assertTrue(main.is_file(), f"{cfg.name}: main {main} is missing")
                exports = [l for l in main.read_text().splitlines() if re.match(r"\s*export\b", l)]
                self.assertEqual(len(exports), 1, f"{cfg.name}: {main.name} must only re-export default")
                self.assertRegex(exports[0], r'^export \{ default \} from "\./src/index\.js";$')


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class NodeServerTest(unittest.TestCase):
    """node.mjs (the self-hosted server) serves a website-signed upload back whole: its in-memory KV must hand
    KV's types (a ReadableStream for type "stream"), or app.ipa answers an empty reply."""

    def setUp(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        env = {**os.environ, "PORT": str(self.port), "HOST": "127.0.0.1", "REVIEWS_DB": "off"}
        self.proc = subprocess.Popen(["node", str(HERE / "node.mjs")], env=env, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True)
        self.addCleanup(self.stop)
        line = self.proc.stdout.readline()  # node.mjs prints one line once it listens
        self.assertIn(f":{self.port}", line, f"node.mjs did not start: {line}{self.proc.stdout.read() if self.proc.poll() is not None else ''}")

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=10)
        self.proc.stdout.close()

    def call(self, method, path, body=None, headers=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body, method=method, headers=headers or {})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.headers, r.read()

    def test_upload_round_trip(self):
        part = 20 * 1024 * 1024  # src/index.js PART: two parts, the second short
        app = b"PK" + bytes(random.Random(114).getrandbits(8) for _ in range(4094))
        app = (app * (part // len(app) + 1))[:part] + b"tail" * 300
        q = urllib.parse.urlencode({"bundleid": "com.example.app", "version": "1.0", "title": "Example", "size": len(app)})
        _, _, b = self.call("POST", f"/sign/upload?{q}")
        up = json.loads(b)
        self.assertEqual(up["parts"], 2)
        for i in range(up["parts"]):
            status, _, _ = self.call("PUT", f"/sign/upload/{up['token']}/{i}", app[i * part:(i + 1) * part])
            self.assertEqual(status, 200)
        _, _, b = self.call("POST", f"/sign/upload/{up['token']}/done")
        self.assertIn("itms", json.loads(b))
        status, headers, got = self.call("GET", f"/sign/up/{up['token']}/app.ipa")
        self.assertEqual((status, headers.get("Content-Length")), (200, str(len(app))))
        self.assertEqual(hashlib.sha256(got).hexdigest(), hashlib.sha256(app).hexdigest())
        # a Range across the two parts, cut at both ends
        status, _, got = self.call("GET", f"/sign/up/{up['token']}/app.ipa", headers={"Range": f"bytes={part - 5}-{part + 9}"})
        self.assertEqual((status, got), (206, app[part - 5:part + 10]))


if __name__ == "__main__":
    unittest.main()
