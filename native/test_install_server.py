"""B29: the sideload install server (Sources/InstallServer.swift) and serveAndOpen (Sources/Sideload.swift) can't run
off the phone, so read the sources for the fix: an IPA counts as served only once every byte went out over all of
iOS's requests (ByteCoverage in sign/HTTP.swift, tested in Swift by native/test_sign.py), the route stays for the
grace after that, and the install log gets the bundle ID and what iOS fetched (relayed by signing.progress)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


def body(src, start, end="\n    }\n"):
    i = src.index(start)
    return src[i:src.index(end, i)]


class InstallServerSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = read("InstallServer.swift")
        cls.sideload = read("Sideload.swift")
        cls.myipas = read("MyIPAs.swift")

    def test_served_means_every_byte(self):
        answer = body(self.server, "private func answer(")
        # The old trigger: any request reaching the last byte called onServed, and the route went with it.
        self.assertNotIn("upperBound == size - 1", answer)
        self.assertNotIn("route.onServed", answer)
        sent = body(self.server, "private func sent(")
        self.assertIn("ByteCoverage", sent)
        self.assertIn("cov.covers(size: size)", sent)
        self.assertIn("fired.insert(path)", sent)
        self.assertIn("route.onServed?()", sent)

    def test_requests_and_bytes_logged(self):
        answer = body(self.server, "private func answer(")
        self.assertIn('route.log?("iOS: ', answer)
        self.assertIn("gone[req.path]?(", answer)  # a request after serving ended says it got a 404
        self.assertIn("iOS has \\(cov.count) of \\(size) bytes", body(self.server, "private func sent("))
        self.assertIn("cutShort?(left)", body(self.server, "private func stream("))

    def test_route_kept_for_the_grace(self):
        # B30: serveAndOpen checks the manifest first; the serving moved to serveChecked.
        serve = body(self.sideload, "private static func serveChecked(", "\n    }\n\n")
        end = serve[serve.index("let end = {"):serve.index("server.serve(")]
        # Served: removed only inside the grace's asyncAfter, not at once.
        self.assertNotRegex(end, r"job\?\.end\(\)\n\s*server\.remove\(ipaPath\)")
        self.assertIn("if !ok {", end)
        grace = end[end.index("asyncAfter(deadline: .now() + servedGrace)"):]
        self.assertIn("if ok { server.remove(ipaPath) }", grace)
        self.assertIn("KeepAlive.shared.end()", grace)
        m = re.search(r"static let servedGrace: TimeInterval = (\d+)", self.sideload)
        self.assertTrue(m and int(m.group(1)) >= 60, "servedGrace")
        self.assertIn("log: serverLog", serve)
        self.assertIn('log?("Bundle ID: \\(app.bundleID)"', serve)

    def test_server_lines_reach_the_page(self):
        progress = body(self.sideload, "static func progress(")
        self.assertIn("InstallLog.attach(bid)", progress)
        self.assertIn('c.emitOnMain([["log": $0]])', progress)
        self.assertIn("InstallLog.detach(bid)", progress)
        self.assertIn("enum InstallLog", self.sideload)
        install = body(self.myipas, "static func install(")
        self.assertIn("serveAndOpen(out, server: servers.manifest, app: s.app, record: record, log: log,", install)

    def test_freeze_seen_and_listener_remade(self):
        """B89: iOS 27 froze iFizBox mid-serve and the listener's socket stayed suspended. A heartbeat sees the gap,
        the listener is re-created on the same port (the link names it), and the app's lifecycle goes to the log."""
        tick = body(self.server, "private func tick(")
        self.assertIn("InstallServer.freezeGap", tick)
        self.assertIn('revive("after the freeze")', tick)
        self.assertIn("where !fired.contains(path) { r.onFrozen?(f) }", tick)
        # notes never go through route.log: Sideload's serverLog takes any log line as iOS asking (InstallPrompt.heard)
        self.assertNotIn("route.log", tick)
        self.assertIn("r.note?(line)", body(self.server, "private func noteAll("))
        revive = body(self.server, "private func revive(")
        self.assertIn("old?.cancel()", revive)
        self.assertIn("NWEndpoint.Port(rawValue: port)", revive)
        self.assertIn('NWEndpoint.Host("127.0.0.1"), port: p)', revive)
        self.assertIn("tries: tries - 1", revive)
        beat = body(self.server, "private func startBeat(")
        for n in ("didEnterBackgroundNotification", "willEnterForegroundNotification",
                  "protectedDataWillBecomeUnavailableNotification"):
            self.assertIn(n, beat)
        self.assertIn("self.stopBeat()", body(self.server, "func stop("))
        self.assertIn("asked[req.path] = Date()", body(self.server, "private func answer("))

    def test_freeze_falls_back_to_the_server(self):
        """B89: after a freeze, an IPA iOS hasn't asked for again goes to the Signing Server's /sign/host and iOS gets
        that link; the server's status ends it, and the local 15-minute expiry doesn't while that copy is up."""
        serve = body(self.sideload, "private static func serveChecked(", "\n    }\n\n")
        self.assertIn("route.onFrozen = { f in", serve)
        self.assertIn("guard !server.asked(ipaPath, since: f.to)", serve)
        self.assertIn("hostAfterFreeze(output, remote: remote,", serve)
        self.assertIn("if !fallback.hosting { end(false) }", serve)
        self.assertIn("fallback.finish()", serve[serve.index("let end = {"):])
        host = body(self.sideload, "static func hostAfterFreeze(", "\n    }\n\n")
        self.assertIn("state.begin()", host)
        self.assertIn("copyItem(at: output, to: copy)", host)  # the local route keeps its file
        self.assertIn("InstallPrompt.open(hosted, bundleID: bid", host)
        self.assertIn("InstallPrompt.end(bid, link: hosted)", host)
        self.assertNotIn("CloseForUpdate", host)  # that closes iFizBox: only for its own update
        self.assertIn('server + "/sign/host"', body(self.sideload, "static func uploadHosted(", "\n    }\n\n"))
        self.assertIn("InstallPrompt.heard(bid)", body(self.sideload, "private static func pollHosted(", "\n    }\n\n"))


if __name__ == "__main__":
    unittest.main()
