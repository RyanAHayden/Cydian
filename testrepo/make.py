#!/usr/bin/env python3
"""iFizBox's temporary test sources (delete testrepo/ once update testing is done). Run: testrepo/make.py

- apt/: a flat APT repo of tiny test packages for the jailbreak side: an Essential one in two versions (iFizBox's
  Essential Upgrade), a plain tweak in two versions (Changes, Upgrade, Downgrade), one depending on a package no
  source has (the plain-language dependency error) and one for rootful phones only (iphoneos-arm: incompatible on
  rootless). Built here without dpkg (ar + tar), Packages and Release written next to them.
- altstore.json: the AltStore test source; its IPAs are the assets of the test-fixtures pre-release (too big for git).

URLs (GitHub serves this repo's files as they are on main):
  https://raw.githubusercontent.com/RyanAHayden/iFizBox/main/testrepo/apt/        (APT, flat: dist ./)
  https://raw.githubusercontent.com/RyanAHayden/iFizBox/main/testrepo/altstore.json  (AltStore)
"""
import gzip, hashlib, io, pathlib, tarfile, time

HERE = pathlib.Path(__file__).resolve().parent
APT = HERE / "apt"
MTIME = 1794960000  # fixed, so rebuilding gives the same bytes

PKGS = [
    # (id, version, arch, extra control fields, description)
    ("com.ryha.test.essential", "1.0", "iphoneos-arm64", {"Essential": "yes"}, "Test: an essential package (old version)"),
    ("com.ryha.test.essential", "1.1", "iphoneos-arm64", {"Essential": "yes"}, "Test: an essential package; upgrading it is an Essential Upgrade"),
    ("com.ryha.test.tweak", "1.0", "iphoneos-arm64", {}, "Test: a plain tweak, old version"),
    ("com.ryha.test.tweak", "1.1", "iphoneos-arm64", {}, "Test: a plain tweak, new version (shows in Changes)"),
    ("com.ryha.test.brokendeps", "1.0", "iphoneos-arm64", {"Depends": "com.ryha.test.nowhere (>= 2.0)"},
     "Test: depends on a package no source has (the dependency error)"),
    ("com.ryha.test.rootful", "1.0", "iphoneos-arm", {}, "Test: built for rootful jailbreaks only"),
]


def tar_gz(files: dict) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.GNU_FORMAT) as t:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size, info.mtime, info.mode = len(data), MTIME, 0o644
            t.addfile(info, io.BytesIO(data))
    return gzip.compress(gzip.decompress(buf.getvalue()), mtime=0)


def ar(members: list) -> bytes:
    out = b"!<arch>\n"
    for name, data in members:
        out += f"{name:<16}{MTIME:<12}0     0     100644  {len(data):<10}`\n".encode() + data
        if len(data) % 2:
            out += b"\n"
    return out


def control(pid, ver, arch, extra, desc, name):
    fields = {"Package": pid, "Name": name, "Version": ver, "Architecture": arch, "Maintainer": "iFizBox Tests",
              "Author": "iFizBox Tests", "Section": "Tweaks", "Description": desc, **extra}
    return "".join(f"{k}: {v}\n" for k, v in fields.items())


def main():
    APT.mkdir(exist_ok=True)
    for old in APT.glob("*.deb"):
        old.unlink()
    stanzas = []
    for pid, ver, arch, extra, desc in PKGS:
        name = "Test " + pid.rsplit(".", 1)[1].capitalize()
        ctl = control(pid, ver, arch, extra, desc, name)
        data = tar_gz({f"./var/jb/usr/share/ifizbox-tests/{pid}": f"{pid} {ver}\n".encode()})
        deb = ar([("debian-binary", b"2.0\n"), ("control.tar.gz", tar_gz({"./control": ctl.encode()})), ("data.tar.gz", data)])
        fn = f"{pid}_{ver}_{arch}.deb"
        (APT / fn).write_bytes(deb)
        stanzas.append(ctl + f"Filename: ./{fn}\nSize: {len(deb)}\nMD5sum: {hashlib.md5(deb).hexdigest()}\n"
                       f"SHA256: {hashlib.sha256(deb).hexdigest()}\n")
    packages = "\n".join(stanzas).encode()
    (APT / "Packages").write_bytes(packages)
    (APT / "Packages.gz").write_bytes(gzip.compress(packages, mtime=0))
    lines = ["Origin: iFizBox Tests", "Label: iFizBox Tests", "Suite: stable", "Version: 1.0", "Codename: tests",
             "Architectures: iphoneos-arm64 iphoneos-arm", "Components: main",
             "Description: Temporary test packages for iFizBox (will be deleted)", "MD5Sum:"]
    for f in ("Packages", "Packages.gz"):
        b = (APT / f).read_bytes()
        lines.append(f" {hashlib.md5(b).hexdigest()} {len(b)} {f}")
    lines.append("SHA256:")
    for f in ("Packages", "Packages.gz"):
        b = (APT / f).read_bytes()
        lines.append(f" {hashlib.sha256(b).hexdigest()} {len(b)} {f}")
    (APT / "Release").write_text("\n".join(lines) + "\n")
    print("testrepo:", len(PKGS), "packages in", APT)


if __name__ == "__main__":
    main()
