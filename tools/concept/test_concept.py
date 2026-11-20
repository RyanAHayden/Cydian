"""tools/concept: the concept page builds from web/app as it is, self-contained, light by default, with its
controls; its modules load; the bundler keeps ES module meaning. (The page in a browser: tools/concept/check.mjs.)"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build  # noqa: E402
import esm  # noqa: E402

NODE = shutil.which("node")

# Runs a bundle (registry runtime + module wrappers) in a bare node vm and loads the modules named on stdin.
VM = r"""
import vm from "node:vm"; import { readFileSync } from "node:fs";
const { code, load } = JSON.parse(readFileSync(0, "utf8"));
const ctx = vm.createContext({ console, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, queueMicrotask, structuredClone, atob, btoa });
vm.runInContext(code + "\n;globalThis.__r = { mods: __cMods, load: __cLoad };", ctx);
const out = { defined: Object.keys(ctx.__r.mods), loaded: [], failed: {}, values: {} };
for (const n of load) {
  try { const ns = await ctx.__r.load(n); out.loaded.push(n); out.values[n] = JSON.parse(JSON.stringify(Object.fromEntries(Object.keys(ns).map((k) => [k, typeof ns[k] === "function" ? "fn" : ns[k]])), (k, v) => typeof v === "bigint" ? String(v) : v)); }
  catch (e) { out.failed[n] = String(e && e.stack || e).slice(0, 300); }
}
console.log(JSON.stringify(out));
"""


def run_vm(code, load):
    r = subprocess.run([NODE, "--input-type=module", "-e", VM], input=json.dumps({"code": code, "load": load}),
                       capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout.strip().splitlines()[-1])


def data_of(page, name):
    m = re.search(r'<script type="application/json" id="concept-%s">(.*?)</script>' % name, page, re.S)
    return json.loads(m.group(1))


class ConceptPage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # web/app as it is, compared with HEAD (the before/after toggle's path), as the Artifact tool gets it
        cls.page = build.build(before="HEAD", title="Unchanged", start="#/sources")
        cls.meta, cls.after = data_of(cls.page, "meta"), data_of(cls.page, "after")
        cls.before = data_of(cls.page, "before")

    def test_fits_the_artifact(self):
        self.assertLess(len(self.page.encode()), build.MAX_BYTES)
        self.assertNotRegex(self.page[:200], r"(?i)<!doctype|<html|<body")  # the Artifact tool adds the skeleton
        self.assertIn("<title>Unchanged</title>", self.page[:8192])

    def test_loads_nothing_from_outside(self):
        # the frame page and the app's document and stylesheets: no external script, style, image or font
        frame = re.sub(r'<script type="application/json".*?</script>', "", self.page, flags=re.S)
        docs = [frame, self.after["html"], self.after["boot"]] + list(self.after["files"].values())
        ext = re.compile(r"""(?:\b(?:src|href|srcset)\s*=\s*["']?\s*(?:https?:)?//)|url\(\s*["']?\s*(?:https?:)?//|@import""", re.I)
        for text in docs:
            self.assertIsNone(ext.search(text), ext.search(text) and text[max(0, ext.search(text).start() - 80):ext.search(text).end() + 80])
        for path, uri in self.after["assets"].items():
            self.assertTrue(uri.startswith("data:image/"), path)
        self.assertIn("api/fetch", self.meta["shell"])  # the site's proxy is answered in the frame
        self.assertNotIn("realFetch", self.meta["shell"])  # and nothing falls through to the network

    def test_defaults_to_light_with_every_palette(self):
        self.assertRegex(self.page, r'theme: "light:" \+ meta\.palettes\.lightTheme\[0\]\.value')
        boot = (build.ROOT / "web/app/theme-boot.js").read_text()
        darks = re.search(r"var darks = \[([^\]]*)\]", boot).group(1)
        lights = re.search(r"lights = \[([^\]]*)\]", boot).group(1)
        self.assertEqual({p["value"] for p in self.meta["palettes"]["darkTheme"]}, set(re.findall(r'"(\w+)"', darks)))
        self.assertEqual({p["value"] for p in self.meta["palettes"]["lightTheme"]}, set(re.findall(r'"(\w+)"', lights)))
        self.assertEqual(self.meta["palettes"]["lightTheme"][0]["value"], "classic")

    def test_has_the_controls(self):
        for el in ('id="theme"', 'id="device"', 'id="mode"', 'id="version"', 'id="app"'):
            self.assertIn(el, self.page)
        self.assertEqual([m["id"] for m in self.meta["modes"]], ["jailbreak", "sideload", "site"])
        names = [d["name"] for d in self.meta["devices"]]
        for want in ("iPhone SE", "iPhone 15 / 16", "iPhone 17 Pro Max", "iPad mini"):
            self.assertIn(want, names)
        cut = {d["id"]: d["cutout"] for d in self.meta["devices"]}
        self.assertEqual((cut["iphone-se"], cut["iphone-16"], cut["iphone-14"]), ("none", "island", "notch"))
        self.assertEqual(self.meta["start"], "#/sources")
        # against HEAD: {"same": true} in a clean checkout (no toggle), else only what differs
        self.assertTrue(self.before == {"same": True} or {"modules", "files", "assets"} <= set(self.before), self.before)

    def test_safe_areas_come_from_the_frame(self):
        css = "".join(self.after["files"][p] for p in self.after["files"] if p.endswith(".css"))
        self.assertNotIn("env(safe-area", css)
        self.assertIn("var(--sa-top, 0px)", css)

    @unittest.skipUnless(NODE, "needs node")
    def test_modules_load(self):
        code = self.meta["runtime"] + "\n" + "\n".join(self.after["modules"][p] for p in sorted(self.after["modules"]))
        core = sorted(p for p in self.after["modules"] if p.startswith("core/"))
        out = run_vm(code, core)
        self.assertIn("app.js", out["defined"])
        self.assertEqual(out["failed"], {})
        self.assertEqual(sorted(out["loaded"]), core)


class Bundler(unittest.TestCase):
    MODS = {
        "a.js": 'export let count = 1;\nexport function inc() { count++; }\nexport const A = 1, B = "b/c", C = `x${ {k: 1}.k }`;\n'
                'const re = /["'"'"'\\/]+/g;\nexport class K {}\n',
        "sub/b.js": 'import { count, inc as bump } from "../a.js";\nimport * as a from "../a.js";\nbump();\nexport const seen = count;\n'
                    'export const viaNs = a.count;\nexport { A as renamed, B } from "../a.js";\n'
                    'export const meta = import.meta.url;\nconst later = await Promise.resolve(5);\nexport { later };\n'
                    'export const lazy = () => import("./c.js").then((m) => m.c);\n',
        "sub/c.js": "export const c = 'c';\n",
    }

    def test_transform_finds_imports_and_exports(self):
        _, info = esm.transform(self.MODS["a.js"], "a.js")
        self.assertEqual(sorted(info["exports"]), ["A", "B", "C", "K", "count", "inc"])
        _, info = esm.transform(self.MODS["sub/b.js"], "sub/b.js")
        self.assertEqual(info["deps"], ["a.js"])
        self.assertIn(("bump", "a.js", "inc"), info["imports"])
        self.assertIn(("a", "a.js", "*"), info["imports"])
        self.assertIn(("renamed", "a.js", "A"), info["reexports"])

    def test_a_missing_export_fails_the_build(self):
        with self.assertRaises(esm.BundleError):
            esm.bundle({"app.js": 'import { nope } from "./a.js";', "a.js": "export const yes = 1;"}, "app.js")

    @unittest.skipUnless(NODE, "needs node")
    def test_live_bindings_order_and_dynamic_import(self):
        code, _ = esm.bundle(dict(self.MODS, **{"app.js": 'import "./sub/b.js";'}), "app.js")
        out = run_vm(code.replace('__cLoad("app.js")', "Promise.resolve()"), ["sub/b.js", "a.js"])
        self.assertEqual(out["failed"], {})
        b, a = out["values"]["sub/b.js"], out["values"]["a.js"]
        self.assertEqual((b["seen"], b["viaNs"], a["count"]), (2, 2, 2))  # inc() ran before, and the binding is live
        self.assertEqual((b["renamed"], b["B"], a["C"], b["later"]), (1, "b/c", "x1", 5))
        self.assertEqual(b["meta"], "concept://app/sub/b.js")


class FrameHtml(unittest.TestCase):
    def test_index_html_keeps_its_slots(self):
        html = build.frame_html((build.ROOT / "web/app/index.html").read_text())
        self.assertIn('<style data-concept-for="ios6.css"></style>', html)
        self.assertNotIn('type="module"', html)
        self.assertNotIn("apple-touch-startup-image", html)
        self.assertLess(html.index("<!--concept-head-->"), html.index("<!--concept-boot-->"))

    def test_build_writes_a_page(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "c.html"
            build.main(["-o", str(out), "--before", "none", "--standalone"])
            text = out.read_text()
            self.assertTrue(text.startswith("<!doctype html>"))
            self.assertEqual(data_of(text, "before"), None)


if __name__ == "__main__":
    unittest.main()
