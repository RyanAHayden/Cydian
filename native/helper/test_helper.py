"""N2: cydian-helper's checks (policy.c), the app-side spawn (spawn.c) and the whole chain app -> helper -> apt,
built with the host's C compiler. The persona spawn and the iOS build can't run here: see the N2 journal."""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CC = shutil.which(os.environ.get("CC", "cc")) or shutil.which("clang") or shutil.which("gcc")
FLAGS = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-D_DEFAULT_SOURCE", "-O1"]


def build(out, sources, defs=()):
    subprocess.run([CC, *FLAGS, *defs, "-o", out, *(os.path.join(HERE, s) for s in sources)], check=True,
                   capture_output=True)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Helper(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.driver = os.path.join(cls.tmp, "test_driver")
        build(cls.driver, ["test_driver.c", "policy.c", "spawn.c"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_driver(self, *args, driver=None):
        r = subprocess.run([driver or self.driver, *args], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    # --- package names

    def test_names(self):
        good = ["ab", "com.foo.bar", "libstdc++", "a0", "0ad", "x-y", "1.2+3-4", "a" * 255]
        bad = ["", "a", "-y", "--option", ".x", "+x", "Foo", "a b", "a/b", "a:arm64", "a=1.0", "a_b", "a*",
               "a\n", "a;rm", "$(x)", "é1", "a" * 256, "../x"]
        self.assertEqual(self.run_driver("name", *good), ["ok"] * len(good))
        self.assertEqual(self.run_driver("name", *bad), ["bad"] * len(bad))

    # --- verbs and the exact command run

    def plan(self, *words, fd="3"):
        return self.run_driver("plan", "/var/jb", fd, *words)

    def test_update(self):
        self.assertEqual(self.plan("update"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", "-o", "APT::Status-Fd=3", "update"])
        self.assertEqual(self.plan("update", fd="-1"), ["/var/jb/usr/bin/apt-get", "apt-get", "update"])

    def test_install_remove_upgrade(self):
        fixed = ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold",
                 "-o", "APT::Status-Fd=3"]
        self.assertEqual(self.plan("install", "com.a.b", "libstdc++"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", *fixed, "install", "com.a.b", "libstdc++"])
        self.assertEqual(self.plan("remove", "com.a.b"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", *fixed, "remove", "com.a.b"])
        self.assertEqual(self.plan("upgrade"), ["/var/jb/usr/bin/apt-get", "apt-get", *fixed, "upgrade"])

    def test_configure(self):
        self.assertEqual(self.plan("configure"), ["/var/jb/usr/bin/dpkg", "dpkg", "--force-confdef",
                                                  "--force-confold", "--status-fd", "3", "--configure", "-a"])

    def test_hold_unhold_showhold(self):
        """F22: apt-mark, with no status fd and nothing but the verb and the names."""
        self.assertEqual(self.plan("hold", "com.a.b", "libstdc++"),
                         ["/var/jb/usr/bin/apt-mark", "apt-mark", "hold", "com.a.b", "libstdc++"])
        self.assertEqual(self.plan("unhold", "com.a.b", fd="-1"), ["/var/jb/usr/bin/apt-mark", "apt-mark", "unhold", "com.a.b"])
        self.assertEqual(self.plan("showhold"), ["/var/jb/usr/bin/apt-mark", "apt-mark", "showhold"])

    def test_refusals(self):
        cases = {
            (): "no verb",
            ("dist-upgrade",): "unknown verb",
            ("-o",): "unknown verb",
            ("Update",): "unknown verb",
            ("purge", "ab"): "unknown verb",
            ("clean",): "unknown verb",
            ("markauto", "ab"): "unknown verb",
            ("Hold", "ab"): "unknown verb",
            ("showhold", "ab"): "takes no arguments",
            ("hold",): "no package names",
            ("unhold",): "no package names",
            ("hold", "-o", "Dir::Etc=/tmp"): "bad package name",
            ("hold", "ab", "--file=/tmp/x"): "bad package name",
            ("unhold", "a*"): "bad package name",
            ("update", "ab"): "takes no arguments",
            ("upgrade", "-y"): "takes no arguments",
            ("configure", "-a"): "takes no arguments",
            ("install",): "no package names",
            ("remove",): "no package names",
            ("install", "ab", "-o", "APT::Get::AllowUnauthenticated=1"): "bad package name",
            ("install", "--allow-unauthenticated", "ab"): "bad package name",
            ("install", "ab", "./x.deb"): "bad package name",
            ("remove", "ab", "--purge"): "bad package name",
            ("install", "ab:iphoneos-arm64"): "bad package name",
            ("install", "ab=1.0"): "bad package name",
            ("install", *(["ab"] * 257)): "too many",
        }
        for words, msg in cases.items():
            with self.subTest(words=words[:4]):
                out = self.plan(*words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)
        self.assertEqual(len(self.plan("install", *(["ab"] * 256))), 2 + 8 + 256)

    # --- packages must be known to dpkg (remove) or dpkg/apt (install)

    def fake_prefix(self):
        prefix = tempfile.mkdtemp(dir=self.tmp)
        os.makedirs(os.path.join(prefix, "var/lib/dpkg"))
        os.makedirs(os.path.join(prefix, "var/lib/apt/lists"))
        with open(os.path.join(prefix, "var/lib/dpkg/status"), "w") as f:
            f.write("Package: installed.one\nStatus: install ok installed\n\n"
                    "Package:   libstdc++  \r\nVersion: 1\n\nPackage: half\n")
        lists = os.path.join(prefix, "var/lib/apt/lists")
        with open(os.path.join(lists, "repo.example_._Packages"), "w") as f:
            f.write("Package: com.repo.tweak\nVersion: 1\nDepends: Package: notreal\n\nPackage: com.repo.tweak2\n")
        with open(os.path.join(lists, "repo.example_._Release"), "w") as f:
            f.write("Package: only.in.release\n")
        return prefix

    def test_known(self):
        p = self.fake_prefix()
        k = lambda *w: self.run_driver("known", p, *w)[0]
        self.assertEqual(k("install", "installed.one", "com.repo.tweak", "libstdc++", "half"), "all known")
        self.assertEqual(k("install", "com.repo.tweak", "com.repo"), "com.repo")  # no prefix or regex match
        self.assertEqual(k("install", "com.repo.twea"), "com.repo.twea")
        self.assertEqual(k("install", "notreal"), "notreal")  # only "Package:" at the start of a line counts
        self.assertEqual(k("install", "only.in.release"), "only.in.release")  # only *_Packages files
        self.assertEqual(k("remove", "installed.one", "half"), "all known")
        self.assertEqual(k("remove", "com.repo.tweak"), "com.repo.tweak")  # not installed
        self.assertEqual(k("hold", "installed.one", "libstdc++"), "all known")
        self.assertEqual(k("unhold", "half"), "all known")
        self.assertEqual(k("hold", "com.repo.tweak"), "com.repo.tweak")  # not installed: dpkg's status only
        self.assertEqual(k("unhold", "installed"), "installed")  # no prefix match
        self.assertEqual(k("showhold"), "all known")
        self.assertEqual(k("update"), "all known")
        empty = tempfile.mkdtemp(dir=self.tmp)
        self.assertEqual(self.run_driver("known", empty, "install", "ab")[0], "ab")

    # --- caller check

    def test_caller(self):
        app = os.path.join(self.tmp, "Cydian")
        other = os.path.join(self.tmp, "Other")
        for f in (app, other):
            open(f, "w").close()
        link = os.path.join(self.tmp, "Cydian-link")
        if not os.path.lexists(link):
            os.symlink(app, link)
        c = lambda *a: self.run_driver("caller", *a)[0]
        self.assertEqual(c("0", "0", "0", app, app), "ok")
        self.assertEqual(c("0", "0", "0", link, app), "ok")  # same file by device + inode
        self.assertIn("isn't Cydian", c("0", "0", "0", other, app))
        self.assertIn("can't identify", c("0", "0", "0", os.path.join(self.tmp, "gone"), app))
        self.assertIn("not root", c("501", "0", "0", app, app))
        self.assertIn("not root", c("0", "501", "0", app, app))

    # --- the chain on Linux: a stand-in Cydian spawns the helper, which runs a stand-in apt-get

    def chain_prefix(self):
        p = self.fake_prefix()
        os.makedirs(os.path.join(p, "Applications/Cydian.app"))
        os.makedirs(os.path.join(p, "usr/bin"))
        app = os.path.join(p, "Applications/Cydian.app/Cydian")
        shutil.copy(self.driver, app)
        for tool in ("apt-get", "apt-mark", "dpkg"):
            path = os.path.join(p, "usr/bin", tool)
            with open(path, "w") as f:
                f.write('#!/bin/sh\necho "argv: $0 $*"\necho "cwd: $(pwd)"\necho "env: $(env | sort | tr \'\\n\' \' \')"\n'
                        'read line && echo "stdin: $line" || echo "stdin: eof"\n'
                        'ls /proc/$$/fd | sort -n | tr \'\\n\' \' \' | sed "s/^/fds: /" >&2; echo >&2\n'
                        'echo "pmstatus:com.repo.tweak:50.0:Installing" >&3\necho "to stderr" >&2\nexit 7\n')
            os.chmod(path, 0o755)
        helper = os.path.join(p, "cydian-helper")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"', f"-DCYDIAN_ROOT_UID={os.getuid()}"])
        return p, app, helper

    def test_chain(self):
        p, app, helper = self.chain_prefix()
        out = self.run_driver("spawn", helper, "install", "com.repo.tweak", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-get -y -o Dpkg::Options::=--force-confdef -o "
                      "Dpkg::Options::=--force-confold -o APT::Status-Fd=3 install com.repo.tweak", out)
        self.assertIn("1: cwd: /", out)
        self.assertIn("1: stdin: eof", out)
        self.assertIn("3: pmstatus:com.repo.tweak:50.0:Installing", out)
        self.assertIn("2: to stderr", out)
        self.assertEqual(out[-1], "exit: 7")  # apt's own exit code comes back
        env = next(l for l in out if l.startswith("1: env: ")).split()[2:]
        names = {e.split("=", 1)[0] for e in env}
        self.assertLessEqual(names, {"PATH", "HOME", "USER", "LOGNAME", "LANG", "DEBIAN_FRONTEND", "PWD", "SHLVL",
                                     "_", "OLDPWD"})
        self.assertIn("DEBIAN_FRONTEND=noninteractive", env)
        fds = next(l for l in out if l.startswith("2: fds: ")).split()[2:]
        self.assertEqual([f for f in fds if int(f) > 3 and f != "255"], [], fds)  # only 0-3 reach apt (sh may hold one)

        out = self.run_driver("spawn", helper, "configure", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/dpkg --force-confdef --force-confold --status-fd 3 --configure -a", out)

    def test_chain_holds(self):
        p, app, helper = self.chain_prefix()
        out = self.run_driver("spawn", helper, "hold", "installed.one", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-mark hold installed.one", out)
        self.assertEqual(out[-1], "exit: 7")
        out = self.run_driver("spawn", helper, "unhold", "installed.one", "libstdc++", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-mark unhold installed.one libstdc++", out)
        out = self.run_driver("spawn", helper, "showhold", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-mark showhold", out)

    def test_chain_refuses(self):
        p, app, helper = self.chain_prefix()
        cases = [
            (app, ["install", "-o", "APT::Get::AllowUnauthenticated=1"], "bad package name", 64),
            (app, ["install", "com.repo"], "unknown package: com.repo", 64),
            (app, ["remove", "com.repo.tweak"], "unknown package: com.repo.tweak", 64),
            (app, ["shell"], "unknown verb", 64),
            (app, ["hold", "com.repo.tweak"], "unknown package: com.repo.tweak", 64),  # in a list, not installed
            (self.driver, ["update"], "isn't Cydian", 77),  # same program, but not the file at the app's path
        ]
        for parent, words, msg, code in cases:
            with self.subTest(words=words):
                out = self.run_driver("spawn", helper, *words, driver=parent)
                self.assertTrue(any(l.startswith("2: cydian-helper: ") and msg in l for l in out), out)
                self.assertEqual(out[-1], f"exit: {code}")
                self.assertFalse(any(l.startswith("1: argv") for l in out), out)

    def test_not_root(self):
        """The helper as shipped (root uid 0) refuses a normal user even when Cydian is the parent."""
        if os.getuid() == 0:
            self.skipTest("running as root")
        p, app, _ = self.chain_prefix()
        helper = os.path.join(p, "cydian-helper-uid0")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"'])
        out = self.run_driver("spawn", helper, "update", driver=app)
        self.assertIn("2: cydian-helper: not root: Cydian must spawn the helper with the root persona", out)
        self.assertEqual(out[-1], "exit: 77")

    def test_ios_build(self):
        sdk = os.environ.get("IOS_SDK")
        if not sdk or not os.path.isdir(sdk) or not shutil.which("clang"):
            self.skipTest("IOS_SDK not set: iOS build of the helper not checked")
        out = os.path.join(self.tmp, "ios")
        os.makedirs(out, exist_ok=True)
        for src, args in (("main.c", ["-c"]), ("policy.c", ["-c"]), ("spawn.c", ["-c"])):
            r = subprocess.run(["clang", "-target", "arm64-apple-ios15.0", "-isysroot", sdk, *FLAGS[:4], *args,
                                os.path.join(HERE, src), "-o", os.path.join(out, src + ".o")],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
