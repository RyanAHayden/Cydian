#!/usr/bin/env python3
"""iFizBox's own APT repo (F72), the jailbreak app's built-in source, like Cydia's apt.saurik.com.

  tools/selfrepo.py OUT DEB [DEB...] [--tag vX.Y.Z] [--history DIR] [--minimum X.Y.Z] [--date RFC2822]
  tools/selfrepo.py fetch OWNER/NAME DIR [--skip vX.Y.Z]

writes OUT/Packages, OUT/Packages.gz and OUT/Release for a flat repo. tools/release.sh runs it on every release and
uploads the three files as assets of the release, next to the .debs. GitHub serves them at
    https://github.com/RyanAHayden/iFizBox/releases/latest/download/
(latest/download/<name> redirects to the newest release's asset), and the repo's address is
    https://<BRAND_DOMAIN>/repo/   (native/brand.env)
where the Worker (worker/src/index.js `repo`) fetches the same asset and answers with it, no redirect: Zebra names
its cache file after the final URL, and GitHub's signed one is too long for it (B17).

Packages keeps a stanza for every published release, newest KEEP releases (like altsource.py's versions[]), so apt
and the app's Downgrade and Version History see the older iFizBox builds too. Each Filename: names the release the
.deb is an asset of, `<tag>/<asset>` (--tag for the DEBs given; without it, the bare base name), which the Worker's
/repo/<tag>/<file>.deb fetches from releases/download/<tag>/<file>. --history DIR holds the older releases as
DIR/<tag>/: that release's Packages asset (only its own stanzas are taken: a bare Filename, or one under <tag>/) or,
for a release without one, its Debian-named .debs. `fetch` fills such a DIR from GitHub with the gh CLI.

--minimum sets X-iFizBox-Minimum-Version, iFizBox's own field (in the Release and in iFizBox's Packages stanza): a
running iFizBox older than that must upgrade before anything else (web/app/core/essential.js). apt ignores X- fields.
"""
import gzip
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
from email.utils import formatdate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "native"))
import mkdeb  # noqa: E402
from brand import NAME  # noqa: E402  (F170: native/brand.env)

SELF_ID = "com.ryha.ifizbox"
MIN_FIELD = "X-iFizBox-Minimum-Version"
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
# A Debian-named .deb asset (com.ryha.ifizbox_0.2.0-412_iphoneos-arm64.deb), release.sh's name check.
DEBNAME_RE = re.compile(r"^[a-z0-9][a-z0-9.+-]*_[0-9][A-Za-z0-9.+~-]*_[a-z0-9-]+\.deb$")
KEEP = 20  # releases Packages names, newest first (tools/altsource.py KEEP)
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


def stanza(deb, minimum=None, tag=None):
    """One Packages stanza for `deb` (its control fields plus Filename, Size and hashes) as text. With `tag`, the
    Filename is `<tag>/<base name>`: the .deb asset of that release."""
    fields = mkdeb.control_fields(control_text(deb))
    with open(deb, "rb") as f:
        data = f.read()
    fields["Filename"] = (tag + "/" if tag else "") + os.path.basename(deb)
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


def tag_key(tag):
    """vX.Y.Z -> (X, Y, Z) for sorting, or None for any other tag."""
    m = TAG_RE.match(tag)
    return tuple(int(x) for x in m.groups()) if m else None


def split_stanzas(text):
    """Packages text -> a list of stanzas, each a list of lines (continuation lines kept with their field)."""
    out, cur = [], []
    for line in text.splitlines():
        if line.strip():
            cur.append(line)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def stanza_field(lines, name):
    for line in lines:
        if not line[0].isspace() and line.partition(":")[0].strip() == name:
            return line.partition(":")[2].strip()
    return None


def own_stanzas(packages_text, tag):
    """The stanzas of an older release's Packages asset that are that release's own .debs, each Filename rewritten to
    `<tag>/<asset>` and its minimum field dropped (the minimum is the newest release's to set). A stanza whose
    Filename is bare (the releases before per-release Filenames) is this release's asset; one under another tag/ is
    an even older release's, which comes from that release instead. -> [(text, fields)]."""
    out = []
    for lines in split_stanzas(packages_text):
        fn = stanza_field(lines, "Filename")
        if not fn:
            continue
        head, _, base = fn.rpartition("/")
        if head not in ("", tag) or not base.endswith(".deb") or base.startswith("."):
            continue
        kept = []
        skip_cont = False
        for line in lines:
            if line[0].isspace():
                if not skip_cont:
                    kept.append(line)
                continue
            name = line.partition(":")[0].strip()
            skip_cont = name == MIN_FIELD
            if skip_cont:
                continue
            kept.append("Filename: %s/%s" % (tag, base) if name == "Filename" else line)
        fields = mkdeb.control_fields("\n".join(kept))
        out.append(("\n".join(kept) + "\n", fields))
    return out


def history_stanzas(history, skip=None, keep=KEEP - 1):
    """Stanzas for the older releases in `history` (DIR/<tag>/, newest `keep` vX.Y.Z tags other than `skip`): each
    release's Packages asset when it has one, else its Debian-named .debs. -> [(text, fields)], newest release first."""
    if not history:
        return []
    tags = [t for t in os.listdir(history) if tag_key(t) and t != skip and os.path.isdir(os.path.join(history, t))]
    tags.sort(key=tag_key, reverse=True)
    out = []
    for tag in tags[:max(keep, 0)]:
        d = os.path.join(history, tag)
        pk = os.path.join(d, "Packages")
        if os.path.isfile(pk):
            with open(pk, encoding="utf-8", errors="replace") as f:
                out += own_stanzas(f.read(), tag)
            continue
        for b in sorted(os.listdir(d)):
            if DEBNAME_RE.match(b):
                out.append(stanza(os.path.join(d, b), tag=tag))
    return out


def build(out, debs, minimum=None, date=None, tag=None, history=None):
    """Writes Packages, Packages.gz and Release into `out`; returns the Release text. `debs` are this release's
    (Filename `<tag>/<name>` with `tag`), `history` the older releases' (history_stanzas)."""
    if minimum is not None and not VERSION_RE.match(minimum):
        raise ValueError("--minimum must be X.Y.Z, not %r" % minimum)
    if tag is not None and not tag_key(tag):
        raise ValueError("--tag must be vX.Y.Z, not %r" % tag)
    if not debs:
        raise ValueError("no .debs")
    os.makedirs(out, exist_ok=True)
    texts, arches, seen = [], [], set()
    entries = [(stanza(deb, minimum, tag), False) for deb in debs]
    # Older releases add versions of the packages this release ships only: the releases before the rename carry
    # the old package ID, which would be a second, stray package in the source (F171 broke with it, no migration).
    names = {f.get("Package") for (_, f), _ in entries}
    entries += [(e, True) for e in history_stanzas(history, skip=tag) if e[1].get("Package") in names]
    for (text, fields), older in entries:
        # An older release's package version and arch that a newer release has again is left out: the newest wins.
        key = (fields.get("Package"), fields.get("Version"), fields.get("Architecture"))
        if older and key in seen:
            continue
        seen.add(key)
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
        "Origin: " + NAME,
        "Label: " + NAME,
        "Suite: stable",
        "Codename: ifizbox",
        "Architectures: " + " ".join(arches),
        # N11: Sileo drops a repo whose Release has no Components ("Could not parse release file", RepoManager.swift:
        # `guard ["components"].allSatisfy(releaseDict.keys.contains)`), flat or not; apt ignores it on a flat repo.
        # Chariz (flat) says main too.
        "Components: main",
        "Description: %s's own source: %s for jailbroken iPhones" % (NAME, NAME),
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


def pick_releases(releases, skip=None, keep=KEEP - 1):
    """GitHub's releases list (the API's JSON) -> [(tag, [asset names to download])] for the newest `keep` published
    vX.Y.Z releases other than `skip`: the Packages asset when there is one, else the Debian-named .debs. Drafts and
    pre-releases are left out, as releases/latest leaves them out. A release with neither is skipped."""
    out = []
    for r in releases:
        tag = r.get("tag_name") or ""
        if r.get("draft") or r.get("prerelease") or not tag_key(tag) or tag == skip:
            continue
        names = [a.get("name") or "" for a in r.get("assets") or []]
        want = ["Packages"] if "Packages" in names else sorted(n for n in names if DEBNAME_RE.match(n))
        if want:
            out.append((tag, want))
    out.sort(key=lambda x: tag_key(x[0]), reverse=True)
    return out[:max(keep, 0)]


def fetch(repo, dest, skip=None, keep=KEEP - 1, run=subprocess.run):
    """Downloads the older releases' repo files into dest/<tag>/ with the gh CLI (pick_releases). -> the tags."""
    if not re.match(r"^[\w.-]+/[\w.-]+$", repo):
        raise ValueError("repo must be owner/name, not %r" % repo)
    r = run(["gh", "api", "--paginate", "--slurp", "repos/%s/releases?per_page=100" % repo],
            capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise OSError("gh api repos/%s/releases failed: %s" % (repo, (r.stderr or "").strip()))
    pages = json.loads(r.stdout or "[]")
    releases = [x for p in pages for x in (p if isinstance(p, list) else [p])]
    picked = pick_releases(releases, skip, keep)
    for tag, names in picked:
        d = os.path.join(dest, tag)
        os.makedirs(d, exist_ok=True)
        cmd = ["gh", "release", "download", tag, "--repo", repo, "--dir", d, "--clobber"]
        for n in names:
            cmd += ["--pattern", n]
        r = run(cmd, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise OSError("gh release download %s failed: %s" % (tag, (r.stderr or "").strip()))
    return [t for t, _ in picked]


def main(argv):
    minimum = date = tag = history = skip = None
    args = []
    it = iter(argv)
    for a in it:
        if a == "--minimum":
            minimum = next(it, None)
        elif a == "--date":
            date = next(it, None)
        elif a == "--tag":
            tag = next(it, None)
        elif a == "--history":
            history = next(it, None)
        elif a == "--skip":
            skip = next(it, None)
        else:
            args.append(a)
    if args[:1] == ["fetch"]:
        if len(args) != 3:
            print(__doc__, file=sys.stderr)
            return 2
        try:
            tags = fetch(args[1], args[2], skip=skip)
        except (ValueError, OSError, subprocess.SubprocessError, json.JSONDecodeError) as e:
            print("selfrepo: %s" % e, file=sys.stderr)
            return 1
        print("selfrepo: %s: %d older release(s): %s" % (args[2], len(tags), " ".join(tags) or "none"))
        return 0
    if len(args) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        build(args[0], args[1:], minimum=minimum, date=date, tag=tag, history=history)
    except (ValueError, OSError, StopIteration) as e:
        print("selfrepo: %s" % e, file=sys.stderr)
        return 1
    with open(os.path.join(args[0], "Packages"), encoding="utf-8") as f:
        n = len(split_stanzas(f.read()))
    print("selfrepo: %s: Packages, Packages.gz, Release (%d .deb, %d stanzas)" % (args[0], len(args) - 1, n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
