"""Reads an asset catalog (Assets.car) far enough to list its images: a BOM store (big-endian blocks and named
B-trees) whose RENDITIONS tree maps keys to CSI renditions (a little-endian header with the pixel size, the scale
and the file name actool took the image from), and whose FACETKEYS tree holds the asset names (AppIcon).

    python3 carfile.py Assets.car      # one line per rendition: name, pixel size, scale
"""
import struct
import sys


class Bom:
    def __init__(self, data):
        if data[:8] != b"BOMStore":
            raise ValueError("not a BOM store")
        self.data = data
        _, _, index_off, _, vars_off, _ = struct.unpack_from(">6I", data, 8)
        n = struct.unpack_from(">I", data, index_off)[0]
        self.blocks = [struct.unpack_from(">II", data, index_off + 4 + 8 * i) for i in range(n)]
        self.vars = {}
        n, p = struct.unpack_from(">I", data, vars_off)[0], vars_off + 4
        for _ in range(n):
            block, size = struct.unpack_from(">IB", data, p)
            self.vars[data[p + 5:p + 5 + size].decode("latin-1")] = block
            p += 5 + size

    def block(self, i):
        off, size = self.blocks[i]
        return self.data[off:off + size]

    def tree(self, name):
        """The (key bytes, value bytes) pairs of the named B-tree, in order."""
        head = self.block(self.vars[name])
        if head[:4] != b"tree":
            raise ValueError("%s is not a tree" % name)
        node = self.block(struct.unpack_from(">I", head, 8)[0])
        while not struct.unpack_from(">H", node, 0)[0]:  # a branch: go down its first child
            node = self.block(struct.unpack_from(">I", node, 12)[0])
        out, seen = [], set()
        while True:
            _, count, forward = struct.unpack_from(">HHI", node, 0)
            for i in range(count):
                value, key = struct.unpack_from(">II", node, 12 + 8 * i)
                out.append((self.block(key), self.block(value)))
            if not forward or forward in seen:
                return out
            seen.add(forward)
            node = self.block(forward)


def renditions(data):
    """Each image rendition in the catalog as a dict: file (actool's source file name), width, height, scale."""
    out = []
    for _, value in Bom(data).tree("RENDITIONS"):
        if value[:4] != b"ISTC":
            continue
        _, _, width, height, scale = struct.unpack_from("<5I", value, 4)
        name = value[40:168].split(b"\0", 1)[0].decode("utf-8", "replace")
        out.append({"file": name, "width": width, "height": height, "scale": scale // 100})
    return out


def facets(data):
    """The catalog's asset names (FACETKEYS), e.g. ["AppIcon"]."""
    return [k.decode("utf-8", "replace") for k, _ in Bom(data).tree("FACETKEYS")]


# B179: the app icon at every iPhone size iOS asks for: point size -> scales (notifications 20pt, Settings 29pt,
# Spotlight 40pt, the home screen 60pt), and the App Store's 1024 px marketing icon.
ICON_SIZES = {20: (2, 3), 29: (2, 3), 40: (2, 3), 60: (2, 3)}


def png_size(data):
    """(width, height) of a PNG, or None if it is not one."""
    if not data.startswith(b"\x89PNG\r\n\x1a\n") or data[12:16] != b"IHDR":
        return None
    return struct.unpack_from(">II", data, 16)


def icon_problems(info, files, app, lite):
    """What's wrong with a built app's icon (empty = good). info: its Info.plist; files: path -> bytes; app: the
    .app folder's path prefix ("…/iFizBox.app/"); lite: the sideload build (its catalog holds the LITE icon)."""
    problems = []
    primary = info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {})
    stems = primary.get("CFBundleIconFiles", [])
    for pt, scales in ICON_SIZES.items():
        stem = "AppIcon%dx%d" % (pt, pt)
        if stem not in stems:
            problems.append("Info.plist CFBundleIconFiles has no %s" % stem)
        for s in scales:
            name = "%s@%dx.png" % (stem, s)
            if png_size(files.get(app + name, b"")) != (pt * s, pt * s):
                problems.append("icon %s missing or not %d px" % (name, pt * s))
    if primary.get("CFBundleIconName") != "AppIcon":
        problems.append("Info.plist CFBundleIconName is %r, want 'AppIcon'" % primary.get("CFBundleIconName"))
    car = files.get(app + "Assets.car")
    if not car:
        return problems + ["no Assets.car (iOS shows a blank icon for notifications without it)"]
    try:
        names, rends = facets(car), renditions(car)
    except (ValueError, KeyError, struct.error) as e:
        return problems + ["Assets.car unreadable: %s" % e]
    if "AppIcon" not in names:
        problems.append("Assets.car has no AppIcon (has %s)" % ", ".join(names))
    prefix = "AppIconLite" if lite else "AppIcon"
    icons = [r for r in rends if r["file"].startswith("AppIcon") and r["width"]]
    for r in icons:
        if not r["file"].startswith(prefix) or (not lite and r["file"].startswith("AppIconLite")):
            problems.append("Assets.car holds %s, the %s build's icon" % (r["file"], "jailbreak" if lite else "sideload"))
            break
    have = {(r["width"], r["scale"]) for r in icons}
    for pt, scales in ICON_SIZES.items():
        for s in scales:
            if (pt * s, s) not in have:
                problems.append("Assets.car AppIcon has no %dpt @%dx (%d px)" % (pt, s, pt * s))
    if (1024, 1) not in have:
        problems.append("Assets.car AppIcon has no 1024 px marketing icon")
    return problems


if __name__ == "__main__":
    car = open(sys.argv[1], "rb").read()
    print("assets:", ", ".join(facets(car)))
    for r in renditions(car):
        print("%-36s %4dx%-4d @%dx" % (r["file"], r["width"], r["height"], r["scale"]))
