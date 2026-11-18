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
        self.assertIn("serveAndOpen(out, app: s.app, record: record, log: log,", install)


if __name__ == "__main__":
    unittest.main()
