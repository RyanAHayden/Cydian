"""B179: the app icon at every size in both builds. iOS 26 drew a blank placeholder for the sideload app's
notifications: Info.plist named an asset catalog icon (CFBundleIconName AppIcon) and the bundle had no Assets.car,
only 60pt loose PNGs. icon/assets.sh compiles icon/Assets.car (jailbreak) and icon/AssetsLite.car (sideload) on a
Mac; build.sh copies the right one and every loose size; mkdeb.py/mkipa.py check run carfile.icon_problems."""
import hashlib
import os
import plistlib
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import carfile  # noqa: E402
from test_native import plist  # noqa: E402

ICON = os.path.join(HERE, "icon")
APP = "Payload/iFizBox.app/"


def read(name):
    with open(os.path.join(ICON, name), "rb") as f:
        return f.read()


def bundle(lite):
    """The icon files build.sh puts in the app, as path -> bytes."""
    src = "AppIconLite" if lite else "AppIcon"
    files = {APP + "AppIcon%dx%d@%dx.png" % (pt, pt, s): read("%s%dx%d@%dx.png" % (src, pt, pt, s))
             for pt, scales in carfile.ICON_SIZES.items() for s in scales}
    files[APP + "Assets.car"] = read("AssetsLite.car" if lite else "Assets.car")
    return files


class Catalogs(unittest.TestCase):
    def test_every_size_in_each_car(self):
        for car, prefix in (("Assets.car", "AppIcon"), ("AssetsLite.car", "AppIconLite")):
            data = read(car)
            self.assertIn("AppIcon", carfile.facets(data), car)
            have = {(r["file"], r["width"], r["height"]) for r in carfile.renditions(data)}
            for pt, scales in carfile.ICON_SIZES.items():
                for s in scales:
                    name = "%s%dx%d@%dx.png" % (prefix, pt, pt, s)
                    self.assertIn((name, pt * s, pt * s), have, car)
            self.assertIn((prefix + "1024.png", 1024, 1024), have, car)

    def test_cars_compiled_from_the_current_pngs(self):
        """icon/assets.sources is written with the .car files: a changed PNG means rerunning icon/assets.sh."""
        with open(os.path.join(ICON, "assets.sources")) as f:
            recorded = dict(reversed(line.split()) for line in f if line.strip())
        pngs = sorted(n for n in os.listdir(ICON) if n.startswith("AppIcon") and n.endswith(".png"))
        self.assertEqual(sorted(recorded), pngs, "rerun native/icon/assets.sh <mac host>")
        for name in pngs:
            self.assertEqual(recorded[name], hashlib.sha256(read(name)).hexdigest(),
                             "%s changed since Assets.car was compiled: rerun native/icon/assets.sh" % name)

    def test_loose_pngs_at_every_size(self):
        for src in ("AppIcon", "AppIconLite"):
            for pt, scales in carfile.ICON_SIZES.items():
                for s in scales:
                    name = "%s%dx%d@%dx.png" % (src, pt, pt, s)
                    self.assertEqual(carfile.png_size(read(name)), (pt * s, pt * s), name)


class Bundle(unittest.TestCase):
    def setUp(self):
        self.info = plistlib.loads(plist())

    def test_good_bundles(self):
        self.assertEqual(carfile.icon_problems(self.info, bundle(False), APP, lite=False), [])
        self.assertEqual(carfile.icon_problems(self.info, bundle(True), APP, lite=True), [])

    def test_icon_name_without_catalog(self):
        """The bug: CFBundleIconName set, no Assets.car."""
        files = bundle(True)
        del files[APP + "Assets.car"]
        self.assertTrue(any("no Assets.car" in p for p in carfile.icon_problems(self.info, files, APP, lite=True)))

    def test_only_60pt_listed(self):
        self.info["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconFiles"] = ["AppIcon60x60"]
        problems = carfile.icon_problems(self.info, bundle(False), APP, lite=False)
        self.assertIn("Info.plist CFBundleIconFiles has no AppIcon20x20", problems)

    def test_missing_notification_size(self):
        files = bundle(False)
        del files[APP + "AppIcon20x20@3x.png"]
        self.assertIn("icon AppIcon20x20@3x.png missing or not 60 px",
                      carfile.icon_problems(self.info, files, APP, lite=False))

    def test_wrong_builds_catalog(self):
        files = bundle(False)
        files[APP + "Assets.car"] = read("AssetsLite.car")
        self.assertTrue(any("sideload build's icon" in p for p in carfile.icon_problems(self.info, files, APP, lite=False)))
        files = bundle(True)
        files[APP + "Assets.car"] = read("Assets.car")
        self.assertTrue(any("jailbreak build's icon" in p for p in carfile.icon_problems(self.info, files, APP, lite=True)))

    def test_no_icon_name(self):
        del self.info["CFBundleIcons"]["CFBundlePrimaryIcon"]["CFBundleIconName"]
        self.assertTrue(carfile.icon_problems(self.info, bundle(False), APP, lite=False))

    def test_unreadable_car(self):
        files = bundle(False)
        files[APP + "Assets.car"] = b"BOMStore" + b"\0" * 40
        self.assertTrue(any("unreadable" in p for p in carfile.icon_problems(self.info, files, APP, lite=False)))


if __name__ == "__main__":
    unittest.main()
