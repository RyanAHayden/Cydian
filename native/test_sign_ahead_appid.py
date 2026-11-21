"""B280: the IPA queue's Install/Re-sign (sign-ahead, SignAhead.sign) keeps the installed app's App ID as
Sideload.signAndOpen does (B138): an app installed under another App ID (a com.you.* profile's) is signed for that one,
so iOS takes the update instead of answering appid_mismatch, and its record keeps appID for the next Re-sign. The
signer's side (installedAppID -> SignedApp.appID) is tested in native/sign/tests/main.swift; the shell can't run off
the phone, so read the source."""
import os
import unittest

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Sources")


def read(name):
    with open(os.path.join(SRC, name)) as f:
        return f.read()


def body(src, start):
    i = src.index(start)
    return src[i:src.index("\n    }\n", i)]


class SignAheadAppID(unittest.TestCase):
    def test_sign_asks_for_the_installed_app_id(self):
        sign = body(read("SignAhead.swift"), "private static func sign(")
        ask = sign.index("signer.installedAppID = { Sideload.installedAppID($0, log: log) }")
        self.assertLess(ask, sign.index("try signer.sign(input"))

    def test_record_keeps_the_app_id(self):
        sign = body(read("SignAhead.swift"), "private static func sign(")
        rec = sign[sign.index("SignedRecord("):]
        rec = rec[:rec.index("return (app, record, output)")]
        self.assertIn("appID: app.appID", rec)


if __name__ == "__main__":
    unittest.main()
