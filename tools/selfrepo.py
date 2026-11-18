#!/usr/bin/env python3
"""Cydian's own APT repo (F72), the jailbreak app's built-in source, like Cydia's apt.saurik.com.

  tools/selfrepo.py OUT DEB [DEB...] [--minimum X.Y.Z] [--date RFC2822]

writes OUT/Packages, OUT/Packages.gz and OUT/Release for a flat repo whose .debs sit beside them under the names
given (each DEB's base name is its Filename:). tools/release.sh runs it on every release and uploads the three files
as assets of the release, next to the .debs, so the repo is
    https://github.com/RyanAHayden/Cydian/releases/latest/download/
(GitHub redirects latest/download/<name> to the newest release's asset; apt and Cydian's fetch follow it).

--minimum sets X-Cydian-Minimum-Version, Cydian's own field (in the Release and in Cydian's Packages stanza): a
running Cydian older than that must upgrade before anything else (web/app/core/essential.js). apt ignores X- fields.
"""
import gzip
import hashlib
import io
import os
import re
import sys
import tarfile
from email.utils import formatdate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
import mkdeb  # noqa: E402

SELF_ID = "com.ryha.cydian"
MIN_FIELD = "X-Cydian-Minimum-Version"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
# The control fields a Packages stanza carries, in apt's usual order (the rest follow as they come).
ORDER = ["Package", "Version", "Architecture", "Maintainer", "Installed-Size", "Pre-Depends", "Depends", "Conflicts",
         "Replaces", "Provides", "Essential", "Section", "Priority", "Name", "Author", "Description", "Depiction",
         "Icon", "Homepage"]


def control_text(deb):
    """The raw control file of a .deb."""
    with open(deb, "rb") as f:
        members = dict(mkdeb.read_ar(f.read()))
    blob = members.get("control.tar.xz") or members.get("control.tar.gz")
    if blob is None:
        raise ValueError("%s has no control.tar" % deb)
    with tarfile.open(fileobj=io.BytesIO(blob)) as t:
        m = next(x for x in t.getmembers() if x.name.lstrip("./") == "control")
        return t.extractfile(m).read().decode()


def stanza(deb, minimum=None):
    """One Packages stanza for `deb` (its control fields plus Filename, Size and hashes) as text."""
    fields = mkdeb.control_fields(control_text(deb))
    with open(deb, "rb") as f:
        data = f.read()
    fields["Filename"] = os.path.basename(deb)
    fields["Size"] = str(len(data))
    fields["MD5sum"] = hashlib.md5(data).hexdigest()
    fields["SHA256"] = hashlib.sha256(data).hexdigest()
    if minimum and fields.get("Package") == SELF_ID:
        fields[MIN_FIELD] = minimum
    keys = [k for k in ORDER if k in fields] + [k for k in fields if k not in ORDER]
    lines = []
    for k in keys:
        v = str(fields[k])
        first, *rest = v.split("\n")
        lines.append("%s: %s" % (k, first))
        lines += [" " + (r if r.strip() else ".") for r in rest]
    return "\n".join(lines) + "\n", fields


def build(out, debs, minimum=None, date=None):
    """Writes Packages, Packages.gz and Release into `out`; returns the Release text."""
    if minimum is not None and not VERSION_RE.match(minimum):
        raise ValueError("--minimum must be X.Y.Z, not %r" % minimum)
    if not debs:
        raise ValueError("no .debs")
    os.makedirs(out, exist_ok=True)
    texts, arches = [], []
    for deb in debs:
        text, fields = stanza(deb, minimum)
        texts.append(text)
        if fields.get("Architecture") and fields["Architecture"] not in arches:
            arches.append(fields["Architecture"])
    packages = "\n".join(texts).encode()
    with open(os.path.join(out, "Packages"), "wb") as f:
        f.write(packages)
    gz = gzip.compress(packages, mtime=0)
    with open(os.path.join(out, "Packages.gz"), "wb") as f:
        f.write(gz)
    files = [("Packages", packages), ("Packages.gz", gz)]
    rel = [
        "Origin: Cydian",
        "Label: Cydian",
        "Suite: stable",
        "Codename: cydian",
        "Architectures: " + " ".join(arches),
        # N11: Sileo drops a repo whose Release has no Components ("Could not parse release file", RepoManager.swift:
        # `guard ["components"].allSatisfy(releaseDict.keys.contains)`), flat or not; apt ignores it on a flat repo.
        # Chariz (flat) says main too.
        "Components: main",
        "Description: Cydian's own source: Cydian for jailbroken iPhones",
        "Date: " + (date or formatdate(usegmt=True)),
    ]
    if minimum:
        rel.append("%s: %s" % (MIN_FIELD, minimum))
    for title, algo in (("MD5Sum", hashlib.md5), ("SHA256", hashlib.sha256)):
        rel.append(title + ":")
        rel += [" %s %d %s" % (algo(b).hexdigest(), len(b), name) for name, b in files]
    text = "\n".join(rel) + "\n"
    with open(os.path.join(out, "Release"), "w") as f:
        f.write(text)
    return text


def main(argv):
    minimum = date = None
    args = []
    it = iter(argv)
    for a in it:
        if a == "--minimum":
            minimum = next(it, None)
        elif a == "--date":
            date = next(it, None)
        else:
            args.append(a)
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        build(args[0], args[1:], minimum=minimum, date=date)
    except (ValueError, OSError, StopIteration) as e:
        print("selfrepo: %s" % e, file=sys.stderr)
        return 1
    print("selfrepo: %s: Packages, Packages.gz, Release (%d .deb)" % (args[0], len(args) - 1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
