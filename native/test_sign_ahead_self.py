"""B275: the queue's Re-sign of iFizBox itself (Installed > iFizBox > Modify > Re-sign) sends signing.prepare
{record: <iFizBox's id>}; its record's url is SelfIPA.url (signed from its own bundle), not http(s), so sign-ahead
must sign from the running bundle as signing.resign does, before the http(s) check that answers bad_url. The shell
can't run off the phone, so read the source."""
import os
import unittest

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


class SignAheadSelf(unittest.TestCase):
    def test_own_record_signs_from_the_bundle(self):
        src = read("SignAhead.swift")
        i = src.index("static func prepare(")
        prepare = src[i:src.index("\n    }\n", i)]
        self_at = prepare.index("if source == SelfIPA.url {")
        self.assertLess(self_at, prepare.index("Apt.httpURL(source)"))
        branch = prepare[self_at:prepare.index("\n            }\n", self_at)]
        self.assertIn("SelfIPA.make(app: Bundle.main.bundleURL", branch)
        self.assertIn("return signThat(out)", branch)
        self.assertIn("return fail(error)", branch)


if __name__ == "__main__":
    unittest.main()
