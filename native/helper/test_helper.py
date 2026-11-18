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
    # F59: main.c calls ipa.c's install-ipa, test_driver.c its checks.
    if ("main.c" in sources or "test_driver.c" in sources) and "ipa.c" not in sources:
        sources = [*sources, "ipa.c"]
    # F57: main.c calls paid.c's install-paid.
    if "main.c" in sources and "paid.c" not in sources:
        sources = [*sources, "paid.c"]
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

    def test_apply_ask_plan(self):
        """F63: apply-ask is apply without the conffile options, and needs the status fd to ask on."""
        self.assertEqual(self.plan("apply-ask", "com.a.b", "-com.d"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", "-y", "--reinstall", "--allow-downgrades", "-o",
                          "APT::Keep-Fds::=3", "-o", "APT::Status-Fd=3", "install", "com.a.b", "com.d-"])
        self.assertEqual(self.plan("apply-ask", "com.a.b", fd="-1"), ["error: apply-ask needs the status fd (3) to ask on"])
        self.assertEqual(self.plan("apply-ask", "ab-"), ["error: bad package name (allowed: [a-z0-9][a-z0-9.+-]+)"])
        self.assertEqual(self.plan("apply-ask"), ["error: no packages"])

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

    def test_chain_apply_ask(self):
        """F63: apt-get gets a pipe for stdin and only the answers Y and N reach it; the helper ends when apt does,
        even while the app holds its end open."""
        p, app, helper = self.chain_prefix()

        def ask(mode, answers, *words):
            r = subprocess.run([app, "spawn-ask", mode, helper, *words], capture_output=True, text=True, timeout=30,
                               env={**os.environ, "TEST_ANSWERS": answers})
            self.assertEqual(r.returncode, 0, r.stderr)
            return r.stdout.splitlines()

        out = ask("close", "Z,D,maybe,Y", "apply-ask", "com.repo.tweak=1")
        self.assertIn(f"1: argv: {p}/usr/bin/apt-get -y --reinstall --allow-downgrades -o APT::Keep-Fds::=3 "
                      "-o APT::Status-Fd=3 install com.repo.tweak=1", out)
        self.assertIn("1: stdin: Y", out)
        self.assertEqual(out.count("2: cydian-helper: ignored an answer that isn't Y or N"), 3, out)
        self.assertIn("CYDIA=3 1", next(l for l in out if l.startswith("1: env: ")))
        self.assertEqual(out[-1], "exit: 7")
        fds = next(l for l in out if l.startswith("2: fds: ")).split()[2:]
        self.assertEqual([f for f in fds if int(f) > 3 and f != "255"], [], fds)  # the answer fd stays the helper's

        out = ask("keep", "N", "apply-ask", "com.repo.tweak")  # the app's end stays open: apt's exit ends it
        self.assertIn("1: stdin: N", out)
        self.assertEqual(out[-1], "exit: 7")
        out = ask("close", "", "apply-ask", "com.repo.tweak")  # the app gave up: apt reads end of file
        self.assertIn("1: stdin: eof", out)
        # plain apply still reads /dev/null even from a pipe
        out = ask("close", "Y", "apply", "com.repo.tweak")
        self.assertIn("1: stdin: eof", out)

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
        for src, args in (("main.c", ["-c"]), ("policy.c", ["-c"]), ("spawn.c", ["-c"]), ("ipa.c", ["-c"])):
            r = subprocess.run(["clang", "-target", "arm64-apple-ios15.0", "-isysroot", sdk, *FLAGS[:4], *args,
                                os.path.join(HERE, src), "-o", os.path.join(out, src + ".o")],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)

IPA_DIR = "/var/mobile/Library/Caches/com.ryha.cydian/ipa"
PLIST = ('<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n'
         '\t<key>CFBundleExecutable</key><string>Demo</string>\n'
         '\t<key>CFBundleIdentifier</key>\n\t<string>{}</string>\n</dict>\n</plist>\n')


@unittest.skipUnless(CC, "no C compiler on this machine")
class InstallIpa(unittest.TestCase):
    """F59: install-ipa <path>: the path allowlist, and the whole chain on Linux (unzip, ldid and installd stand-ins;
    ipa.c's installd step only prints off iOS)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.driver = os.path.join(cls.tmp, "test_driver")
        build(cls.driver, ["test_driver.c", "policy.c", "spawn.c"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_driver(self, *args, driver=None):
        r = subprocess.run([driver or self.driver, *args], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def test_paths(self):
        d = IPA_DIR
        good = [d + "/a.ipa", d + "/3F2A-11.ipa", d + "/My_App-1.2.ipa", d + "/" + "a" * 251 + ".ipa"]
        bad = ["", d, d + "/", d + "/.ipa", d + "/.x.ipa", d + "/a.IPA", d + "/a.ipa/", d + "/sub/a.ipa",
               d + "/../a.ipa", d + "/a..ipa", "/tmp/a.ipa", d + "x/a.ipa", d + "/a b.ipa", d + "/a\n.ipa",
               d + "/-a.ipa", d + "/_a.ipa", d + "/" + "a" * 252 + ".ipa", d + "/a.ipa\n", "/var/jb/etc/passwd",
               d.replace("/ipa", "") + "/a.ipa", "a.ipa", "./a.ipa"]
        self.assertEqual(self.run_driver("ipapath", d, *good), ["ok"] * len(good))
        self.assertEqual(self.run_driver("ipapath", d, *bad), ["bad"] * len(bad))

    def test_plan(self):
        ipa = IPA_DIR + "/0A1B.ipa"
        self.assertEqual(self.run_driver("plan", "/var/jb", "3", "install-ipa", ipa), [ipa, "install-ipa", ipa])
        cases = {
            ("install-ipa",): "takes one path",
            ("install-ipa", ipa, ipa): "takes one path",
            ("install-ipa", "/var/jb/etc/master.passwd"): "bad IPA path",
            ("install-ipa", IPA_DIR + "/../../../../root/x.ipa"): "bad IPA path",
            ("install-ipa", "-o"): "bad IPA path",
            ("Install-ipa", ipa): "unknown verb",
        }
        for words, msg in cases.items():
            with self.subTest(words=words):
                out = self.run_driver("plan", "/var/jb", "3", *words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)
        self.assertEqual(self.run_driver("known", "/nonexistent", "install-ipa", ipa), ["all known"])

    def test_plist_id(self):
        cases = {PLIST.format("com.example.demo"): "com.example.demo",
                 PLIST.format("Com.Example-2"): "Com.Example-2",
                 PLIST.format("a b"): "bad", PLIST.format("-x"): "bad", PLIST.format(""): "bad",
                 PLIST.format("a/../b"): "bad", PLIST.format("x" * 256): "bad",
                 "<plist><dict><key>CFBundleName</key><string>x</string></dict></plist>": "bad",
                 "<key>CFBundleIdentifier</key><integer>1</integer>": "bad", "": "bad"}
        for text, want in cases.items():
            with self.subTest(text=text[-60:]):
                f = os.path.join(self.tmp, "Info.plist")
                with open(f, "w") as fh:
                    fh.write(text)
                self.assertEqual(self.run_driver("plistid", f), [want])

    def test_appsync(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        self.assertEqual(self.run_driver("appsync", p), ["no"])
        for rel in ("Library/MobileSubstrate/DynamicLibraries", "usr/lib/TweakInject"):
            q = tempfile.mkdtemp(dir=self.tmp)
            os.makedirs(os.path.join(q, rel))
            open(os.path.join(q, rel, "AppSyncUnified-installd.dylib"), "w").close()
            self.assertEqual(self.run_driver("appsync", q), ["yes"], rel)

    def test_entitlements(self):
        """appinst's entitlements on the helper, and build.sh signs the helper with them."""
        import plistlib
        with open(os.path.join(HERE, "entitlements.plist"), "rb") as f:
            e = plistlib.load(f)
        self.assertTrue(e["platform-application"])
        self.assertEqual(e["com.apple.private.mobileinstall.allowedSPI"], ["Install", "InstallForLaunchServices"])
        self.assertEqual(e["com.apple.security.exception.mach-lookup.global-name"], ["com.apple.mobile.installd"])
        with open(os.path.join(HERE, "..", "build.sh")) as f:
            build_sh = f.read()
        self.assertIn('-Shelper/entitlements.plist "$libexec/cydian-helper"', build_sh)
        self.assertIn('--entitlements-xml-file helper/entitlements.plist "$libexec/cydian-helper"', build_sh)
        self.assertIn("helper/ipa.c", build_sh)

    # --- the chain

    def chain(self, ldid=False, appsync=False):
        base = tempfile.mkdtemp(dir=self.tmp)
        p, ipa_dir, work = (os.path.join(base, n) for n in ("prefix", "ipa", "work"))
        for d in ("Applications/Cydian.app", "usr/bin"):
            os.makedirs(os.path.join(p, d))
        os.makedirs(ipa_dir)
        os.makedirs(work)
        app = os.path.join(p, "Applications/Cydian.app/Cydian")
        shutil.copy(self.driver, app)
        unzip = os.path.join(p, "usr/bin/unzip")  # unzip -qq -o <zip> -d <dir>
        with open(unzip, "w") as f:
            f.write('#!/bin/sh\necho "unzip as $(id -u) in $(pwd)" >&2\npython3 -I -m zipfile -e "$3" "$5" || exit 9\n')
        os.chmod(unzip, 0o755)
        if ldid:
            path = os.path.join(p, "usr/bin/ldid")
            with open(path, "w") as f:
                f.write('#!/bin/sh\necho "ldid $*"\n[ -f "$2/Info.plist" ] || exit 1\n')
            os.chmod(path, 0o755)
        if appsync:
            d = os.path.join(p, "usr/lib/TweakInject")
            os.makedirs(d)
            open(os.path.join(d, "AppSyncUnified-installd.dylib"), "w").close()
        helper = os.path.join(base, "cydian-helper")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"', f"-DCYDIAN_ROOT_UID={os.getuid()}",
                                                f'-DHELPER_IPA_DIR="{ipa_dir}"', f'-DHELPER_IPA_WORK="{work}"'])
        return p, app, helper, ipa_dir, work

    def ipa(self, ipa_dir, bundle_id="com.example.demo", name="A1.ipa", app="Demo.app"):
        import zipfile
        path = os.path.join(ipa_dir, name)
        with zipfile.ZipFile(path, "w") as z:
            if app:
                z.writestr(f"Payload/{app}/Info.plist", PLIST.format(bundle_id))
                z.writestr(f"Payload/{app}/Demo", b"\xcf\xfa\xed\xfe")
        return path

    def spawn(self, app, helper, *words):
        return self.run_driver("spawn", helper, *words, driver=app)

    def assert_clean(self, work):
        self.assertEqual(os.listdir(work), [])  # the work directory goes, whatever happened

    def test_chain_adhoc(self):
        """No AppSync: ldid -s on the unpacked .app, then installd gets the .app (PackageType Developer)."""
        p, app, helper, ipa_dir, work = self.chain(ldid=True)
        out = self.spawn(app, helper, "install-ipa", self.ipa(ipa_dir))
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertTrue(any(l.startswith("1: ldid -s ") and l.endswith("/pkg/Payload/Demo.app") for l in out), out)
        self.assertIn("1: install app com.example.demo (PackageType Developer)", out)
        self.assertIn("1: Installed com.example.demo", out)
        self.assertIn("3: pmstatus:com.example.demo:100:Installed", out)
        # unzip runs in the root-owned work directory's pkg/ (as mobile on the phone; here the test's own user)
        self.assertTrue(any(l.startswith(f"2: unzip as {os.getuid()} in {work}/cydian-ipa.") and l.endswith("/pkg")
                            for l in out), out)
        self.assert_clean(work)

    def test_chain_appsync(self):
        """AppSync Unified: the IPA itself goes to installd, as appinst does; nothing is signed."""
        p, app, helper, ipa_dir, work = self.chain(ldid=True, appsync=True)
        out = self.spawn(app, helper, "install-ipa", self.ipa(ipa_dir))
        self.assertEqual(out[-1], "exit: 0", out)
        self.assertIn("1: install ipa com.example.demo", out)
        self.assertFalse(any("ldid" in l for l in out), out)
        self.assert_clean(work)

    def test_chain_cant_adhoc(self):
        """Exit 69 says the jailbreak can't install ad hoc apps: no AppSync and no ldid, or installd refuses."""
        p, app, helper, ipa_dir, work = self.chain()
        out = self.spawn(app, helper, "install-ipa", self.ipa(ipa_dir))
        self.assertEqual(out[-1], "exit: 69", out)
        self.assertTrue(any("AppSync Unified isn't installed and there's no ldid" in l for l in out), out)
        self.assertFalse(any(l.startswith("1: install ") for l in out), out)
        self.assert_clean(work)
        p, app, helper, ipa_dir, work = self.chain(ldid=True)
        out = self.spawn(app, helper, "install-ipa", self.ipa(ipa_dir, bundle_id="com.example.refused"))
        self.assertEqual(out[-1], "exit: 69", out)
        self.assertTrue(any("can't install ad hoc apps without AppSync" in l for l in out), out)
        self.assertIn("2: cydian-helper: installd: test installd refused it", out)
        self.assert_clean(work)

    def test_chain_refuses(self):
        p, app, helper, ipa_dir, work = self.chain(ldid=True)
        good = self.ipa(ipa_dir)
        link = os.path.join(ipa_dir, "link.ipa")
        os.symlink(good, link)
        hard = os.path.join(ipa_dir, "hard.ipa")
        os.link(self.ipa(ipa_dir, name="H.ipa"), hard)
        junk = os.path.join(ipa_dir, "junk.ipa")
        with open(junk, "w") as f:
            f.write("not a zip")
        cases = [
            (app, os.path.join(ipa_dir, "missing.ipa"), "can't open the IPA", 64),
            (app, link, "can't open the IPA", 64),
            (app, hard, "isn't a plain file", 64),
            (app, junk, "unzip couldn't unpack", 64),
            (app, self.ipa(ipa_dir, name="E.ipa", app=None), "no single Payload", 64),
            (app, self.ipa(ipa_dir, name="B.ipa", bundle_id="bad id"), "no usable CFBundleIdentifier", 64),
            (app, os.path.join(p, "x.ipa"), "bad IPA path", 64),
            (app, ipa_dir + "/../ipa/" + os.path.basename(good), "bad IPA path", 64),
            (self.driver, good, "isn't Cydian", 77),
        ]
        for parent, path, msg, code in cases:
            with self.subTest(path=os.path.basename(path), msg=msg):
                out = self.spawn(parent, helper, "install-ipa", path)
                self.assertTrue(any(l.startswith("2: cydian-helper: ") and msg in l for l in out), out)
                self.assertEqual(out[-1], f"exit: {code}")
                self.assertFalse(any(l.startswith("1: install ") for l in out), out)
                self.assert_clean(work)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Rollback(unittest.TestCase):
    """F71: rollbacks <id> / rollback <id> <version> over N7's store (<prefix>/var/cache/cydian/rollback/<id>/), with
    this test's user standing in for root (CYDIAN_ROOT_UID) and a stand-in dpkg-deb that prints the fake .deb's
    text as its control."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.uid = str(os.getuid())
        cls.driver = os.path.join(cls.tmp, "test_driver")
        build(cls.driver, ["test_driver.c", "policy.c", "spawn.c"], [f"-DCYDIAN_ROOT_UID={os.getuid()}"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_driver(self, *args, driver=None):
        r = subprocess.run([driver or self.driver, *args], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.splitlines()

    def prefix(self):
        p = tempfile.mkdtemp(dir=self.tmp)
        os.chmod(p, 0o755)
        bin_ = os.path.join(p, "usr/bin")
        os.makedirs(bin_)
        dpkg_deb = os.path.join(bin_, "dpkg-deb")  # dpkg-deb -f <deb> Package Version
        with open(dpkg_deb, "w") as f:
            f.write('#!/bin/sh\n[ "$1" = -f ] && [ "$3" = Package ] && [ "$4" = Version ] && [ $# -eq 4 ] || exit 2\n'
                    'case $(head -c 4 "$2") in junk) echo "dpkg-deb: error: not a debian archive" >&2; exit 2 ;; esac\n'
                    'cat "$2"\n')
        os.chmod(dpkg_deb, 0o755)
        return p

    def store(self, p, pkg="com.example.tweak", files=None):
        d = os.path.join(p, "var/cache/cydian/rollback", pkg)
        os.makedirs(d, exist_ok=True)
        for q in (os.path.join(p, "var/cache/cydian/rollback"), d):
            os.chmod(q, 0o755)
        files = files if files is not None else {"0.9": "0.9", "1:1.0~b1": "1%3a1.0~b1"}
        for ver, spelled in files.items():
            path = os.path.join(d, f"{pkg}_{spelled}_iphoneos-arm64.deb")
            with open(path, "w") as f:
                f.write(f"Package: {pkg}\nVersion: {ver}\n")
            os.chmod(path, 0o644)
        return d

    def test_deb_names(self):
        good = {"com.a_1.0_iphoneos-arm64.deb": "1.0", "com.a_1%3a2.0~b1+x-2_iphoneos-arm64.deb": "1:2.0~b1+x-2",
                "com.a_2%3A1_all.deb": "2:1"}
        bad = ["com.a_1.0.deb", "com.a_1.0_.deb", "com.a__arm64.deb", "com.ab_1.0_arm64.deb", "com.a_1.0_arm64.ipa",
               "com.a_x1_arm64.deb", "com.a_1_0_arm64.deb", "com.a_1%3_arm64.deb", "com.a_1%2f2_arm64.deb",
               "com.a_1.0_arm/64.deb", "com.a_1.0_ARM.deb", "com.a_1 0_arm64.deb", "com.a.b_1.0_arm64.deb",
               "com.a_1.0_arm64.deb.part", ".com.a_1.0_arm64.deb", "com.a_" + "1" * 256 + "_arm64.deb"]
        self.assertEqual(self.run_driver("debname", "com.a", *good), list(good.values()))
        self.assertEqual(self.run_driver("debname", "com.a", *bad), ["bad"] * len(bad))

    def test_control(self):
        c = lambda text, pkg="com.a", ver="1:1.0": self.run_driver("control", pkg, ver, text)[0]
        self.assertEqual(c("Package: com.a\nVersion: 1:1.0\n"), "ok")
        self.assertEqual(c("Version: 1:1.0\r\nPackage:  com.a \n"), "ok")
        self.assertEqual(c("Package: com.a.evil\nVersion: 1:1.0\n"), "bad")
        self.assertEqual(c("Package: com.\nVersion: 1:1.0\n"), "bad")
        self.assertEqual(c("Package: com.a\nVersion: 1:1.01\n"), "bad")
        self.assertEqual(c("Package: com.a\n"), "bad")
        self.assertEqual(c("Version: 1:1.0\n"), "bad")
        self.assertEqual(c(""), "bad")
        self.assertEqual(c("Package: com.a\nPackage: other\nVersion: 1:1.0\n"), "bad")

    def test_file(self):
        p = self.prefix()
        d = self.store(p)
        root = os.path.join(p, "var/cache/cydian/rollback")
        f = lambda ver, pkg="com.example.tweak", uid=self.uid: self.run_driver("rbfile", root, pkg, ver, uid)[0]
        self.assertEqual(f("0.9"), f"{d}/com.example.tweak_0.9_iphoneos-arm64.deb")
        self.assertEqual(f("1:1.0~b1"), f"{d}/com.example.tweak_1%3a1.0~b1_iphoneos-arm64.deb")
        self.assertIn("no stored .deb", f("1.0"))
        self.assertIn("no stored .deb", f("0.9", pkg="com.example.other"))  # no folder
        self.assertIn("bad version", f("x"))
        self.assertIn("bad package name", f("0.9", pkg="../x"))
        self.assertIn("isn't a root-owned directory", f("0.9", uid=str(os.getuid() + 1)))  # another owner

    def test_file_refuses_unsafe(self):
        p = self.prefix()
        root = os.path.join(p, "var/cache/cydian/rollback")
        d = self.store(p, files={})
        name = lambda v: os.path.join(d, f"com.example.tweak_{v}_iphoneos-arm64.deb")
        other = os.path.join(self.tmp, "elsewhere.deb")
        open(other, "w").close()
        os.symlink(other, name("1"))
        with open(name("2"), "w") as f:
            f.write("x")
        os.chmod(name("2"), 0o664)  # group-writable
        with open(name("3"), "w") as f:
            f.write("x")
        os.link(name("3"), os.path.join(self.tmp, f"hard-{os.path.basename(p)}"))  # two links
        os.makedirs(name("4"))
        f = lambda ver: self.run_driver("rbfile", root, "com.example.tweak", ver, self.uid)[0]
        for ver in "1234":
            with self.subTest(ver=ver):
                self.assertIn("isn't a plain root-owned file", f(ver))
        self.assertEqual(self.run_driver("rblist", root, "com.example.tweak", self.uid), ["count: 0"])
        # a writable or linked folder refuses everything in it
        self.store(p, files={"5": "5"})
        self.assertTrue(f("5").startswith("/"))
        os.chmod(d, 0o775)
        self.assertIn("package's rollback folder isn't", f("5"))
        os.chmod(d, 0o755)
        os.chmod(root, 0o777)
        self.assertIn("the rollback folder isn't", f("5"))
        self.assertIn("error: ", self.run_driver("rblist", root, "com.example.tweak", self.uid)[0])
        os.chmod(root, 0o755)
        q = self.prefix()
        self.store(q, files={"5": "5"})
        os.symlink(d, os.path.join(q, "var/cache/cydian/rollback/com.example.link"))
        self.assertIn("isn't a root-owned directory",
                      self.run_driver("rbfile", os.path.join(q, "var/cache/cydian/rollback"), "com.example.link", "5", self.uid)[0])

    def test_list(self):
        p = self.prefix()
        d = self.store(p)
        root = os.path.join(p, "var/cache/cydian/rollback")
        open(os.path.join(d, "com.example.tweak_1.0_iphoneos-arm64.deb.tmp"), "w").close()
        open(os.path.join(d, "README"), "w").close()
        out = self.run_driver("rblist", root, "com.example.tweak", self.uid)
        self.assertEqual(out[-1], "count: 2")
        self.assertEqual(sorted(out[:-1]), ["0.9 com.example.tweak_0.9_iphoneos-arm64.deb",
                                            "1:1.0~b1 com.example.tweak_1%3a1.0~b1_iphoneos-arm64.deb"])
        self.assertEqual(self.run_driver("rblist", root, "com.example.none", self.uid), ["count: 0"])
        self.assertEqual(self.run_driver("rblist", os.path.join(p, "nope"), "com.example.tweak", self.uid), ["count: 0"])
        self.assertIn("bad package name", self.run_driver("rblist", root, "-x", self.uid)[0])

    def test_verify(self):
        p = self.prefix()
        d = self.store(p)
        deb = os.path.join(d, "com.example.tweak_0.9_iphoneos-arm64.deb")
        v = lambda path=deb, pkg="com.example.tweak", ver="0.9", prefix=p: self.run_driver("rbverify", prefix, path, pkg, ver)[0]
        self.assertEqual(v(), "ok")
        self.assertIn("isn't that package and version", v(ver="1:1.0~b1"))
        self.assertIn("isn't that package and version", v(pkg="com.example.other"))
        with open(deb, "w") as f:
            f.write("Package: com.example.evil\nVersion: 0.9\n")  # the name says tweak, the control says otherwise
        self.assertIn("isn't that package and version", v())
        with open(deb, "w") as f:
            f.write("junk")
        self.assertIn("dpkg-deb couldn't read", v())
        self.assertIn("dpkg-deb couldn't read", v(prefix=self.tmp))  # no dpkg-deb at all

    def test_plan(self):
        p = self.prefix()
        d = self.store(p)
        plan = lambda *w, fd="3": self.run_driver("plan", p, fd, *w)
        deb = f"{d}/com.example.tweak_1%3a1.0~b1_iphoneos-arm64.deb"
        fixed = ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "--allow-downgrades"]
        self.assertEqual(plan("rollback", "com.example.tweak", "1:1.0~b1"),
                         [f"{p}/usr/bin/apt-get", "apt-get", *fixed, "-o", "APT::Keep-Fds::=3", "-o", "APT::Status-Fd=3",
                          "install", deb])
        self.assertEqual(plan("rollback", "com.example.tweak", "1:1.0~b1", fd="-1")[1:], ["apt-get", *fixed, "install", deb])
        self.assertEqual(plan("rollbacks", "com.example.tweak"),
                         [f"{p}/var/cache/cydian/rollback", "rollbacks", "com.example.tweak"])
        cases = {
            ("rollback",): "a package name and a version",
            ("rollback", "com.example.tweak"): "a package name and a version",
            ("rollback", "com.example.tweak", "0.9", "x"): "a package name and a version",
            ("rollback", "-o", "0.9"): "bad package name",
            ("rollback", "com.example.tweak", "-o"): "bad version",
            ("rollback", "com.example.tweak", "0.9/../x"): "bad version",
            ("rollback", "com.example.tweak", "2.0"): "no stored .deb",
            ("rollbacks",): "rollbacks takes a package name",
            ("rollbacks", "a", "b"): "rollbacks takes a package name",
            ("rollbacks", "A"): "bad package name",
        }
        for words, msg in cases.items():
            with self.subTest(words=words):
                out = plan(*words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)
        self.assertEqual(self.run_driver("known", p, "rollback", "com.example.tweak", "0.9"), ["all known"])

    def chain(self):
        p = self.prefix()
        os.makedirs(os.path.join(p, "Applications/Cydian.app"))
        app = os.path.join(p, "Applications/Cydian.app/Cydian")
        shutil.copy(self.driver, app)
        apt = os.path.join(p, "usr/bin/apt-get")
        with open(apt, "w") as f:
            f.write('#!/bin/sh\necho "argv: $0 $*"\necho "env: $(env | sort | tr \'\\n\' \' \')"\n'
                    'echo "pmstatus:com.example.tweak:50:Installing" >&3\nexit 0\n')
        os.chmod(apt, 0o755)
        helper = os.path.join(p, "cydian-helper")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"', f"-DCYDIAN_ROOT_UID={os.getuid()}"])
        return p, app, helper

    def test_chain(self):
        p, app, helper = self.chain()
        d = self.store(p)
        out = self.run_driver("spawn", helper, "rollbacks", "com.example.tweak", driver=app)
        self.assertEqual(out[-1], "exit: 0")
        self.assertEqual(sorted(out[:-1]), ["1: 0.9 com.example.tweak_0.9_iphoneos-arm64.deb",
                                            "1: 1:1.0~b1 com.example.tweak_1%3a1.0~b1_iphoneos-arm64.deb"])
        self.assertEqual(self.run_driver("spawn", helper, "rollbacks", "com.example.none", driver=app), ["exit: 0"])
        out = self.run_driver("spawn", helper, "rollback", "com.example.tweak", "0.9", driver=app)
        self.assertIn(f"1: argv: {p}/usr/bin/apt-get -y -o Dpkg::Options::=--force-confdef -o "
                      "Dpkg::Options::=--force-confold --allow-downgrades -o APT::Keep-Fds::=3 -o APT::Status-Fd=3 "
                      f"install {d}/com.example.tweak_0.9_iphoneos-arm64.deb", out)
        self.assertIn("CYDIA=3 1", next(l for l in out if l.startswith("1: env: ")))
        self.assertIn("3: pmstatus:com.example.tweak:50:Installing", out)
        self.assertEqual(out[-1], "exit: 0")

    def test_chain_refuses(self):
        p, app, helper = self.chain()
        d = self.store(p)
        with open(os.path.join(d, "com.example.tweak_0.9_iphoneos-arm64.deb"), "w") as f:
            f.write("Package: com.example.evil\nVersion: 0.9\n")
        cases = [
            (app, ["rollback", "com.example.tweak", "0.9"], "isn't that package and version", 64),
            (app, ["rollback", "com.example.tweak", "3.0"], "no stored .deb", 64),
            (app, ["rollback", "com.example.tweak", "--force-all"], "bad version", 64),
            (app, ["rollbacks", "../etc"], "bad package name", 64),
            (self.driver, ["rollback", "com.example.tweak", "1:1.0~b1"], "isn't Cydian", 77),
            (self.driver, ["rollbacks", "com.example.tweak"], "isn't Cydian", 77),
        ]
        for parent, words, msg, code in cases:
            with self.subTest(words=words):
                out = self.run_driver("spawn", helper, *words, driver=parent)
                self.assertTrue(any(l.startswith("2: cydian-helper: ") and msg in l for l in out), out)
                self.assertEqual(out[-1], f"exit: {code}")
                self.assertFalse(any(l.startswith("1: ") for l in out), out)

PAID_DIR = "/var/mobile/Library/Caches/com.ryha.cydian/paid"


@unittest.skipUnless(CC, "no C compiler on this machine")
class InstallPaid(unittest.TestCase):
    """F57: install-paid <path> <id> <version>: the path allowlist, the plan, and the chain on Linux (stand-in
    dpkg-deb that prints the fake .deb's text as its control, and a stand-in apt-get)."""

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

    def test_paths(self):
        d = PAID_DIR
        good = [d + "/a.deb", d + "/3F2A-11.deb", d + "/com.foo_1.0_iphoneos-arm64.deb", d + "/" + "a" * 251 + ".deb"]
        bad = ["", d, d + "/", d + "/.deb", d + "/.x.deb", d + "/a.DEB", d + "/a.ipa", d + "/sub/a.deb",
               d + "/../a.deb", d + "/a..deb", "/tmp/a.deb", d + "x/a.deb", d + "/a b.deb", d + "/a\n.deb",
               d + "/-a.deb", d + "/" + "a" * 252 + ".deb", "a.deb", d.replace("/paid", "/ipa") + "/a.deb"]
        self.assertEqual(self.run_driver("paidpath", d, *good), ["ok"] * len(good))
        self.assertEqual(self.run_driver("paidpath", d, *bad), ["bad"] * len(bad))

    def test_plan(self):
        deb = PAID_DIR + "/0A1B.deb"
        fixed = ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"]
        self.assertEqual(self.run_driver("plan", "/var/jb", "3", "install-paid", deb, "com.example.paid", "1:1.0"),
                         ["/var/jb/usr/bin/apt-get", "apt-get", *fixed, "-o", "APT::Keep-Fds::=3", "-o",
                          "APT::Status-Fd=3", "install", deb])
        self.assertEqual(self.run_driver("plan", "/var/jb", "-1", "install-paid", deb, "com.example.paid", "1.0")[1:],
                         ["apt-get", *fixed, "install", deb])
        cases = {
            ("install-paid",): "a .deb path, a package name and a version",
            ("install-paid", deb, "com.example.paid"): "a .deb path, a package name and a version",
            ("install-paid", deb, "com.example.paid", "1.0", "x"): "a .deb path, a package name and a version",
            ("install-paid", "/var/jb/tmp/x.deb", "com.example.paid", "1.0"): "bad .deb path",
            ("install-paid", PAID_DIR + "/../ipa/x.deb", "com.example.paid", "1.0"): "bad .deb path",
            ("install-paid", deb, "-o", "1.0"): "bad package name",
            ("install-paid", deb, "com.example.paid", "--force-all"): "bad version",
        }
        for words, msg in cases.items():
            with self.subTest(words=words):
                out = self.run_driver("plan", "/var/jb", "3", *words)
                self.assertEqual(len(out), 1, out)
                self.assertTrue(out[0].startswith("error: ") and msg in out[0], out)
        self.assertEqual(self.run_driver("known", "/nonexistent", "install-paid", deb, "com.example.paid", "1.0"),
                         ["all known"])

    # --- the chain

    def chain(self, apt_exit=0):
        base = tempfile.mkdtemp(dir=self.tmp)
        p, paid, work = (os.path.join(base, n) for n in ("prefix", "paid", "work"))
        for d in ("Applications/Cydian.app", "usr/bin"):
            os.makedirs(os.path.join(p, d))
        os.makedirs(paid)
        os.makedirs(work)
        app = os.path.join(p, "Applications/Cydian.app/Cydian")
        shutil.copy(self.driver, app)
        dpkg_deb = os.path.join(p, "usr/bin/dpkg-deb")  # dpkg-deb -f <deb> Package Version
        with open(dpkg_deb, "w") as f:
            f.write('#!/bin/sh\n[ "$1" = -f ] && [ "$3" = Package ] && [ "$4" = Version ] && [ $# -eq 4 ] || exit 2\n'
                    'case $(head -c 4 "$2") in junk) exit 2 ;; esac\ncat "$2"\n')
        apt = os.path.join(p, "usr/bin/apt-get")  # says what it got, and what the copy holds
        with open(apt, "w") as f:
            f.write('#!/bin/sh\necho "argv: $*"\nfor a; do last=$a; done\necho "copy: $(cat "$last")"\n'
                    'echo "env: $(env | sort | tr \'\\n\' \' \')"\n'
                    f'echo "pmstatus:com.example.paid:50:Installing" >&3\nexit {apt_exit}\n')
        os.chmod(dpkg_deb, 0o755)
        os.chmod(apt, 0o755)
        helper = os.path.join(base, "cydian-helper")
        build(helper, ["main.c", "policy.c"], [f'-DCYDIAN_PREFIX="{p}"', f"-DCYDIAN_ROOT_UID={os.getuid()}",
                                                f'-DHELPER_PAID_DIR="{paid}"', f'-DHELPER_PAID_WORK="{work}"'])
        return p, app, helper, paid, work

    def deb(self, paid, name="A1.deb", pkg="com.example.paid", ver="1:1.0"):
        path = os.path.join(paid, name)
        with open(path, "w") as f:
            f.write(f"Package: {pkg}\nVersion: {ver}\n")
        return path

    def spawn(self, app, helper, *words):
        return self.run_driver("spawn", helper, *words, driver=app)

    def test_chain(self):
        p, app, helper, paid, work = self.chain()
        out = self.spawn(app, helper, "install-paid", self.deb(paid), "com.example.paid", "1:1.0")
        self.assertEqual(out[-1], "exit: 0", out)
        argv = next(l for l in out if l.startswith("1: argv: "))
        self.assertTrue(argv.startswith("1: argv: -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "
                                        f"-o APT::Keep-Fds::=3 -o APT::Status-Fd=3 install {work}/cydian-paid."), argv)
        self.assertTrue(argv.endswith("/paid.deb"), argv)  # the root-owned copy, not the app's file
        self.assertIn("1: copy: Package: com.example.paid", out)
        self.assertIn("CYDIA=3 1", next(l for l in out if l.startswith("1: env: ")))
        self.assertIn("3: pmstatus:com.example.paid:50:Installing", out)
        self.assertEqual(os.listdir(work), [])  # the work directory goes
        out = self.chain(apt_exit=100)
        p, app, helper, paid, work = out
        out = self.spawn(app, helper, "install-paid", self.deb(paid), "com.example.paid", "1:1.0")
        self.assertEqual(out[-1], "exit: 100", out)  # apt's own status
        self.assertFalse(any(l.startswith("2: cydian-helper: ") for l in out), out)
        self.assertEqual(os.listdir(work), [])

    def test_chain_refuses(self):
        p, app, helper, paid, work = self.chain()
        good = self.deb(paid)
        link = os.path.join(paid, "link.deb")
        os.symlink(good, link)
        hard = os.path.join(paid, "hard.deb")
        os.link(self.deb(paid, name="H.deb"), hard)
        junk = os.path.join(paid, "junk.deb")
        with open(junk, "w") as f:
            f.write("junk")
        empty = os.path.join(paid, "empty.deb")
        open(empty, "w").close()
        cases = [
            (app, [good, "com.example.paid", "2.0"], "isn't that package and version", 64),
            (app, [self.deb(paid, name="E.deb", pkg="com.example.evil"), "com.example.paid", "1:1.0"],
             "isn't that package and version", 64),
            (app, [junk, "com.example.paid", "1:1.0"], "couldn't read the downloaded", 64),
            (app, [os.path.join(paid, "missing.deb"), "com.example.paid", "1:1.0"], "can't open the .deb", 64),
            (app, [link, "com.example.paid", "1:1.0"], "can't open the .deb", 64),
            (app, [hard, "com.example.paid", "1:1.0"], "isn't a plain file", 64),
            (app, [empty, "com.example.paid", "1:1.0"], "isn't a plain file", 64),
            (app, [os.path.join(p, "x.deb"), "com.example.paid", "1:1.0"], "bad .deb path", 64),
            (self.driver, [good, "com.example.paid", "1:1.0"], "isn't Cydian", 77),
        ]
        for parent, words, msg, code in cases:
            with self.subTest(words=words[0], msg=msg):
                out = self.spawn(parent, helper, "install-paid", *words)
                self.assertTrue(any(l.startswith("2: cydian-helper: ") and msg in l for l in out), out)
                self.assertEqual(out[-1], f"exit: {code}")
                self.assertFalse(any(l.startswith("1: ") for l in out), out)
                self.assertEqual(os.listdir(work), [])


if __name__ == "__main__":
    unittest.main()
