#!/usr/bin/env bash
# iFizBox's iOS SDK setup on Linux: pull iPhoneOS.sdk out of an Xcode .xip and make it linkable with lld.
#
#   tools/ios-sdk.sh Xcode_27.1.xip [DEST]   extract the SDK to DEST and fix its .tbd stubs
#   tools/ios-sdk.sh fix-tbd SDK             fix the .tbd stubs of an SDK that is already extracted
#
# DEST defaults to ${XDG_DATA_HOME:-~/.local/share}/ifizbox/iPhoneOS.sdk. The native build finds the SDK only through
# $IOS_SDK; the script prints the line to set it. Get the .xip from https://developer.apple.com/download/all/
# (an Apple ID is enough; take the Xcode whose Swift matches the swift.org toolchain, see docs/native.md).
#
# Needs only python3 (stdlib). Steps, all streamed, so the ~40 GB of Xcode never lands on disk:
#   1. xar: a .xip is a xar archive; its "Content" member is stored raw and holds a pbzx stream.
#   2. pbzx: a header, then chunks that are either xz streams or stored bytes; joined they form a cpio archive.
#   3. cpio (odc, as Apple writes it; newc too): only entries under
#      Xcode*.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/ are written.
#   4. .tbd fix: Xcode 27's stubs list arm64e and arm64e.x1, which lld doesn't know. An arm64 app links against
#      the arm64e system libraries, so in every target list arm64e.x1-<os> becomes arm64-<os> (or goes, when
#      arm64-<os> is already there).
set -euo pipefail

usage() { sed -n '2,9s/^# \{0,1\}//p' "$0" >&2; exit 2; }
[ $# -ge 1 ] || usage
case $1 in -h|--help) usage ;; esac
command -v python3 >/dev/null || { echo "ios-sdk.sh: needs python3" >&2; exit 1; }

if [ "$1" = fix-tbd ]; then
  [ $# -eq 2 ] && [ -d "$2" ] || usage
  mode=fix src=$2 dest=$2
else
  [ $# -le 2 ] && [ -f "$1" ] || { echo "ios-sdk.sh: no such .xip: $1" >&2; usage; }
  mode=extract src=$1 dest=${2:-${XDG_DATA_HOME:-$HOME/.local/share}/ifizbox/iPhoneOS.sdk}
fi

exec python3 -I -c '
import os, re, shutil, struct, sys, tempfile, zlib, lzma
import xml.etree.ElementTree as ET

mode, src, dest = sys.argv[1:4]

def die(msg):
    sys.exit("ios-sdk.sh: " + msg)

# --- 1. xar -------------------------------------------------------------------------------------------------
def xar_member(f, want):
    """(offset, length) of member `want` in the xar file f; it must be stored raw (a .xip stores Content so)."""
    head = f.read(28)
    if len(head) < 28 or head[:4] != b"xar!":
        die("not a xar/.xip archive")
    hsize, _ver, toc_c, _toc_u = struct.unpack(">HHQQ", head[4:24])
    f.seek(hsize)
    toc = ET.fromstring(zlib.decompress(f.read(toc_c)))
    heap = hsize + toc_c
    for node in toc.iter("file"):
        if node.findtext("name") == want and node.find("data") is not None:
            data = node.find("data")
            enc = data.find("encoding")
            style = enc.get("style") if enc is not None else "application/octet-stream"
            if style != "application/octet-stream":
                die("xar member %s is encoded as %s, expected stored" % (want, style))
            return heap + int(data.findtext("offset")), int(data.findtext("length"))
    die("no %s member in the archive" % want)

class Slice:
    """A file object over f[off:off+length]."""
    def __init__(self, f, off, length):
        self.f, self.left = f, length
        f.seek(off)
    def read(self, n):
        n = min(n, self.left)
        b = self.f.read(n)
        self.left -= len(b)
        return b

def exact(s, n):
    b = bytearray()
    while len(b) < n:
        c = s.read(n - len(b))
        if not c:
            die("archive ends early")
        b += c
    return bytes(b)

# --- 2. pbzx ------------------------------------------------------------------------------------------------
def pbzx(s):
    """Yield the decoded bytes of a pbzx stream, chunk by chunk."""
    if exact(s, 4) != b"pbzx":
        die("Content is not a pbzx stream")
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
            yield data                       # stored chunk
        else:
            yield lzma.decompress(data, format=lzma.FORMAT_XZ)

class Stream:
    """Reads across the chunks of a generator, with a skip that does not keep what it passes."""
    def __init__(self, gen):
        self.gen, self.buf = gen, b""
    def _fill(self, n):
        while len(self.buf) < n:
            c = next(self.gen, None)
            if c is None:
                return False
            self.buf += c
        return True
    def read(self, n):
        if not self._fill(n):
            die("cpio archive ends early")
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

# --- 3. cpio ------------------------------------------------------------------------------------------------
def cpio(s):
    """Yield (path, mode, size, stream) for each entry; the caller reads or skips `size` bytes before the next."""
    while True:
        magic = s.read(6)
        if magic == b"070707":                                  # odc: octal, no padding
            h = s.read(70)
            mode = int(h[12:18], 8)
            namesize, size = int(h[53:59], 8), int(h[59:70], 8)
            name = s.read(namesize)[:-1].decode("utf-8", "surrogateescape")
            yield name, mode, size, s
            pad = 0
        elif magic in (b"070701", b"070702"):                   # newc: hex, 4-byte padding
            h = s.read(104)
            mode = int(h[8:16], 16)
            size, namesize = int(h[48:56], 16), int(h[88:96], 16)
            name = s.read(namesize)[:-1].decode("utf-8", "surrogateescape")
            s.skip((-(110 + namesize)) % 4)
            yield name, mode, size, s
            pad = (-size) % 4
        else:
            die("bad cpio header %r" % magic)
        if name == "TRAILER!!!":
            return
        s.skip(pad)

SDKS = re.compile(r"^(?:\./)?Xcode[^/]*\.app/Contents/Developer/Platforms/iPhoneOS\.platform/Developer/SDKs/(.+)$")

def safe_join(root, rel):
    parts = rel.split("/")
    if rel.startswith("/") or ".." in parts:
        die("unsafe path in archive: " + rel)
    path = os.path.join(root, *parts)
    parent = os.path.dirname(path)
    real = os.path.realpath(parent)
    if real != root and not real.startswith(root + os.sep):
        die("archive path leaves the output through a symlink: " + rel)
    return path

def extract(xip, work):
    """Write the SDKs/ entries of the .xip into work; return their count."""
    work = os.path.realpath(work)
    n = 0
    with open(xip, "rb") as f:
        off, length = xar_member(f, "Content")
        s = Stream(pbzx(Slice(f, off, length)))
        for name, mode, size, st in cpio(s):
            m = SDKS.match(name)
            kind = mode & 0o170000
            if not m:
                st.skip(size)
                continue
            path = safe_join(work, m.group(1))
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

def pick_sdk(work):
    """The real iPhoneOS<ver>.sdk directory in work (iPhoneOS.sdk is usually a symlink to it)."""
    dirs = sorted(d for d in os.listdir(work)
                  if re.fullmatch(r"iPhoneOS[0-9.]*\.sdk", d) and os.path.isdir(os.path.join(work, d))
                  and not os.path.islink(os.path.join(work, d)))
    if not dirs:
        die("no iPhoneOS*.sdk in the archive: is it an Xcode .xip?")
    return os.path.join(work, dirs[-1])

# --- 4. .tbd fix --------------------------------------------------------------------------------------------
LIST = re.compile(r"\[([^\[\]]*)\]")

def fix_list(m):
    items = [i.strip() for i in m.group(1).split(",")]
    if not any(i.startswith("arm64e.x1-") for i in items):
        return m.group(0)
    out = []
    for i in items:
        if i.startswith("arm64e.x1-"):
            i = "arm64-" + i[len("arm64e.x1-"):]
        if i not in out:
            out.append(i)
    return "[ " + ", ".join(out) + " ]"

def fix_tbd_text(text):
    return LIST.sub(fix_list, text)

def fix_tbds(sdk):
    n = 0
    for root, _dirs, files in os.walk(sdk):
        for name in files:
            p = os.path.join(root, name)
            if not name.endswith(".tbd") or os.path.islink(p):
                continue
            with open(p, encoding="utf-8", errors="surrogateescape") as f:
                text = f.read()
            new = fix_tbd_text(text)
            if new != text:
                with open(p, "w", encoding="utf-8", errors="surrogateescape") as f:
                    f.write(new)
                n += 1
    return n

if mode == "fix":
    print("fixed %d .tbd stubs in %s" % (fix_tbds(dest), dest))
    sys.exit(0)

dest = os.path.abspath(dest)
if os.path.lexists(dest):
    die("%s exists; remove it or give another DEST" % dest)
os.makedirs(os.path.dirname(dest), exist_ok=True)
work = tempfile.mkdtemp(prefix=".ios-sdk-", dir=os.path.dirname(dest))
try:
    count = extract(src, work)
    sdk = pick_sdk(work)
    fixed = fix_tbds(sdk)
    os.rename(sdk, dest)
finally:
    shutil.rmtree(work, ignore_errors=True)
print("%s: %d entries, %d .tbd stubs fixed" % (dest, count, fixed))
print("export IOS_SDK=%s" % dest)
' "$mode" "$src" "$dest"
