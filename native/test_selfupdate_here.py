"""B159: iFizBox's own update on the This iPhone route (Sideload.swift installHere, installd over LocalDevVPN or
Tailscale RemotePairing). iOS 17.4+ installd doesn't end the running copy: it waits until it is gone. So installHere
feeds installd's copy and percentages to HereClose (native/sign/SelfCloseClock.swift decides, tested in Swift by
test_sideload.py), which answers the install call and then closes iFizBox through CloseForUpdate.hereReady, as the
hosted route's CloseForUpdate does. Checked as text: Sideload.swift only builds with the iOS SDK."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def block(src, start, end="\n    }\n"):
    s = src[src.index(start):]
    return s[:s.index(end)]


class HereSelfClose(unittest.TestCase):
    def setUp(self):
        self.side = read("Sources", "Sideload.swift")

    def test_install_here_reaches_close_for_update(self):
        here = block(self.side, "static func installHere")
        self.assertIn("let closer: HereClose? = isSelf ? HereClose(job: job)", here)
        self.assertIn("CloseForUpdate.hereReady()", here)
        self.assertIn("CloseForUpdate.hereBegan(app: app)", here)
        # the copy's end and installd's percentages drive it
        self.assertIn("if p >= 1 { closer?.copied() }", here)
        self.assertIn("closer?.installd(p)", here)
        # the call answers before iFizBox exits, and a late installd answer doesn't answer it twice
        fire = here[here.index("HereClose(job: job) {"):here.index("} : nil")]
        self.assertLess(fire.index("opened(.success((app, record)))"), fire.index("CloseForUpdate.hereReady()"))
        self.assertIn("if closer?.end() == true { return }", here)
        self.assertIn("CloseForUpdate.hereEnded()", here)

    def test_close_for_update_here_states(self):
        ready = block(self.side, "static func hereReady()")
        self.assertIn("guard state == .waiting", ready)
        self.assertIn("set(.finished)", ready)
        self.assertIn("closeWith(c, after: 3, exitAfter: hereExit)", ready)
        began = block(self.side, "static func hereBegan(")
        self.assertIn("run += 1", began)  # an older hosted run's polls stop
        self.assertIn("set(.waiting)", began)
        ended = block(self.side, "static func hereEnded()")
        self.assertIn("sinks = sinks.filter { $0(nil) }", ended)  # signing.selfUpdate answers null
        close = block(self.side, "private static func closeWith")
        self.assertIn("exit(0)", close)
        self.assertIn("deadline: .now() + exitAfter", close)

    def test_here_close_uses_the_clock(self):
        hc = self.side[self.side.index("final class HereClose"):]
        hc = hc[:hc.index("\n}\n")]
        self.assertIn("SelfCloseClock()", hc)
        self.assertIn("self.clock.due(Date())", hc)
        self.assertIn("self.job?.cancelled != true", hc)  # a cancelled job never closes iFizBox
        self.assertIn("SelfCloseClock", read("sign", "SelfCloseClock.swift"))


if __name__ == "__main__":
    unittest.main()
