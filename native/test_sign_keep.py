"""B276: the sideload build's signing setup survives deleting and reinstalling the app. The identity stays in the
Keychain on its own; SignStore.swift also keeps what picks it out (the certificate's SHA-256, certKey) and the profile
there, puts them back on a fresh container before the identity or profile is looked up, and Remove Certificate
deletes them."""
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*p):
    with open(os.path.join(HERE, *p)) as f:
        return f.read()


def body(src, head):
    """The braces-balanced body after the first line containing `head`."""
    i = src.index(head)
    j = src.index("{", i)
    depth = 0
    for k in range(j, len(src)):
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        if depth == 0:
            return src[j:k + 1]
    raise AssertionError(head)


class SignKeep(unittest.TestCase):
    src = read("Sources", "SignStore.swift")

    def test_lookups_restore_first(self):
        for head in ("static func identity()", "static func profile()", "static func exportP12()"):
            b = body(self.src, head)
            self.assertIn("_ = restored", b, head)
            if "certKey" in b:
                self.assertLess(b.index("_ = restored"), b.index("certKey"), head)

    def test_import_keeps_both(self):
        b = body(self.src, "static func importIdentity(")
        self.assertIn("keepSetup(certSHA256:", b)
        self.assertLess(b.index("profileData.write(to: profileURL"), b.index("keepSetup("))

    def test_restore_puts_back_and_backfills(self):
        b = self.src[self.src.index("static let restored: Void"):]
        b = b[:b.index("}()") + 3]
        self.assertIn("defaults.set(kept, forKey: certKey)", b)  # fresh container: certKey back
        self.assertIn("writeKept(keepCertAccount, Data(want.utf8))", b)  # imported before B276: into the Keychain
        self.assertIn("kept.write(to: profileURL", b)
        self.assertIn("writeKept(keepProfileAccount, file)", b)
        self.assertIn("p12CertSHA256()", b)  # the F73 .p12 item names the certificate too

    def test_remove_deletes_them(self):
        b = body(self.src, "static func removeIdentity()")
        self.assertIn("writeKept(keepCertAccount, nil)", b)
        self.assertIn("writeKept(keepProfileAccount, nil)", b)

    def test_this_device_only_in_own_group(self):
        b = body(self.src, "static func writeKept(")
        self.assertIn("OwnKeychain.scoped(q)", b)
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", b)


if __name__ == "__main__":
    unittest.main()
