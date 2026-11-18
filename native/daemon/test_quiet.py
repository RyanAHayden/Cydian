"""F65: Upgrade Notifications off (quiet.h): N5's "n Upgrades" becomes a badge-only update, N7's notes stay, and the
daemon looks for the same file the helper's `notifications off` writes. Built with the host's C compiler."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.dirname(HERE)
CC = shutil.which(os.environ.get("CC", "cc")) or shutil.which("clang") or shutil.which("gcc")

DRIVER = r"""
#include <stdio.h>
#include "quiet.h"
int main(void) {
    int kinds[] = {AUTO_NOTE_UPGRADES, AUTO_NOTE_UPDATED, AUTO_NOTE_FAILED, AUTO_NOTE_BADGE};
    for (int off = 0; off < 2; off++)
        for (int i = 0; i < 4; i++) printf("%d %d %d\n", off, kinds[i], quiet_kind(kinds[i], off));
    printf("file %s\n", QUIET_FILE);
    return 0;
}
"""


def read(path):
    with open(path) as f:
        return f.read()


def defined(path, name):
    m = re.search(r'#define %s "([^"]+)"' % name, read(path))
    return m and m.group(1)


@unittest.skipUnless(CC, "no C compiler on this machine")
class Quiet(unittest.TestCase):
    def test_rule(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, exe = os.path.join(tmp, "q.c"), os.path.join(tmp, "q")
            with open(src, "w") as f:
                f.write(DRIVER)
            subprocess.run([CC, "-std=c11", "-Wall", "-Wextra", "-Werror", "-I", HERE, "-o", exe, src], check=True,
                           capture_output=True)
            out = subprocess.run([exe], capture_output=True, text=True, timeout=30, check=True).stdout.splitlines()
        h = read(os.path.join(HERE, "auto.h"))
        kinds = re.search(r"enum \{ (AUTO_NOTE_UPGRADES[^}]*)\}", h).group(1).replace(" ", "").split(",")
        n = {k: i for i, k in enumerate(kinds)}
        rows = {(int(a), int(b)): int(c) for a, b, c in (l.split() for l in out[:-1])}
        for k in kinds:  # on: everything as auto_step asks
            self.assertEqual(rows[(0, n[k])], n[k], k)
        self.assertEqual(rows[(1, n["AUTO_NOTE_UPGRADES"])], n["AUTO_NOTE_BADGE"])  # off: the count, no banner
        for k in ("AUTO_NOTE_UPDATED", "AUTO_NOTE_FAILED", "AUTO_NOTE_BADGE"):
            self.assertEqual(rows[(1, n[k])], n[k], k)
        self.assertEqual(out[-1], "file /var/lib/ifizbox/upgrades.off")

    def test_same_file_as_helper(self):
        self.assertEqual(defined(os.path.join(HERE, "quiet.h"), "QUIET_FILE"),
                         defined(os.path.join(NATIVE, "helper/policy.h"), "HELPER_NOTIFY_OFF"))

    def test_daemon_uses_it(self):
        m = read(os.path.join(HERE, "main.m"))
        self.assertIn('#include "quiet.h"', m)
        body = m[m.index("static void e_notify("):]
        body = body[:body.index("\n}\n")]
        self.assertIn("quiet_kind(kind, access(IFIZBOX_PREFIX QUIET_FILE, F_OK) == 0)", body)
        self.assertLess(body.index("quiet_kind"), body.index("AUTO_NOTE_BADGE"))


if __name__ == "__main__":
    unittest.main()
