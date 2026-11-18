"""B34: the sideload app's background check (BackgroundCheck.swift) asks for notification permission once the page
follows anything, iFizBox itself included. Before, only an app other than iFizBox asked, so a phone with nothing
else recorded could never get iFizBox's own update as a background notification or icon badge. Checked as text:
BackgroundCheck.swift only builds with the iOS SDK."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


class SelfWatchAsks(unittest.TestCase):
    def test_ask_not_gated_on_other_apps(self):
        with open(os.path.join(HERE, "Sources", "BackgroundCheck.swift")) as f:
            src = f.read()
        watch = src[src.index('b.on("updates.watch")'):]
        watch = watch[:watch.index("\n    }\n")]
        self.assertIn("if !apps.isEmpty { askOnce() }", watch)
        self.assertNotIn("$0.id !=", watch)


if __name__ == "__main__":
    unittest.main()
