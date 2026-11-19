"""Scratch directories for tests that build with swiftc, on the disk instead of /tmp.

/tmp is a RAM-backed tmpfs with a per-user quota on the dev machine, shared by every agent slot's gate at once.
A swiftc build writes its object files to $TMPDIR (/tmp by default); when the other slots have filled the quota,
the compiler fails with "error closing '/tmp/TemporaryDirectory.*/X-1.o' for output: Disk quota exceeded" and the
test fails for a reason that has nothing to do with the code. build_dir() makes the test's directory under
$IFIZBOX_TEST_TMP, else ${XDG_CACHE_HOME:-~/.cache}/ifizbox-tests (falling back to the default temp dir when
neither can be made), and swift_env() points swiftc's own TMPDIR inside it, so the build only needs disk space.
Stdlib only.
"""
import os
import tempfile


def root() -> str | None:
    """The disk folder the scratch directories go in, or None to use tempfile's default."""
    base = os.environ.get("IFIZBOX_TEST_TMP") or os.path.join(
        os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"), "ifizbox-tests")
    try:
        os.makedirs(base, exist_ok=True)
    except OSError:
        return None
    return base if os.access(base, os.W_OK) else None


def build_dir(prefix: str) -> str:
    """A fresh directory of the caller's own (remove it when done), on the disk where it can be."""
    return tempfile.mkdtemp(prefix=prefix, dir=root())


def swift_env(env: dict, tmp: str) -> dict:
    """env with TMPDIR inside tmp, for swiftc's intermediate files. Returns env, changed in place."""
    t = os.path.join(tmp, "swift-tmp")
    os.makedirs(t, exist_ok=True)
    env["TMPDIR"] = t
    return env
