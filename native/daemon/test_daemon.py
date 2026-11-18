"""N5: ifizbox-upgrades' rules (upgrades.c) built with the host's C compiler and run through test_driver.c: the
upgrade count from apt's plan, names from dpkg's status, the notification's words, when to
notify and when a check is due; and the launchd job, entitlements and package scripts that ship it.
The daemon itself (main.m: apt, UserNotifications, launchd) only runs on a jailbroken phone: see the N5 journal."""
import os
import plistlib
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(HERE)
CC = shutil.which(os.environ.get("CC", "cc")) or shutil.which("clang") or shutil.which("gcc")
DAY = 86400

PLAN = """\
NOTE: This is only a simulation!
Reading package lists...
Calculating upgrade...
The following NEW packages will be installed:
  libnew
The following packages will be upgraded:
  com.ex.tweak libfoo
2 upgraded, 1 newly installed, 0 to remove and 1 not upgraded.
Inst libnew (1.0 Repo:1.0/stable [iphoneos-arm64])
Inst com.ex.tweak [1.0] (1.2 Example:1.0/stable [iphoneos-arm64])
Inst libfoo:iphoneos-arm64 [2:3.1-1] (2:3.2-1 Procursus:1.0/1900 [iphoneos-arm64]) []
Inst same.version [1.0] (1.0 Repo [iphoneos-arm64])
Remv old.thing [0.9]
Conf libnew (1.0 Repo:1.0/stable [iphoneos-arm64])
Conf com.ex.tweak (1.2 Example:1.0/stable [iphoneos-arm64])
"""

STATUS = """\
Package: com.ex.tweak
Status: install ok installed
Name: Example Tweak
Version: 1.0

Package: libfoo
Status: install ok installed
Version: 2:3.1-1

Package: old.thing
Status: deinstall ok config-files
Name: Old Thing
Version: 0.9
"""


def inst(i, frm="1.0", to="1.1"):
    return "Inst pkg%d [%s] (%s Repo [iphoneos-arm64])\n" % (i, frm, to)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Rules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.driver = os.path.join(cls.tmp, "test_driver")
        subprocess.run([CC, "-std=c11", "-Wall", "-Wextra", "-Werror", "-O1", "-o", cls.driver,
                        os.path.join(HERE, "test_driver.c"), os.path.join(HERE, "upgrades.c")],
                       check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def file(self, name, text):
        if text is None:
            return "-"
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def check(self, plan, status=None, state=None, now=1_800_000_000):
        r = subprocess.run([self.driver, "check", self.file("plan", plan), self.file("status", status),
                            self.file("state", state), str(now)], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = {"items": [], "state": []}
        for line in r.stdout.splitlines():
            if line.startswith("item "):
                out["items"].append(line[5:].split(" ", 3))
            elif line.startswith("state "):
                out["state"].append(line[6:])
            else:
                k, v = line.split("=", 1)
                out[k] = int(v) if k in ("n", "fresh", "due") else v
        return out

    # --- the count

    def test_upgrades_in_the_plan(self):
        r = self.check(PLAN, STATUS)
        self.assertEqual(r["n"], 2)
        self.assertEqual(r["items"], [["com.ex.tweak", "1.0", "1.2", "Example Tweak"],
                                      ["libfoo", "2:3.1-1", "2:3.2-1", ""]])

    def test_nothing_to_upgrade(self):
        for plan in ("", "Reading package lists...\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n",
                     "Inst libnew (1.0 Repo [iphoneos-arm64])\n"):
            r = self.check(plan)
            self.assertEqual((r["n"], r["items"], r["fresh"], r["title"], r["body"]), (0, [], 0, "0 Upgrades", ""))

    def test_odd_lines_are_skipped(self):
        plan = ("Inst \nInst x\nInst x [\nInst x [1.0]\nInst x [1.0] (\nInst x [] (1.1 R)\n"
                "Inst  [1.0] (1.1 R)\nInstall y [1.0] (1.1 R)\n  Inst z [1.0] (1.1 R)\nInst ok [1.0] (1.1 R)")
        self.assertEqual(self.check(plan)["items"], [["ok", "1.0", "1.1", ""]])

    def test_crlf_and_overlong_fields(self):
        r = self.check("Inst a [1.0] (1.1 R)\r\nInst %s [1.0] (1.1 R)\r\n" % ("b" * 300), "Package: a\r\nStatus: install ok installed\r\nName: A\r\n")
        self.assertEqual(r["items"], [["a", "1.0", "1.1", "A"]])

    def test_more_than_kept(self):
        r = self.check("".join(inst(i) for i in range(2100)))
        self.assertEqual((r["n"], len(r["items"]), len(r["state"])), (2100, 2048, 2049))
        self.assertEqual(r["body"], "2100 upgrades: pkg0, pkg1, pkg2 and 2097 more.")

    def test_names_only_from_installed_stanzas(self):
        status = STATUS.replace("Package: libfoo\n", "Package: libfoo\nName: Foo Library\n").replace(
            "Status: install ok installed\nName: Example", "Status: install ok not-installed\nName: Example")
        r = self.check(PLAN, status)
        self.assertEqual([i[3] for i in r["items"]], ["", "Foo Library"])
        # The last stanza needs no blank line after it.
        r = self.check(PLAN, "Package: libfoo\nName: Foo\nStatus: install ok installed")
        self.assertEqual(r["items"][1][3], "Foo")

    # --- the words

    def test_title_and_body(self):
        cases = {
            1: ("1 Upgrade", "pkg0 1.1 is available."),
            2: ("2 Upgrades", "2 upgrades: pkg0 and pkg1."),
            3: ("3 Upgrades", "3 upgrades: pkg0, pkg1 and pkg2."),
            4: ("4 Upgrades", "4 upgrades: pkg0, pkg1, pkg2 and 1 more."),
        }
        for n, (title, body) in cases.items():
            r = self.check("".join(inst(i) for i in range(n)))
            self.assertEqual((r["title"], r["body"]), (title, body), n)
        r = self.check(PLAN, STATUS)
        self.assertEqual(r["body"], "2 upgrades: Example Tweak and libfoo.")
        r = self.check(PLAN.replace("Inst libfoo", "Xnst libfoo"), STATUS)
        self.assertEqual((r["title"], r["body"]), ("1 Upgrade", "Example Tweak 1.2 is available."))

    # --- when to notify

    def test_fresh(self):
        self.assertEqual(self.check(PLAN)["fresh"], 1)
        state = "last 1\ncom.ex.tweak=1.2\nlibfoo=2:3.2-1\n"
        self.assertEqual(self.check(PLAN, state=state)["fresh"], 0)
        # One of them installed since: nothing new either.
        self.assertEqual(self.check(PLAN.replace("Inst libfoo", "Xnst libfoo"), state=state)["fresh"], 0)
        # A newer version, or a new package, is.
        self.assertEqual(self.check(PLAN.replace("(1.2 Example", "(1.3 Example"), state=state)["fresh"], 1)
        self.assertEqual(self.check(PLAN + inst(9), state=state)["fresh"], 1)
        # A key must match a whole line, not a prefix of one.
        self.assertEqual(self.check(PLAN, state="com.ex.tweak=1.20\nlibfoo=2:3.2-1x\n")["fresh"], 1)
        self.assertEqual(self.check(PLAN, state="xcom.ex.tweak=1.2\nlibfoo=2:3.2-1\n")["fresh"], 1)

    def test_state(self):
        self.assertEqual(self.check(PLAN, now=1234)["state"], ["last 1234", "com.ex.tweak=1.2", "libfoo=2:3.2-1"])
        self.assertEqual(self.check("", now=5)["state"], ["last 5"])

    def test_due(self):
        now = 1_800_000_000
        due = lambda state: self.check("", state=state, now=now)["due"]
        self.assertEqual(due(None), 1)
        self.assertEqual(due(""), 1)
        self.assertEqual(due("garbage\n"), 1)
        self.assertEqual(due("last %d\n" % (now - 3600)), 0)
        self.assertEqual(due("last %d\nx=1\n" % (now - 23 * 3600 + 1)), 0)
        self.assertEqual(due("x=1\nlast %d\n" % (now - 23 * 3600)), 1)
        self.assertEqual(due("last %d\n" % (now + 600)), 1)  # the clock went back


class Packaging(unittest.TestCase):
    """What ships the daemon in the .deb: the launchd job, the entitlements, stage.sh's paths, postinst and prerm."""

    def read(self, *parts):
        with open(os.path.join(NATIVE, *parts), "rb") as f:
            return f.read()

    def test_launchd_job(self):
        job = plistlib.loads(self.read("daemon", "com.ryha.ifizbox.upgrades.plist"))
        self.assertEqual(job["Label"], "com.ryha.ifizbox.upgrades")
        self.assertEqual(job["ProgramArguments"], ["/var/jb/usr/libexec/ifizbox/ifizbox-upgrades"])
        self.assertEqual(job.get("UserName"), "root")
        self.assertTrue(job["RunAtLoad"])
        # Started often enough that the 23-hour rule gives a check at least once every 24 hours.
        with open(os.path.join(HERE, "upgrades.h")) as f:
            interval = int(re.search(r"#define UPD_INTERVAL \((\d+) \* 3600\)", f.read()).group(1)) * 3600
        self.assertLessEqual(job["StartInterval"] + interval, DAY)

    def test_entitlements(self):
        ents = plistlib.loads(self.read("daemon", "entitlements.plist"))
        self.assertEqual(ents["com.apple.private.usernotifications.bundle-identifiers"], ["com.ryha.ifizbox"])
        self.assertNotIn("com.apple.private.persona-mgmt", ents)  # root comes from launchd, not a persona spawn

    def test_stage_paths_and_build(self):
        stage = self.read("daemon", "stage.sh").decode()
        self.assertIn("$root/var/jb/usr/libexec/ifizbox/ifizbox-upgrades", stage.replace("exe=", ""))
        self.assertIn("com.ryha.ifizbox.upgrades.plist", stage)
        build = self.read("build.sh").decode()
        deb_part = build[build.index('if [ "$what" != ipa ]'):build.index('if [ "$what" != deb ]')]
        self.assertIn('daemon/stage.sh "$root"', deb_part)  # the .deb only: the sideload IPA has no daemon

    def test_scripts(self):
        job = "/var/jb/Library/LaunchDaemons/com.ryha.ifizbox.upgrades.plist"
        self.assertIn(b"launchctl load " + job.encode(), self.read("deb", "postinst"))
        prerm = self.read("deb", "prerm").decode()
        self.assertIn("launchctl unload " + job, prerm)
        self.assertLess(prerm.index('if [ "$1" = remove ]'), prerm.index("launchctl unload"))


if __name__ == "__main__":
    unittest.main()
