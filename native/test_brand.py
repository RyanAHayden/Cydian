"""F170: one source for the product's name. web/app/brand.js and native/brand.env agree; the files made from them
(sign/Brand.swift, index.html, manifest.json, source.json) are up to date (`python3 native/brand.py sync`); and no
string a person reads in web/app, worker/ or the Swift code says the old name or spells the name itself.

IDs stay out of the grep until F171/F172 move them: Cydian.app/.ipa/.deb file names, /Cydian (the GitHub repo),
X-Cydian-* fields, cydian lowercase (bundle IDs, storage keys, paths), keychain labels and the User-Agent."""
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web", "app")
sys.path.insert(0, HERE)
import brand  # noqa: E402

OLD = re.compile(r"(?<![A-Za-z0-9_/\-.])Cydian(?![A-Za-z0-9_\-]|\.(?:ipa|deb|app)\b)")
NAME = re.compile(r"\b" + re.escape(brand.NAME) + r"\b")
JS_KEYS = {"NAME": "BRAND_NAME", "DOMAIN": "BRAND_DOMAIN", "SIGN_HOST": "BRAND_SIGN_HOST",
           "BUNDLE_ID": "BRAND_BUNDLE_ID", "PACKAGE": "BRAND_PACKAGE", "GITHUB_REPO": "BRAND_GITHUB_REPO"}
# Swift lines whose strings are IDs (F171 renames them): keychain labels, the User-Agent, the widget kind, file names.
SWIFT_IDS = re.compile(r"kSecAttrLabel|static let label = |User-Agent|static let kind|iconStem|update\.deb")


def read(*p):
    with open(os.path.join(ROOT, *p)) as f:
        return f.read()


def js_strings(src):
    """The string literals of a JS file ('...', "...", and a template's literal parts), comments and regexes
    skipped. Enough of a scanner for this codebase: a / after an operator, bracket or keyword starts a regex."""
    out, i, n, depth, stack, prev, word = [], 0, len(src), 0, [], "", ""
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            i = src.find("\n", i) if src.find("\n", i) >= 0 else n
            continue
        if src.startswith("/*", i):
            i = src.index("*/", i + 2) + 2
            continue
        if c in "'\"":
            j = i + 1
            while src[j] != c:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i + 1:j])
            i, prev = j + 1, "s"
            continue
        if c == "`" or (c == "}" and stack and stack[-1] == depth):
            if c == "}":
                stack.pop()
            j = i + 1
            while True:
                if src[j] == "\\":
                    j += 2
                elif src[j] == "`":
                    out.append(src[i + 1:j]); j += 1
                    break
                elif src.startswith("${", j):
                    out.append(src[i + 1:j]); stack.append(depth); j += 2
                    break
                else:
                    j += 1
            i, prev = j, "s"
            continue
        if c == "/" and (prev in ("", "op") or word in ("return", "typeof", "case")):
            j, cls = i + 1, False
            while src[j] != "/" or cls:
                if src[j] == "\\":
                    j += 1
                elif src[j] == "[":
                    cls = True
                elif src[j] == "]":
                    cls = False
                j += 1
            i, prev = j + 1, "s"
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        if c.isalnum() or c in "_$":
            m = re.compile(r"[A-Za-z0-9_$]+").match(src, i)
            word, prev, i = m.group(0), "w", m.end()
            continue
        if not c.isspace():
            prev, word = ("op" if c in "(,=:[!&|?{};+-*%<>~^" else "s"), ""
        i += 1
    return out


def code_files(top, exts, skip=()):
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if x not in ("vendor", "node_modules", "build", "spike", "fixtures", "tests")]
        for f in files:
            p = os.path.join(d, f)
            if f.endswith(exts) and not f.endswith((".test.js", "test.mjs")) and p not in skip:
                yield p


class BrandSource(unittest.TestCase):
    def test_brand_js_matches_brand_env(self):
        js = read("web", "app", "brand.js")
        for key, env in JS_KEYS.items():
            m = re.search(rf'^export const {key} = (?:"([^"]*)"|`([^`]*)`|(\w+));', js, re.M)
            self.assertIsNotNone(m, f"brand.js has no {key}")
            value = m.group(1) or m.group(2) or None
            if m.group(3):  # an alias of another constant
                value = brand.BRAND[JS_KEYS[m.group(3)]]
            value = value.replace("${DOMAIN}", brand.BRAND["BRAND_DOMAIN"])
            self.assertEqual(value, brand.BRAND[env], key)

    def test_generated_files_are_synced(self):
        self.assertEqual(read("native", "sign", "Brand.swift"), brand.swift(), "run python3 native/brand.py sync")
        html = read("web", "app", "index.html")
        self.assertEqual(brand.html(html), html, "index.html: run python3 native/brand.py sync")
        self.assertIn(f"<title>{brand.NAME}</title>", html)
        man = read("web", "app", "manifest.json")
        self.assertEqual(json.loads(man)["name"], brand.NAME)
        self.assertEqual(json.loads(man)["short_name"], brand.NAME)
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import altsource
        source = json.loads(read("web", "app", "source.json"))
        self.assertEqual(altsource.rebrand(source), source, "source.json: run python3 native/brand.py sync")
        self.assertEqual(source["apps"][0]["name"], brand.NAME)

    def test_templates_use_the_variable(self):
        for p in (("native", "Info.plist"), ("native", "share", "Info.plist"), ("native", "widget", "Info.plist")):
            self.assertIn("<key>CFBundleDisplayName</key><string>$(BRAND_NAME)</string>", read(*p), "/".join(p))
        self.assertIn("Name: $(BRAND_NAME)", read("native", "deb", "control"))
        build = read("native", "build.sh")
        self.assertIn(". ./brand.env", build)
        self.assertIn("${brand_sed[@]}", build)


class NoOldName(unittest.TestCase):
    def check_js(self, top, allowed):
        bad, spelled = [], []
        for p in code_files(top, (".js", ".mjs")):
            rel = os.path.relpath(p, ROOT)
            with open(p) as f:
                for s in js_strings(f.read()):
                    if OLD.search(s):
                        bad.append(f"{rel}: {s[:80]!r}")
                    if NAME.search(s) and rel not in allowed:
                        spelled.append(f"{rel}: {s[:80]!r}")
        self.assertEqual(bad, [], "user-visible strings that say Cydian (use NAME from brand.js)")
        self.assertEqual(spelled, [], f"strings that spell {brand.NAME} (import NAME from brand.js instead)")

    def test_web_app(self):
        self.check_js(WEB, {"web/app/brand.js"})

    def test_worker(self):
        self.check_js(os.path.join(ROOT, "worker"), set())

    def test_scanner_finds_strings(self):
        got = js_strings('a = "x // y"; // Cydian\nb = /"/g; c = `p ${q("r")} s`; /* Cydian */ d = \'t\';')
        self.assertEqual(got, ["x // y", "p ", "r", " s", "t"])

    def test_swift(self):
        bad, spelled = [], []
        for p in code_files(HERE, (".swift",)):
            rel = os.path.relpath(p, ROOT)
            if rel == "native/sign/Brand.swift":
                continue
            with open(p) as f:
                for n, line in enumerate(f, 1):
                    code = line.split("//")[0] if line.split("//")[0].count('"') % 2 == 0 else line
                    if SWIFT_IDS.search(code):
                        continue
                    for s in re.findall(r'"((?:[^"\\]|\\.)*)"', code):
                        if OLD.search(s):
                            bad.append(f"{rel}:{n}: {s[:80]!r}")
                        if NAME.search(s):
                            spelled.append(f"{rel}:{n}: {s[:80]!r}")
        self.assertEqual(bad, [], "Swift strings that say Cydian (use Brand.name)")
        self.assertEqual(spelled, [], f"Swift strings that spell {brand.NAME} (use Brand.name)")

    def test_static_web_files(self):
        for f in ("index.html", "manifest.json"):
            text = read("web", "app", f)
            text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            self.assertIsNone(OLD.search(text), f)


if __name__ == "__main__":
    unittest.main()
