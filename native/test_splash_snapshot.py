"""F330: the splash in the theme by writing the app's own SplashBoard snapshots (native/Sources/Launch.swift,
Snapshot). Swift doesn't run on Linux, so this pins the contract in the source: who writes snapshots and who still
copies the bundle, which files it may touch, and the format it writes."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "Sources", "Launch.swift")).read()


def body(name):
    """The text of `static func <name>` up to the next declaration at the same depth."""
    m = re.search(r"\n    static (?:func|var) %s\b.*?\n    }\n" % re.escape(name), SRC, re.S)
    assert m, name
    return m.group(0)


class SnapshotRoute(unittest.TestCase):
    def test_used_by_ipa_and_jailbreak_from_ios16(self):
        used = body("used")
        self.assertIn("AppMode.current == .sideload", used)
        self.assertIn("#available(iOS 16, *)", used)

    def test_follow_hands_over_before_the_bundle_copy(self):
        follow = body("follow(dark")
        self.assertLess(follow.index("Snapshot.used"), follow.index('Helper.run(["launch-theme"'))
        # the snapshot route returns before the helper copies or snapshots are cleared
        route = follow[follow.index("Snapshot.used"):follow.index('Helper.run(["launch-theme"')]
        self.assertIn("return", route)

    def test_only_this_apps_snapshot_entries(self):
        snap = SRC[SRC.index("enum Snapshot"):]
        names = re.findall(r'where (name == id \|\| .*?) \{', SRC)
        self.assertEqual(len(names), 2, "clearSnapshots and Snapshot.files")
        self.assertEqual(names[0], names[1], "Snapshot.files picks the same entries clearSnapshots drops")
        self.assertIn('"/Library/SplashBoard/Snapshots"', body("files"))
        self.assertIn('hasSuffix(".ktx")', body("files"))
        self.assertNotIn("removeItem", snap, "the snapshot route never deletes a snapshot (R46: denylist)")

    def test_writes_atx_at_screen_scale(self):
        self.assertIn('static let atx = "com.apple.atx"', SRC)
        self.assertIn("CGImageDestinationCreateWithURL(url, atx as CFString", body("write"))
        self.assertIn("UIScreen.main.scale", body("render"))
        self.assertIn("removeFromSuperview", body("render"))


if __name__ == "__main__":
    unittest.main()
