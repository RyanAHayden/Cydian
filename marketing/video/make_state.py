#!/usr/bin/env python3
"""A small, made-up rootless apt state for the showcase captures (the fake shell in capture.mjs reads it).

    python3 marketing/video/make_state.py OUT_DIR

Writes OUT_DIR/etc/apt/sources.list.d/*.sources (Procursus, Havoc, Chariz, ElleKit: a palera1n rootless phone's
kind of list) and OUT_DIR/var/lib/dpkg/status: real stanzas from those repos' Packages, so names, sections, icons
and descriptions are real. A few are given an older version than the repo has (one the repo itself lists where it
keeps several, else the one in OLDER), so Changes and the tab badge have updates to show. apt's lists directory is
left empty: the app then reads every source from the network (net.packages), as after a fresh install.
Stdlib only.
"""
import bz2
import lzma
import re
import sys
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Sileo/2.5 CoreFoundation/1856.105"}
SOURCES = {
    "procursus": ("https://apt.procurs.us/", "1900", "main"),
    "havoc": ("https://havoc.app/", "./", None),
    "chariz": ("https://repo.chariz.com/", "./", None),
    "ellekit": ("https://ellekit.space/", "./", None),
}
# (source, package, version to install: None = the newest, "prev" = the newest but one the repo lists)
INSTALLED = [
    ("procursus", "apt", None), ("procursus", "dpkg", None), ("procursus", "bash", None),
    ("procursus", "coreutils", None), ("procursus", "zsh", None), ("procursus", "preferenceloader", None),
    ("procursus", "ldid", None), ("procursus", "wget", None), ("procursus", "nano", None),
    ("procursus", "curl", "8.6.0"), ("procursus", "htop", "3.2.2"), ("procursus", "git", None),
    ("havoc", "com.opa334.cranelite", "prev"), ("havoc", "com.nahtedetihw.floatingdockxvi", "prev"),
    ("havoc", "com.yan.bea", "prev"), ("havoc", "com.p2kdev.simpletime", None), ("havoc", "me.tomt000.copylog", None),
    ("havoc", "com.mtac.ampere", None),
]
DROP = {"Filename", "Size", "MD5sum", "SHA1", "SHA256", "SHA512", "Installed-Size-Bytes"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def packages(base, dist, comp):
    d = f"{base}dists/{dist}/{comp}/binary-iphoneos-arm64/" if comp else base
    for name, unpack in (("Packages.xz", lzma.decompress), ("Packages.bz2", bz2.decompress), ("Packages", bytes)):
        try:
            return unpack(fetch(d + name)).decode("utf-8", "replace")
        except Exception:
            continue
    raise SystemExit(f"no Packages in {d}")


def vkey(v):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", v)]


def main(out):
    out = Path(out)
    sl = out / "etc/apt/sources.list.d"
    sl.mkdir(parents=True, exist_ok=True)
    (out / "var/lib/dpkg").mkdir(parents=True, exist_ok=True)
    (out / "var/lib/apt/lists").mkdir(parents=True, exist_ok=True)
    for name, (base, dist, comp) in SOURCES.items():
        lines = ["Types: deb", f"URIs: {base}", f"Suites: {dist}"] + ([f"Components: {comp}"] if comp else [])
        (sl / f"{name}.sources").write_text("\n".join(lines) + "\n")
    stanzas = []
    cache = {}
    for src, pkg, want in INSTALLED:
        if src not in cache:
            cache[src] = [s for s in packages(*SOURCES[src]).split("\n\n") if s.strip()]
        found = [s for s in cache[src] if re.search(rf"^Package: {re.escape(pkg)}$", s, re.M)
                 and re.search(r"^Architecture: iphoneos-arm64$", s, re.M)]
        if not found:
            print("missing", pkg, file=sys.stderr)
            continue
        found.sort(key=lambda s: vkey(re.search(r"^Version: (.+)$", s, re.M).group(1)))
        s = found[-2] if want == "prev" and len(found) > 1 else found[-1]
        keep = [l for l in s.split("\n") if l.split(":", 1)[0] not in DROP and not l.startswith("Status:")]
        if want and want != "prev":
            keep = [f"Version: {want}" if l.startswith("Version:") else l for l in keep]
        keep.insert(1, "Status: install ok installed")
        stanzas.append("\n".join(keep))
    (out / "var/lib/dpkg/status").write_text("\n\n".join(stanzas) + "\n")
    print(f"{len(stanzas)} packages, {len(SOURCES)} sources in {out}")


if __name__ == "__main__":
    main(sys.argv[1])
