#!/usr/bin/env bash
# The macOS SDK for tools/setup/release.sh on Linux: pull the part of MacOSX.sdk the setup command links against out
# of Apple's Command Line Tools or Xcode download, so a release needs no Mac.
#
#   tools/setup/macos-sdk.sh FILE [DEST]          extract to DEST, then print the MACOS_SDK line to set
#   tools/setup/macos-sdk.sh --full FILE [DEST]   the whole SDK, not just the part release.sh needs
#
# FILE: Command_Line_Tools_for_Xcode_*.dmg (needs 7z), the "Command Line Tools.pkg" inside it, or an Xcode .xip.
# Get them from https://developer.apple.com/download/all/ (an Apple ID is enough); the CLT .dmg is the small one.
# DEST defaults to ${XDG_DATA_HOME:-~/.local/share}/ifizbox/MacOSX.sdk. It's Apple's SDK: never commit it.
#
# Kept (about 90 MB): usr/lib, usr/include, SDKSettings.*, and the CoreFoundation, Security, SystemConfiguration,
# CoreServices and IOKit frameworks. When FILE holds several SDKs (a CLT .pkg ships two macOS versions), the newest.
# Needs python3 (stdlib). Streamed: a .pkg is a xar archive whose *SDK*.pkg/Payload members are pbzx (or gzip)
# cpio archives; an .xip is a xar archive whose Content member is one. Only SDK entries are written.
set -euo pipefail

usage() { sed -n '2,10s/^# \{0,1\}//p' "$0" >&2; exit 2; }
full=0
case ${1:-} in
  -h|--help|"") usage ;;
  --full) full=1; shift ;;
esac
[ $# -ge 1 ] && [ $# -le 2 ] || usage
[ -f "$1" ] || { echo "macos-sdk.sh: no such file: $1" >&2; usage; }
command -v python3 >/dev/null || { echo "macos-sdk.sh: needs python3" >&2; exit 1; }
src=$1
dest=$(python3 -I -c 'import os, sys; print(os.path.abspath(sys.argv[1]))' "${2:-${XDG_DATA_HOME:-$HOME/.local/share}/ifizbox/MacOSX.sdk}")
if [ -e "$dest" ] || [ -L "$dest" ]; then echo "macos-sdk.sh: $dest exists; remove it or give another DEST" >&2; exit 1; fi
mkdir -p "$(dirname "$dest")"

# a .dmg: let 7z pull the .pkg out of it (HFS+/APFS in UDIF is beyond a stdlib script)
dmgdir=
cleanup() { [ -z "$dmgdir" ] || rm -rf "$dmgdir"; }
trap cleanup EXIT
if [ "$(head -c 4 "$src" | od -An -c | tr -d ' ')" != 'xar!' ]; then
  case $src in
    *.dmg|*.DMG)
      command -v 7z >/dev/null || { echo "macos-sdk.sh: a .dmg needs 7z (p7zip); or give the .pkg inside it" >&2; exit 1; }
      dmgdir=$(mktemp -d "$(dirname "$dest")/.macos-sdk-dmg-XXXXXX")
      7z x -y -bd -o"$dmgdir" "$src" '*.pkg' -r >"$dmgdir/.7z.log" 2>&1 ||
        { tail -n 5 "$dmgdir/.7z.log" >&2; echo "macos-sdk.sh: 7z couldn't open $src" >&2; exit 1; }
      src=$(find "$dmgdir" -type f -name '*.pkg' -size +1M -printf '%s %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)
      [ -n "$src" ] || { echo "macos-sdk.sh: no .pkg in $1" >&2; exit 1; } ;;
  esac
fi

python3 -I -c '
import gzip, io, json, lzma, os, re, shutil, struct, sys, tempfile, zlib, bz2
import xml.etree.ElementTree as ET

src, dest, full = sys.argv[1], sys.argv[2], sys.argv[3] == "1"

def die(msg):
    sys.exit("macos-sdk.sh: " + msg)

# --- xar ----------------------------------------------------------------------------------------------------
def xar_toc(f):
    """(heap offset, [(path, data element)]) for every member with data; paths are joined with /."""
    head = f.read(28)
    if len(head) < 28 or head[:4] != b"xar!":
        die("not a xar archive (.pkg or .xip)")
    hsize, _ver, toc_c, _toc_u = struct.unpack(">HHQQ", head[4:24])
    f.seek(hsize)
    toc = ET.fromstring(zlib.decompress(f.read(toc_c)))
    out = []
    def walk(node, prefix):
        for fe in node.findall("file"):
            name = prefix + (fe.findtext("name") or "")
            if fe.find("data") is not None:
                out.append((name, fe.find("data")))
            walk(fe, name + "/")
    for t in toc.iter("toc"):
        walk(t, "")
    return hsize + toc_c, out

class Slice:
    """A file object over f[off:off+length]."""
    def __init__(self, f, off, length):
        self.f, self.left = f, length
        f.seek(off)
    def read(self, n=-1):
        n = self.left if n < 0 else min(n, self.left)
        b = self.f.read(n)
        self.left -= len(b)
        return b

def member(f, heap, data):
    """A file object over a xar member, decoded (stored, zlib, gzip, bzip2)."""
    s = Slice(f, heap + int(data.findtext("offset")), int(data.findtext("length")))
    enc = data.find("encoding")
    style = enc.get("style") if enc is not None else "application/octet-stream"
    if style == "application/octet-stream":
        return s
    raw = s.read()
    if style == "application/x-gzip":                  # xar writes zlib streams under this name
        return io.BytesIO(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else zlib.decompress(raw))
    if style == "application/x-bzip2":
        return io.BytesIO(bz2.decompress(raw))
    die("xar member encoded as %s" % style)

def exact(s, n):
    b = bytearray()
    while len(b) < n:
        c = s.read(n - len(b))
        if not c:
            die("archive ends early")
        b += c
    return bytes(b)

# --- payloads: pbzx, gzip or plain cpio ---------------------------------------------------------------------
def pbzx(s):
    """Yield the decoded bytes of a pbzx stream (its magic already read), chunk by chunk."""
    chunk = struct.unpack(">Q", exact(s, 8))[0]
    while True:
        head = s.read(16)
        if not head:
            return
        if len(head) < 16:
            die("pbzx chunk header cut short")
        _flags, length = struct.unpack(">QQ", head)
        data = exact(s, length)
        if length == chunk or not data.startswith(b"\xfd7zXZ\x00"):
            yield data                                  # stored chunk
        else:
            yield lzma.decompress(data, format=lzma.FORMAT_XZ)

def chunks(s, first=b""):
    if first:
        yield first
    while True:
        b = s.read(1 << 20)
        if not b:
            return
        yield b

def payload(s):
    """The cpio bytes of a payload, as a generator of chunks."""
    magic = exact(s, 4)
    if magic == b"pbzx":
        return pbzx(s)
    if magic[:2] == b"\x1f\x8b":
        return chunks(gzip.GzipFile(fileobj=io.BufferedReader(_Prepend(magic, s))))
    if magic[:4] == b"0707":
        return chunks(s, magic)
    die("unknown payload format %r" % magic)

class _Prepend(io.RawIOBase):
    def __init__(self, head, s):
        self.head, self.s = head, s
    def readable(self):
        return True
    def readinto(self, b):
        data = self.head or self.s.read(len(b))
        if self.head:
            data, self.head = self.head[:len(b)], self.head[len(b):]
        b[:len(data)] = data
        return len(data)

class Stream:
    """Reads across the chunks of a generator, with a skip that does not keep what it passes."""
    def __init__(self, gen):
        self.gen, self.buf = gen, b""
    def read(self, n):
        while len(self.buf) < n:
            c = next(self.gen, None)
            if c is None:
                die("cpio archive ends early")
            self.buf += c
        b, self.buf = self.buf[:n], self.buf[n:]
        return b
    def skip(self, n):
        while n:
            if not self.buf:
                c = next(self.gen, None)
                if c is None:
                    die("cpio archive ends early")
                self.buf = c
            k = min(n, len(self.buf))
            self.buf, n = self.buf[k:], n - k

def cpio(s):
    """Yield (path, mode, size, stream) for each entry; the caller reads or skips `size` bytes before the next."""
    while True:
        magic = s.read(6)
        if magic == b"070707":                                  # odc: octal, no padding
            h = s.read(70)
            mode = int(h[12:18], 8)
            namesize, size = int(h[53:59], 8), int(h[59:70], 8)
            name = s.read(namesize)[:-1].decode("utf-8", "surrogateescape")
            pad = 0
        elif magic in (b"070701", b"070702"):                   # newc: hex, 4-byte padding
            h = s.read(104)
            mode = int(h[8:16], 16)
            size, namesize = int(h[48:56], 16), int(h[88:96], 16)
            name = s.read(namesize)[:-1].decode("utf-8", "surrogateescape")
            s.skip((-(110 + namesize)) % 4)
            pad = (-size) % 4
        else:
            die("bad cpio header %r" % magic)
        if name == "TRAILER!!!":
            return
        yield name, mode, size, s
        s.skip(pad)

# --- choosing and writing entries ---------------------------------------------------------------------------
# Any path ending in SDKs/MacOSX<ver>.sdk/...: CLT payloads (Library/Developer/CommandLineTools/SDKs/, or relative
# to that install location) and Xcode (Xcode.app/.../MacOSX.platform/Developer/SDKs/) alike.
SDK = re.compile(r"(?:^|/)SDKs/(MacOSX[0-9.]*\.sdk)(?:/(.*))?$")
FRAMEWORKS = ("CoreFoundation", "Security", "SystemConfiguration", "CoreServices", "IOKit")
KEEP = ("usr/lib", "usr/include", "SDKSettings.json", "SDKSettings.plist") + tuple(
    "System/Library/Frameworks/%s.framework" % fw for fw in FRAMEWORKS)

def wanted(rel):
    return full or not rel or any(rel == k or rel.startswith(k + "/") for k in KEEP)

def safe_join(root, rel):
    parts = rel.split("/")
    if rel.startswith("/") or ".." in parts:
        die("unsafe path in archive: " + rel)
    path = os.path.join(root, *parts)
    real = os.path.realpath(os.path.dirname(path))
    if real != root and not real.startswith(root + os.sep):
        die("archive path leaves the output through a symlink: " + rel)
    return path

def write_entries(s, prefix, work):
    """Write the SDK entries of one cpio stream into work; return their count."""
    n = 0
    for name, mode, size, st in cpio(s):
        name = name[2:] if name.startswith("./") else name
        m = SDK.search(prefix + name)
        kind = mode & 0o170000
        if not m or not wanted(m.group(2) or ""):
            st.skip(size)
            continue
        rel = m.group(1) + ("/" + m.group(2) if m.group(2) else "")
        path = safe_join(work, rel.rstrip("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if kind == 0o040000:
            os.makedirs(path, exist_ok=True)
        elif kind == 0o120000:
            target = st.read(size).decode("utf-8", "surrogateescape")
            if os.path.lexists(path):
                os.unlink(path)
            os.symlink(target, path)
        elif kind == 0o100000:
            with open(path, "wb") as out:
                left = size
                while left:
                    k = min(left, 1 << 20)
                    out.write(st.read(k))
                    left -= k
            os.chmod(path, mode & 0o755 | 0o600)
        else:
            st.skip(size)                    # devices, fifos: none in an SDK
            continue
        n += 1
    return n

def install_location(f, heap, members, pkg):
    """The install-location of a component package, relative, with a trailing / (or "")."""
    for name, data in members:
        if name == pkg + "/PackageInfo":
            try:
                info = ET.fromstring(member(f, heap, data).read())
            except ET.ParseError:
                return ""
            loc = (info.get("install-location") or "").strip("/")
            return loc + "/" if loc else ""
    return ""

def extract(path, work):
    work = os.path.realpath(work)
    n = 0
    with open(path, "rb") as f:
        heap, members = xar_toc(f)
        names = dict(members)
        if "Content" in names:                                         # Xcode .xip
            n += write_entries(Stream(payload(member(f, heap, names["Content"]))), "", work)
            return n
        payloads = [name for name, _ in members if name.endswith("/Payload")]
        if not payloads:
            die("no Payload or Content in the archive: is it a Command Line Tools .pkg or an Xcode .xip?")
        sdk = [p for p in payloads if "sdk" in p.lower()]
        for p in sdk or payloads:                       # the SDK packages; every package only when none is named so
            pkg = p[:-len("/Payload")]
            prefix = install_location(f, heap, members, pkg)
            n += write_entries(Stream(payload(member(f, heap, names[p]))), prefix, work)
    return n

def version(sdk):
    """The SDK version as a tuple: SDKSettings.json "Version" (Xcode names its real folder MacOSX.sdk), else the name."""
    try:
        with open(os.path.join(sdk, "SDKSettings.json"), encoding="utf-8") as f:
            v = str(json.load(f).get("Version", ""))
    except (OSError, ValueError, AttributeError):
        v = ""
    return tuple(int(x) for x in re.findall(r"[0-9]+", v or os.path.basename(sdk)))

def pick_sdk(work):
    """The newest real MacOSX*.sdk folder in work (the rest are symlinks to it or older versions)."""
    dirs = [os.path.join(work, d) for d in os.listdir(work)
            if os.path.isdir(os.path.join(work, d)) and not os.path.islink(os.path.join(work, d))]
    if not dirs:
        die("no MacOSX*.sdk in the archive")
    return max(dirs, key=lambda d: (version(d), d))

work = tempfile.mkdtemp(prefix=".macos-sdk-", dir=os.path.dirname(dest))
try:
    count = extract(src, work)
    sdk = pick_sdk(work)
    if not os.path.isdir(os.path.join(sdk, "usr", "lib")):
        die("%s has no usr/lib" % os.path.basename(sdk))
    name = "macOS " + ".".join(map(str, version(sdk))) if version(sdk) else os.path.basename(sdk)
    os.rename(sdk, dest)
finally:
    shutil.rmtree(work, ignore_errors=True)
print("%s: %s SDK, %d entries read%s" % (dest, name, count, "" if full else " (the part release.sh needs)"))
print("export MACOS_SDK=%s" % dest)
' "$src" "$dest" "$full"
