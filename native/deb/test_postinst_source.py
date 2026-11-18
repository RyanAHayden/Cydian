"""B17: the .deb's postinst moves Cydian's own source in cydian.sources from GitHub's releases/latest/download/ to
cydian.dev/repo/ (or drops the old stanza when the new one is there). The postinst runs under the phone's dash, which
has no awk: this runs its sources block with sh (dash where installed) against copies of the file."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
OLD = "https://github.com/RyanAHayden/Cydian/releases/latest/download/"
NEW = "https://cydian.dev/repo/"
REAL = "/var/jb/etc/apt/sources.list.d/cydian.sources"


def stanza(uri, extra="Components:\n"):
    return "Types: deb\nURIs: %s\nSuites: ./\n%s" % (uri, extra)


class PostinstSources(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.src = os.path.join(self.dir, "cydian.sources")
        with open(os.path.join(HERE, "postinst")) as f:
            text = f.read()
        self.assertIn(REAL, text)
        # only the B17 block: no uicache or launchctl here, and the file under test instead of the phone's
        block = text[text.index("# B17:"):text.rindex("exit 0")]
        self.script = os.path.join(self.dir, "post.sh")
        with open(self.script, "w") as f:
            f.write(block.replace(REAL, self.src))
        self.shells = [s for s in ("dash", "sh", "bash") if shutil.which(s)]

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_on(self, content):
        out = {}
        for sh in self.shells:
            if content is not None:
                with open(self.src, "w") as f:
                    f.write(content)
            elif os.path.exists(self.src):
                os.remove(self.src)
            r = subprocess.run([sh, self.script], capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual([n for n in os.listdir(self.dir) if ".b17." in n], [])
            out[sh] = open(self.src).read() if os.path.exists(self.src) else None
        self.assertEqual(len(set(out.values())), 1, out)
        return next(iter(out.values()))

    def test_rewrites_the_old_address(self):
        chariz = stanza("https://repo.chariz.com/")
        got = self.run_on(chariz + "\n" + stanza(OLD))
        self.assertEqual(got, chariz + "\n" + stanza(NEW))
        # the phone's own file (N11): no Components line, no trailing newline
        self.assertEqual(self.run_on("Types: deb\nURIs: %s\nSuites: ./" % OLD), "Types: deb\nURIs: %s\nSuites: ./\n" % NEW)

    def test_drops_the_old_stanza_when_the_new_one_is_there(self):
        got = self.run_on(stanza(OLD) + "\n\n\n" + stanza(NEW) + "\n" + stanza("https://havoc.app/"))
        self.assertEqual(got, stanza(NEW) + "\n" + stanza("https://havoc.app/"))
        self.assertEqual(len(re.findall("URIs:", got)), 2)

    def test_leaves_other_files_alone(self):
        other = stanza("https://havoc.app/") + "\n\n"
        self.assertEqual(self.run_on(other), other)  # byte for byte: not rewritten at all
        self.assertIsNone(self.run_on(None))          # no cydian.sources: none made


if __name__ == "__main__":
    unittest.main()
