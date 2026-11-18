"""F170: one source for the product's name. web/app/brand.js and native/brand.env agree; the files made from them
(sign/Brand.swift, index.html, manifest.json, source.json) are up to date (`python3 native/brand.py sync`); and no
string a person reads in web/app, worker/ or the Swift code says the old name or spells the name itself.

F171: no file outside plan/, journal/ and docs/concepts says the old name in any case (IDs, storage keys, paths,
env variables, file names), except what F172 moves: the old domain, the GitHub repo slug, and URLs of assets
already published on GitHub under the old name (NoOldIds.F172). The old name is spelled in pieces here so this file
passes its own grep."""
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

OLD_WORD = "Cy" + "dian"
OLD = re.compile(r"(?<![A-Za-z0-9_/\-.])" + OLD_WORD + r"(?![A-Za-z0-9_\-])")
OLD_ANY = re.compile(OLD_WORD, re.I)
NAME = re.compile(r"\b" + re.escape(brand.NAME) + r"\b")
JS_KEYS = {"NAME": "BRAND_NAME", "DOMAIN": "BRAND_DOMAIN", "SIGN_HOST": "BRAND_SIGN_HOST",
           "BUNDLE_ID": "BRAND_BUNDLE_ID", "PACKAGE": "BRAND_PACKAGE", "GITHUB_REPO": "BRAND_GITHUB_REPO"}
# Swift lines whose strings are IDs that start with the name: the widget kind and the icon's file stem.
SWIFT_IDS = re.compile(r"static let kind|iconStem")


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
        self.assertEqual(bad, [], f"user-visible strings that say {OLD_WORD} (use NAME from brand.js)")
        self.assertEqual(spelled, [], f"strings that spell {brand.NAME} (import NAME from brand.js instead)")

    def test_web_app(self):
        self.check_js(WEB, {"web/app/brand.js"})

    def test_worker(self):
        self.check_js(os.path.join(ROOT, "worker"), set())

    def test_scanner_finds_strings(self):
        got = js_strings('a = "x // y"; // old\nb = /"/g; c = `p ${q("r")} s`; /* old */ d = \'t\';')
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
        self.assertEqual(bad, [], f"Swift strings that say {OLD_WORD} (use Brand.name)")
        self.assertEqual(spelled, [], f"Swift strings that spell {brand.NAME} (use Brand.name)")

    def test_static_web_files(self):
        for f in ("index.html", "manifest.json"):
            text = read("web", "app", f)
            text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            self.assertIsNone(OLD.search(text), f)


class NoOldIds(unittest.TestCase):
    """F171: the old name is gone from every tracked text file but plan/, journal/ and docs/concepts (the record)."""
    SKIP = ("plan/", "journal/", "docs/concepts/")
    # F172 moves these (the domain, the GitHub repo) and then drops them from here. Assets already published under
    # the old name keep their URLs: the test-fixtures pre-release's files, and source.json's current release IPA
    # (release.sh rewrites it with the next release's iFizBox.ipa).
    F172 = re.compile(OLD_WORD + r"\\?\.dev\b|RyanAHayden\\?/" + OLD_WORD + r"\b|releases/download/test-fixtures/[\w.-]+"
                      r"|^name = \"" + OLD_WORD.lower() + r"-sign\"$|releases/download/v[\d.]+/" + OLD_WORD + r"\.(?:ipa|deb)\b",
                      re.I | re.M)

    def test_no_file_says_the_old_name(self):
        import subprocess
        files = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.decode().split("\0")
        bad = []
        for rel in files:
            if not rel or rel.startswith(self.SKIP):
                continue
            if OLD_ANY.search(rel):
                bad.append(f"{rel}: the file name")
            p = os.path.join(ROOT, rel)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            with open(p, "rb") as f:
                data = f.read()
            if b"\0" in data[:8192]:
                continue  # binary: zsign.wasm is rebuilt from source, the fixtures were rewritten (journal F171)
            text = self.F172.sub("", data.decode("utf-8", "replace"))
            for n, line in enumerate(text.splitlines(), 1):
                if OLD_ANY.search(line):
                    bad.append(f"{rel}:{n}: {line.strip()[:100]}")
        self.assertEqual(bad, [], "files that still say the old name (F171: rename it to the brand.env value)")

    def test_ids_follow_brand_env(self):
        """Every com.ryha ID is the brand's bundle ID or one of its suffixes (or the tests' com.ryha.test)."""
        import subprocess
        out = subprocess.run(["git", "grep", "-ohI", r"com\.ryha\.[A-Za-z0-9_-]*", "--", ".", ":!plan", ":!journal",
                              ":!docs/concepts"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        bundle = brand.BRAND["BRAND_BUNDLE_ID"]
        self.assertEqual(brand.BRAND["BRAND_PACKAGE"], bundle)
        bad = sorted({i for i in out if i != "com.ryha.test" and not re.match(re.escape(bundle) + r"(?:$|[._])", i)})
        self.assertEqual(bad, [], f"IDs that aren't {bundle}[.suffix]")

    def test_binary_fixtures(self):
        for rel in ("web/app/core/fixtures/signing/test.mobileprovision", "web/app/vendor/zsign/zsign.wasm"):
            with open(os.path.join(ROOT, rel), "rb") as f:
                self.assertIsNone(OLD_ANY.search(f.read().decode("latin-1")), rel)
        import zipfile
        with zipfile.ZipFile(os.path.join(WEB, "core", "fixtures", "signing", "tiny-ifizbox.ipa")) as z:
            for n in z.namelist():
                self.assertIsNone(OLD_ANY.search(z.read(n).decode("latin-1")), n)


if __name__ == "__main__":
    unittest.main()
