"""B208: iFizBox's own update through the Signing Server (hosted, iOS's prompt) stuck on "Finishing the update" and
never closed. Checked as text (UIKit only builds with the iOS SDK, and the route only runs on a phone): native
CloseForUpdate can't stay in .prompt (promptLimit begins the wait whatever iFizBox heard), and once the server says
iOS started the download it closes after downloadGuess even if the finished mark never comes, instead of waiting out
finishLimit (10 minutes). The worker side (the finished mark kept with ctx.waitUntil) is in worker/test.mjs."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def cfu():
    with open(os.path.join(HERE, "Sources", "Sideload.swift"), encoding="utf-8") as f:
        side = f.read()
    return side[side.index("enum CloseForUpdate"):side.index("final class HereClose")]


def body(src, head):
    b = src[src.index(head):]
    return b[:b.index("\n    }\n")]


class HostedSelfUpdate(unittest.TestCase):
    def test_prompt_limit_begins_the_wait(self):
        src = cfu()
        limit = float(re.search(r"static let promptLimit: TimeInterval = (\d+)", src).group(1))
        start = float(re.search(r"startLimit: TimeInterval = (\d+)", src).group(1))
        self.assertLess(limit, start)
        after = body(src, "static func afterPrompt")
        self.assertIn("asyncAfter(deadline: .now() + promptLimit) { begin() }", after)
        # begin still acts only from .prompt, so the limit can't restart a wait already running
        self.assertIn("guard mine == run, state == .prompt else { return }", after)

    def test_download_without_finished_closes_in_a_minute(self):
        src = cfu()
        guess = float(re.search(r"static let downloadGuess: TimeInterval = (\d+)", src).group(1))
        finish = float(re.search(r"finishLimit: TimeInterval = (\d+)", src).group(1))
        self.assertLessEqual(guess, 60)
        self.assertLess(guess, finish)
        poll = body(src, "private static func poll(")
        self.assertIn("downloadingSince = Date(); set(.downloading)", poll)
        g = poll.index("timeIntervalSince(d) > downloadGuess")
        self.assertIn("return guess()", poll[g:g + 300])
        # the finished mark still wins when it comes
        self.assertLess(poll.index("return finish()"), g)


if __name__ == "__main__":
    unittest.main()
