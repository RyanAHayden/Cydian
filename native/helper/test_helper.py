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

    # --- F33: addsource / removesource and cydian.sources

    def test_source_strings(self):
        good_uris = ["https://repo.example/", "http://a.b/", "https://repo.example:8443/deb/", "https://h/a/b-c_d~e/",
                     "https://repo.example/%7Euser/", "https://Repo.Example/x+y=z,1:2/", "https://a.b/x//y/"]
        bad_uris = ["", "https://repo.example", "ftp://a.b/", "HTTPS://a.b/", "file:///etc/", "https://user:pw@a.b/",
                    "https://a.b/ x/", "https://a.b/#/", "https://a.b/\n/", "https://a.b/'/", "https://a.b/[x]/",
                    "https:///", "https://-a.b/", "https://.a/", "https://a.b:/", "https://a.b:123456/",
                    "https://a.b/../", "https://a.b/x/./", "https://a.b/x/../y/", "https://a.b/x\ny/",
                    "https://a.b/" + "x" * 1012 + "/", "https://a.b/é/", "https://a.b/?q=1/", "https://a.b/;x/"]
        self.assertEqual(len("https://a.b/" + "x" * 1011 + "/"), 1024)
        self.assertEqual(self.run_driver("uri", *good_uris, "https://a.b/" + "x" * 1011 + "/"),
                         ["ok"] * (len(good_uris) + 1))
        self.assertEqual(self.run_driver("uri", *bad_uris), ["bad"] * len(bad_uris))
        good_suites = ["./", "1800", "stable", "iphoneos-arm64/1800", "sub/", "a.b_c+d-e", "x/y/"]
        bad_suites = ["", "-o", "/abs", "../", "a/../b", ".", "..", "a b", "a#b", "a\nb", "a:b", "a" * 256, "x/./"]
        self.assertEqual(self.run_driver("suite", *good_suites), ["ok"] * len(good_suites))
        self.assertEqual(self.run_driver("suite", *bad_suites), ["bad"] * len(bad_suites))
        good_comps = ["main", "contrib", "main/debian-installer", "non-free", "a1.2+3_4", "M"]
        bad_comps = ["", "-main", ".main", "main/", "a/../b", "a b", "a#", "a\n", "/main", "a" * 65, "a:b"]
        self.assertEqual(self.run_driver("component", *good_comps), ["ok"] * len(good_comps))
        self.assertEqual(self.run_driver("component", *bad_comps), ["bad"] * len(bad_comps))

    def test_source_plan(self):
        f = "/var/jb/etc/apt/sources.list.d/cydian.sources"
        self.assertEqual(self.plan("addsource", "https://r.test/", "./"), [f, "addsource", "https://r.test/", "./"])
        self.assertEqual(self.plan("addsource", "https://r.test/", "stable", "main", "extra"),
                         [f, "addsource", "https://r.test/", "stable", "main", "extra"])
        self.assertEqual(self.plan("removesource", "https://r.test/", "stable"), [f, "removesource", "https://r.test/", "stable"])
        cases = {
            ("addsource",): "needs a URI and a suite",
            ("addsource", "https://r.test/"): "needs a URI and a suite",
            ("removesource", "https://r.test/"): "needs a URI and a suite",
            ("addsource", "https://r.test", "./"): "bad URI",
            ("addsource", "-o", "./"): "bad URI",
            ("addsource", "https://r.test/\nTrusted: yes", "./"): "bad URI",
            ("addsource", "https://r.test/", "./\nTrusted: yes"): "bad suite",
            ("addsource", "https://r.test/", "stable", "main\nTrusted: yes"): "bad component",
            ("addsource", "https://r.test/", "./", "main"): "flat suite",
            ("addsource", "https://r.test/", "stable"): "needs components",
            ("addsource", "https://r.test/", "stable", *(["c"] * 17)): "too many components",
            ("removesource", "https://r.test/", "stable", "main"): "URI and a suite only",
            ("AddSource", "https://r.test/", "./"): "unknown verb",
        }
        for words, msg in cases.items():
            with self.subTest(words=words[:4]):
                out = self.plan(*words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)

    def sources_file(self, prefix):
        os.makedirs(os.path.join(prefix, "etc/apt"), exist_ok=True)  # always there on a device; sources.list.d may not be
        return os.path.join(prefix, "etc/apt/sources.list.d/cydian.sources")

    def test_sources_apply(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        f = self.sources_file(p)
        a = lambda *w: self.run_driver("apply", p, *w)[0]
        read = lambda: open(f).read()
        self.assertEqual(a("removesource", "https://r.test/", "./"), "unchanged")  # nothing there, nothing made
        self.assertFalse(os.path.exists(f))
        self.assertEqual(a("addsource", "https://r.test/", "./"), "changed")  # sources.list.d made too
        self.assertEqual(read(), "Types: deb\nURIs: https://r.test/\nSuites: ./\n")
        self.assertEqual(stat.S_IMODE(os.stat(f).st_mode), 0o644)
        self.assertEqual(a("addsource", "https://r.test/", "./"), "unchanged")
        self.assertEqual(a("addsource", "https://d.test/deb/", "stable", "main", "extra"), "changed")
        self.assertEqual(read(), "Types: deb\nURIs: https://r.test/\nSuites: ./\n\n"
                                 "Types: deb\nURIs: https://d.test/deb/\nSuites: stable\nComponents: main extra\n")
        # the same URI and suite again replaces the stanza in place (new components); another suite is another source
        self.assertEqual(a("addsource", "https://r.test/", "sub/"), "changed")
        self.assertEqual(a("addsource", "https://d.test/deb/", "stable", "main"), "changed")
        self.assertEqual(read(), "Types: deb\nURIs: https://r.test/\nSuites: ./\n\n"
                                 "Types: deb\nURIs: https://d.test/deb/\nSuites: stable\nComponents: main\n\n"
                                 "Types: deb\nURIs: https://r.test/\nSuites: sub/\n")
        self.assertEqual(a("removesource", "https://r.test/", "./"), "changed")
        self.assertEqual(a("removesource", "https://r.test/", "./"), "unchanged")
        self.assertEqual(a("removesource", "https://d.test/deb/", "stable"), "changed")
        self.assertEqual(read(), "Types: deb\nURIs: https://r.test/\nSuites: sub/\n")
        self.assertEqual(a("removesource", "https://r.test/", "sub/"), "changed")
        self.assertFalse(os.path.exists(f))  # the last one gone: no empty file for apt to read
        self.assertEqual([n for n in os.listdir(os.path.dirname(f))], [])  # no temp files left

    def test_sources_apply_concurrent(self):
        """Adds at the same time all land: the edit holds a flock on sources.list.d."""
        p = tempfile.mkdtemp(dir=self.tmp)
        f = self.sources_file(p)
        uris = [f"https://r{i}.test/" for i in range(12)]
        procs = [subprocess.Popen([self.driver, "apply", p, "addsource", u, "./"], stdout=subprocess.PIPE, text=True)
                 for u in uris]
        self.assertEqual([pr.communicate(timeout=30)[0] for pr in procs], ["changed\n"] * len(uris))
        text = open(f).read()
        self.assertEqual(sorted(l[6:] for l in text.splitlines() if l.startswith("URIs: ")), sorted(uris))

    def test_sources_apply_hand_edits(self):
        """Stanzas someone wrote by hand stay as written; only ones naming exactly this URI and suite change."""
        p = tempfile.mkdtemp(dir=self.tmp)
        f = self.sources_file(p)
        os.makedirs(os.path.dirname(f))
        hand = ("# mine\nTypes: deb deb-src\nURIs: https://r.test/ https://m.test/\nSuites: ./\n\n\n"
                "types: deb\nuris:   https://r.test/  \r\nsuites: ./\nSigned-By: /x.gpg\n   \n"
                "Types: deb\nURIs:\n https://c.test/\nSuites: ./\n")
        with open(f, "w") as fh:
            fh.write(hand)
        a = lambda *w: self.run_driver("apply", p, *w)[0]
        self.assertEqual(a("addsource", "https://r.test/", "./"), "changed")
        self.assertEqual(open(f).read(), "# mine\nTypes: deb deb-src\nURIs: https://r.test/ https://m.test/\nSuites: ./\n\n"
                                         "Types: deb\nURIs: https://r.test/\nSuites: ./\n\n"
                                         "Types: deb\nURIs:\n https://c.test/\nSuites: ./\n")
        self.assertEqual(a("removesource", "https://c.test/", "./"), "changed")  # a folded URIs field counts too
        self.assertEqual(a("removesource", "https://m.test/", "./"), "unchanged")  # in a two-URI stanza: left alone

    def test_sources_apply_refuses_odd_files(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        f = self.sources_file(p)
        os.makedirs(os.path.dirname(f))
        secret = os.path.join(self.tmp, "secret")
        with open(secret, "w") as fh:
            fh.write("root:x:0:0\n")
        os.symlink(secret, f)
        out = self.run_driver("apply", p, "addsource", "https://r.test/", "./")[0]
        self.assertTrue(out.startswith("error: can't read cydian.sources"), out)
        self.assertTrue(os.path.islink(f))
        os.unlink(f)
        os.mkdir(f)
        out = self.run_driver("apply", p, "addsource", "https://r.test/", "./")[0]
        self.assertTrue(out.startswith("error: "), out)

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

    # --- N4: the install queue (simulate / apply / respring)

    def test_queue_plan(self):
        apply_fixed = ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold",
                       "--reinstall", "--allow-downgrades", "-o", "APT::Keep-Fds::=3", "-o", "APT::Status-Fd=3"]
        self.assertEqual(self.plan("apply", "com.a.b", "com.c=1:1.0~b1+x-2", "-com.d"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", *apply_fixed, "install", "com.a.b", "com.c=1:1.0~b1+x-2",
                          "com.d-"])
        self.assertEqual(self.plan("apply", "com.a.b", fd="-1")[2:], ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o",
                         "Dpkg::Options::=--force-confold", "--reinstall", "--allow-downgrades", "install", "com.a.b"])
        # simulate: apt-get -s, no status fd even when one is open (nothing to report)
        self.assertEqual(self.plan("simulate", "com.a.b=2", "-com.d"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", "-s", "--reinstall", "--allow-downgrades", "install",
                          "com.a.b=2", "com.d-"])
        self.assertEqual(len(self.plan("apply", *[f"p{i:03d}" for i in range(256)])), 2 + 12 + 256)

    def test_queue_refusals(self):
        cases = {
            ("apply",): "no packages",
            ("simulate",): "no packages",
            ("apply", "ab-"): "bad package name",  # apt would read it as a removal
            ("apply", "ab+"): "bad package name",
            ("apply", "--purge"): "bad package name",
            ("apply", "-"): "bad package name",
            ("apply", "--ab"): "bad package name",
            ("apply", "-o"): "bad package name",
            ("apply", "-ab=1.0"): "bad package name",  # a removal takes no version
            ("apply", "ab=x1"): "bad version",
            ("apply", "ab="): "bad version",
            ("apply", "ab=1 2"): "bad version",
            ("apply", "ab=1/2"): "bad version",
            ("apply", "ab=1=2"): "bad version",
            ("apply", "ab=" + "1" * 256): "bad version",
            ("apply", "Ab=1"): "bad package name",
            ("apply", "ab:arm64"): "bad package name",
            ("apply", "ab", "-ab"): "named twice",
            ("apply", "ab=1", "ab=2"): "named twice",
            ("simulate", "ab/stable"): "bad package name",
            ("respring", "now"): "takes no arguments",
            ("apply", *[f"p{i:03d}" for i in range(257)]): "too many",
        }
        for words, msg in cases.items():
            with self.subTest(words=words[:4]):
                out = self.plan(*words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)

    def test_respring_plan(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        self.assertEqual(self.run_driver("plan", p, "3", "respring"), [f"{p}/usr/bin/killall", "killall", "-9", "backboardd"])
        os.makedirs(os.path.join(p, "usr/bin"))
        sb = os.path.join(p, "usr/bin/sbreload")
        with open(sb, "w") as f:
            f.write("#!/bin/sh\n")
        os.chmod(sb, 0o755)
        self.assertEqual(self.run_driver("plan", p, "3", "respring"), [sb, "sbreload"])

    # --- F61: selfupdate <path.deb>, dpkg -i of Cydian's own update

    def test_selfupdate_plan(self):
        d = tempfile.mkdtemp(dir=self.tmp)
        deb = os.path.join(d, "Cydian-0.2.0.deb")
        with open(deb, "wb") as f:
            f.write(b"!<arch>\n")
        self.assertEqual(self.plan("selfupdate", deb),
                         ["/var/jb/usr/bin/dpkg", "dpkg", "--force-confdef", "--force-confold", "--status-fd", "3", "-i", deb])
        self.assertEqual(self.plan("selfupdate", deb, fd="-1")[1:], ["dpkg", "--force-confdef", "--force-confold", "-i", deb])
        link = os.path.join(d, "link.deb")
        os.symlink(deb, link)
        os.makedirs(os.path.join(d, "dir.deb"))
        cases = {
            ("selfupdate",): "one .deb path",
            ("selfupdate", deb, deb): "one .deb path",
            ("selfupdate", "Cydian.deb"): "bad .deb path",  # relative
            ("selfupdate", deb[:-4] + ".ipa"): "bad .deb path",
            ("selfupdate", d + "/../x.deb"): "bad .deb path",
            ("selfupdate", d + "/./x.deb"): "bad .deb path",
            ("selfupdate", d + "/a b.deb"): "bad .deb path",
            ("selfupdate", d + "/-o.deb;x"): "bad .deb path",
            ("selfupdate", "/" + "a" * 1024 + ".deb"): "bad .deb path",
            ("selfupdate", d + "/missing.deb"): "not a regular file",
            ("selfupdate", link): "not a regular file",
            ("selfupdate", d + "/dir.deb"): "not a regular file",
        }
        for words, msg in cases.items():
            with self.subTest(words=words):
                out = self.plan(*words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)
        self.assertEqual(self.run_driver("known", "/nonexistent", "selfupdate", deb), ["all known"])

    def test_queue_known(self):
        p = self.fake_prefix()
        k = lambda *w: self.run_driver("known", p, *w)[0]
        self.assertEqual(k("apply", "com.repo.tweak=1", "installed.one", "-half"), "all known")
        self.assertEqual(k("simulate", "-com.repo.tweak"), "com.repo.tweak")  # a removal must be installed
        self.assertEqual(k("simulate", "installed.one", "-com.repo.tweak2"), "com.repo.tweak2")
        self.assertEqual(k("apply", "com.repo=1"), "com.repo")
        self.assertEqual(k("apply", "-libstdc++", "notreal"), "notreal")

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

    def test_chain_queue(self):
        """N4: apply gets CYDIA="3 1" (Cydia's finish fd) and keeps fd 3; simulate gets neither."""
        p, app, helper = self.chain_prefix()
        out = self.run_driver("spawn", helper, "apply", "com.repo.tweak=1", "-installed.one", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-get -y -o Dpkg::Options::=--force-confdef -o "
                      "Dpkg::Options::=--force-confold --reinstall --allow-downgrades -o APT::Keep-Fds::=3 "
                      "-o APT::Status-Fd=3 install com.repo.tweak=1 installed.one-", out)
        env = next(l for l in out if l.startswith("1: env: ")).split(" ", 2)[2]
        self.assertIn("CYDIA=3 1", env)
        self.assertIn("3: pmstatus:com.repo.tweak:50.0:Installing", out)
        out = self.run_driver("spawn", helper, "simulate", "com.repo.tweak", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-get -s --reinstall --allow-downgrades install com.repo.tweak", out)
        self.assertNotIn("CYDIA=", next(l for l in out if l.startswith("1: env: ")))
        out = self.run_driver("spawn", helper, "apply", "-com.repo.tweak", driver=app)
        self.assertIn("2: cydian-helper: unknown package: com.repo.tweak", out)
        self.assertEqual(out[-1], "exit: 64")

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

    def test_chain_sources(self):
        """F33: addsource/removesource through the chain edit cydian.sources and run no apt at all."""
        p, app, helper = self.chain_prefix()
        f = self.sources_file(p)
        out = self.run_driver("spawn", helper, "addsource", "https://r.test/", "stable", "main", driver=app)
        self.assertEqual(out, ["1: Added https://r.test/ stable: cydian.sources updated", "exit: 0"])
        self.assertEqual(open(f).read(), "Types: deb\nURIs: https://r.test/\nSuites: stable\nComponents: main\n")
        out = self.run_driver("spawn", helper, "addsource", "https://r.test/", "stable", "main", driver=app)
        self.assertEqual(out, ["1: Added https://r.test/ stable: nothing to change", "exit: 0"])
        out = self.run_driver("spawn", helper, "addsource", "file:///etc/", "./", driver=app)
        self.assertTrue(any("bad URI" in l for l in out), out)
        self.assertEqual(out[-1], "exit: 64")
        out = self.run_driver("spawn", helper, "removesource", "https://r.test/", "stable", driver=app)
        self.assertEqual(out[-1], "exit: 0")
        self.assertFalse(os.path.exists(f))
        out = self.run_driver("spawn", helper, "addsource", "https://r.test/", "./", driver=self.driver)
        self.assertEqual(out[-1], "exit: 77")  # the caller check comes first
        self.assertFalse(os.path.exists(f))
        os.chmod(os.path.dirname(f), 0o555)  # can't write there: exit 74, the file as it was
        try:
            if os.access(os.path.dirname(f), os.W_OK):
                self.skipTest("running as root: can't make sources.list.d unwritable")
            out = self.run_driver("spawn", helper, "addsource", "https://r.test/", "./", driver=app)
            self.assertTrue(any("can't create a temp file" in l for l in out), out)
            self.assertEqual(out[-1], "exit: 74")
        finally:
            os.chmod(os.path.dirname(f), 0o755)

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
