"""Scratch folders for the helper tests on the checkout's own disk, not /tmp.

/tmp here is a tmpfs with a per-user quota that every agent slot, gate and scratchpad on the machine shares. When
something else fills it, cc can't write the test's binaries or its own temp files ("Disk quota exceeded") and the
test fails for a reason that isn't its own. A test that takes a Scratch keeps everything it writes, cc's temp files
included (TMPDIR), under native/helper/build/tests/ (build/ is gitignored).
"""
import os
import shutil
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
# realpath: the helper compares its caller's /proc/<pid>/exe (a resolved path) with the prefix built into it.
ROOT = os.path.realpath(os.path.join(HERE, "build", "tests"))


class Scratch:
    """A fresh folder under ROOT, and TMPDIR pointing into it for child processes (cc), until close()."""

    def __init__(self):
        os.makedirs(ROOT, exist_ok=True)
        self.path = tempfile.mkdtemp(dir=ROOT)
        self._tmpdir = os.environ.get("TMPDIR")
        os.environ["TMPDIR"] = self.path

    def close(self):
        if self._tmpdir is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = self._tmpdir
        shutil.rmtree(self.path, ignore_errors=True)
