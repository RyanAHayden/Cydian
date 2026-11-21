"""B284: the sideload build's paired UDID survives deleting and reinstalling the app. PhoneID.swift keeps it in the
Keychain beside UserDefaults, reads it back on a fresh container and backfills the Keychain from a container that
had it before."""
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


class PhoneKeep(unittest.TestCase):
    src = read("Sources", "PhoneID.swift")

    def test_remember_keeps_it(self):
        self.assertIn("keepUDID(u)", body(self.src, "static func remember("))

    def test_read_restores_and_backfills(self):
        b = body(self.src, "private static func read()")
        self.assertIn("keepUDID(u); return .udid(u)", b)  # paired before B284: into the Keychain
        self.assertIn("keptUDID()", b)
        self.assertIn("UserDefaults.standard.set(u, forKey: udidKey)", b)  # fresh container: back in UserDefaults
        self.assertLess(b.index("keptUDID()"), b.index("embedded"))  # before the profile's guess

    def test_this_device_only_in_own_group(self):
        b = body(self.src, "static func keepUDID(")
        self.assertIn("OwnKeychain.scoped(keepQuery)", b)
        self.assertIn("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly", b)


if __name__ == "__main__":
    unittest.main()
