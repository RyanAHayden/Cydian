"""F65: the shell's side of N5's daemon (Sources/Notifications.swift), checked as text: Swift only builds where the
iOS toolchain is (tools/check.sh's native build), and notifications only run on a jailbroken phone (see the F65
journal). Permission asked once in jailbreak mode, a tap opens the userInfo route, app.badge clears the badge."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


class Notifications(unittest.TestCase):
    def setUp(self):
        self.src = read("Sources", "Notifications.swift")

    def test_permission_once_in_jailbreak_mode(self):
        start = self.src[self.src.index("func start()"):]
        start = start[:start.index("\n    }\n")]
        self.assertIn("center.delegate = self", start)
        self.assertLess(start.index("center.delegate = self"), start.index("AppMode.current == .jailbreak"))
        self.assertIn("authorizationStatus == .notDetermined", start)
        self.assertIn("requestAuthorization(options: [.alert, .badge, .sound])", start)
        app = read("Sources", "App.swift")
        launch = app[app.index("didFinishLaunchingWithOptions"):]
        launch = launch[:launch.index("\n    }\n")]
        self.assertIn("Notifications.shared.start()", launch)

    def test_tap_opens_the_route(self):
        self.assertIn('userInfo["url"]', self.src)
        self.assertIn('c.userInfo = @{@"url": @"#/changes"}', read("daemon", "main.m"))
        self.assertIn('location.hash = route', self.src)
        self.assertIn('arguments: ["route": route]', self.src)  # passed as data, never pasted into the script
        self.assertIn('upgradesID = "ifizbox-upgrades"', self.src)
        self.assertIn('#define NOTE_ID @"ifizbox-upgrades"', read("daemon", "main.m"))
        allowed = re.search(r'CharacterSet\(charactersIn: "([^"]+)"\)', self.src).group(1)
        self.assertNotIn("'", allowed)
        self.assertNotIn('\\', allowed)

    def test_badge_bridge(self):
        self.assertIn('b.on("app.badge")', self.src)
        self.assertIn("setBadgeCount(n)", self.src)
        self.assertIn("removeDeliveredNotifications(withIdentifiers: [upgradesID])", self.src)
        self.assertIn("Notifications.register(self)", read("Sources", "Bridge.swift"))


if __name__ == "__main__":
    unittest.main()
