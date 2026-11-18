"""I3: the sideload app's background update check. native/sign/tests/updates/main.swift (built with native/sign/ by
the Swift toolchain, as native/test_sign.py builds it) checks the notification text ("n Updates"), dpkg version
order, reading an AltStore source for this phone and which updates are new. The rest is checked as text, since
UIKit and BackgroundTasks only build with the iOS SDK (tools/check.sh's native build) and only run on a phone:
the task is registered at launch only where Info.plist permits it, the sideload Info.plist permits it, and the
page's updates.watch reaches the shell. Without a Swift toolchain the Swift part skips and says so."""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_sign import toolchain  # noqa: E402

SWIFTC = toolchain()


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


@unittest.skipUnless(SWIFTC, "no Swift toolchain (SWIFT_TOOLCHAIN or swiftc on PATH): native/sign/Updates.swift not tested")
class SwiftUpdates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="ifizbox-updatestest-")
        binary = os.path.join(cls.tmp, "updatestest")
        env = dict(os.environ)
        shim = os.path.join(cls.tmp, "libshim")
        if os.path.exists("/usr/lib/libncursesw.so.6") and not os.path.exists("/usr/lib/libncurses.so.6"):
            os.makedirs(shim)
            os.symlink("/usr/lib/libncursesw.so.6", os.path.join(shim, "libncurses.so.6"))
            env["LD_LIBRARY_PATH"] = shim + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
        sign = os.path.join(HERE, "sign")
        # Updates.swift is Foundation only: built alone, so a change elsewhere in native/sign/ can't hide it.
        r = subprocess.run([SWIFTC, "-module-cache-path", os.path.join(cls.tmp, "modules"),
                            os.path.join(sign, "Updates.swift"), os.path.join(sign, "tests", "updates", "main.swift"),
                            "-o", binary], capture_output=True, text=True, env=env, timeout=600)
        cls.build_error = None if r.returncode == 0 else (r.stdout + r.stderr)[-4000:]
        cls.out = None if cls.build_error else subprocess.run([binary], capture_output=True, text=True, timeout=120)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_swift(self):
        self.assertIsNone(self.build_error, self.build_error)
        self.assertEqual(self.out.returncode, 0, self.out.stdout + self.out.stderr)
        self.assertIn("ok   notification text", self.out.stdout)
        self.assertIn("all passed", self.out.stdout)


class Wiring(unittest.TestCase):
    def setUp(self):
        self.src = read("Sources", "BackgroundCheck.swift")

    def test_registered_at_launch_where_permitted(self):
        app = read("Sources", "App.swift")
        launch = app[app.index("didFinishLaunchingWithOptions"):]
        launch = launch[:launch.index("\n    }\n")]
        self.assertIn("BackgroundCheck.register()", launch)
        self.assertIn("BGTaskScheduler.shared.register(forTaskWithIdentifier: taskID", self.src)
        self.assertIn('"BGTaskSchedulerPermittedIdentifiers"', self.src)  # never registers an id iOS would crash on
        self.assertIn('taskID = "com.ryha.ifizbox.updates"', self.src)

    def test_sideload_plist_permits_it(self):
        with open(os.path.join(HERE, "Info-sideload.plist"), "rb") as f:
            p = plistlib.load(f)
        self.assertIn("com.ryha.ifizbox.updates", p["BGTaskSchedulerPermittedIdentifiers"])
        self.assertIn("fetch", p["UIBackgroundModes"])
        self.assertIn("audio", p["UIBackgroundModes"])  # F14's keep-alive stays

    def test_notification(self):
        self.assertIn("UpdateCheck.title(found.count)", self.src)
        self.assertIn("Notifications.upgradesID", self.src)  # app.badge's 0 takes it away, a tap opens Changes
        self.assertIn('"url": "#/changes"', self.src)
        self.assertIn("setTaskCompleted", self.src)
        self.assertIn("expirationHandler", self.src)

    def test_bridge(self):
        self.assertIn('b.on("updates.watch")', self.src)
        self.assertIn("BackgroundCheck.register(self)", read("Sources", "Bridge.swift"))
        js = read("..", "web", "app", "app-updates.js")
        self.assertIn('native.call("updates.watch", watch)', js)


if __name__ == "__main__":
    unittest.main()
