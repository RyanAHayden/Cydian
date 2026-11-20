"""B189: the JS bridge answers the app's own page only.

WebKit shows window.webkit.messageHandlers.ifizbox to every frame, and repo depictions run scripts in sandboxed
iframes (web/app/screens/browse.js openHtmlDepiction, screens/depiction.js DepictionWebView). Bridge.swift must
refuse any message not from the main frame on ifizbox://app before it looks up a method.
"""
import re
import unittest
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent / "Sources" / "Bridge.swift"


def body_of(src: str, signature: str) -> str:
    """The text of the brace block that follows `signature`."""
    start = src.index(signature)
    i = src.index("{", start)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
    raise AssertionError(f"unclosed block after {signature}")


class BridgeFrames(unittest.TestCase):
    src = BRIDGE.read_text()

    def test_from_app_checks_main_frame_and_origin(self):
        body = body_of(self.src, "static func fromApp(_ frame: WKFrameInfo) -> Bool")
        self.assertIn("frame.isMainFrame", body)
        self.assertIn("securityOrigin", body)
        self.assertRegex(body, r"protocol(\.lowercased\(\))?\s*==\s*AppScheme\.scheme")
        self.assertRegex(body, r'host(\.lowercased\(\))?\s*==\s*"app"')
        self.assertIn("&&", body)  # every condition, not any one of them
        self.assertNotIn("||", body)

    def test_handler_refuses_before_anything_else(self):
        body = body_of(self.src, "func userContentController(")
        first = next(line.strip() for line in body.splitlines() if line.strip())
        self.assertTrue(re.match(r"guard Bridge\.fromApp\(message\.frameInfo\) else \{ return replyHandler\(nil, ", first),
                        f"first statement must be the frame check, got: {first}")

    def test_one_message_handler(self):
        # Every other handler would need the same check; there is only the Bridge.
        sources = Path(__file__).resolve().parent / "Sources"
        adds = [p.name for p in sources.glob("*.swift")
                for _ in re.finditer(r"addScriptMessageHandler|userContentController\.add\(", p.read_text())]
        self.assertEqual(adds, ["App.swift"])


if __name__ == "__main__":
    unittest.main()
