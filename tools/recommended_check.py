#!/usr/bin/env python3
"""F142: fetch every source in web/app/core/recommended.js and say what it carries, to check each entry's `why`.

    tools/recommended_check.py            every entry in recommended.js
    tools/recommended_check.py URL...     just these (an APT repo if the URL has a Packages file, else AltStore JSON)

For an AltStore source: its name, app count and the apps' names. For an APT repo: its Release label, package count,
architectures, the biggest sections, how many are paid (cydia::commercial) and the iOS range its rootless
(iphoneos-arm64) packages state through firmware dependencies. Exit 1 when any URL doesn't answer with a source.
Network use: this is a reference tool, never part of tools/check.sh. The date each list was last checked lives in
recommended.js (CHECKED) and in the F142 journal.
"""
import bz2
import gzip
import json
import lzma
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Cydian-recommended-check/1"


def get(url, limit=64 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(limit)


def entries():
    text = (ROOT / "web/app/core/recommended.js").read_text()
    for m in re.finditer(r'name: "([^"]+)", url: "([^"]+)"([^}]*)', text):
        yield m.group(1), m.group(2), "jailbreak: true" in m.group(3)


def packages(url):
    base = url if url.endswith("/") else url + "/"
    for name, unpack in (("Packages.xz", lzma.decompress), ("Packages.bz2", bz2.decompress),
                         ("Packages.gz", gzip.decompress), ("Packages", lambda b: b)):
        try:
            return unpack(get(base + name)).decode("utf-8", "replace")
        except Exception:
            continue
    return None


def stanzas(text):
    for block in re.split(r"\n\s*\n", text):
        st = {}
        for line in block.splitlines():
            if ":" in line and not line.startswith((" ", "\t")):
                k, v = line.split(":", 1)
                st[k.strip().lower()] = v.strip()
        if st.get("package"):
            yield st


def ios_range(sts):
    lo, hi = [], []
    for st in sts:
        for m in re.finditer(r"firmware\s*\((>=|>>|<<|<=)\s*([0-9.]+)\)", st.get("depends", "")):
            (lo if m.group(1).startswith(">") else hi).append(tuple(int(x) for x in m.group(2).split(".") if x))
    fmt = lambda v: ".".join(map(str, v))
    return (fmt(Counter(lo).most_common(1)[0][0]) if lo else "?", fmt(max(hi)) if hi else "open")


def apt(url):
    base = url if url.endswith("/") else url + "/"
    try:
        rel = get(base + "Release").decode("utf-8", "replace")
    except Exception:
        rel = ""
    text = packages(url)
    if text is None:
        return None
    sts = list(stanzas(text))
    ids = {st["package"] for st in sts}
    if not ids:
        return None  # a web page answered for Packages, not a repo
    arm64 = [st for st in sts if st.get("architecture") == "iphoneos-arm64"]
    paid = {st["package"] for st in sts if "cydia::commercial" in st.get("tag", "")}
    label = re.search(r"^Label:\s*(.*)$", rel, re.M)
    sections = Counter({st["package"]: st.get("section", "?") for st in sts}.values())
    return (f"APT {label.group(1) if label else '?'}: {len(ids)} packages ({len({s['package'] for s in arm64})} rootless), "
            f"{len(paid)} paid; archs {dict(Counter(st.get('architecture') for st in sts))}; "
            f"sections {sections.most_common(6)}; rootless firmware min/max {ios_range(arm64)}")


def alt(url):
    data = json.loads(get(url))
    apps = data.get("apps") or []
    names = sorted({a.get("name", "?") for a in apps})
    return f"AltStore {data.get('name')!r}: {len(apps)} apps: {', '.join(names[:25])}{' …' if len(names) > 25 else ''}"


def main(argv):
    todo = [(u, u, None) for u in argv] if argv else list(entries())
    bad = 0
    for name, url, jailbreak in todo:
        try:
            out = (apt(url) if jailbreak is not False else None) or (alt(url) if not jailbreak else None)
        except Exception as e:  # noqa: BLE001: report and go on
            out = None
            print(f"{name}: {url}: FAILED {e}")
        if out is None:
            bad += 1
            print(f"{name}: {url}: no source here")
        else:
            print(f"{name}: {url}\n    {out}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
