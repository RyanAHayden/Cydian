#!/usr/bin/env python3
"""Run one directory's test_*.py for tools/check.sh and write down what was skipped.

Usage: gate_unittest.py DIR SKIPFILE

Same as `python3 -m unittest discover -q -s DIR -t DIR -p 'test_*.py'`, but every skipped test is appended to
SKIPFILE as one line, `DIR: <test id>: <reason>`, so the gate can list them at the end (and fail on them under
IFIZBOX_GATE_STRICT=1). Exit 0 when the run passed (skips included), 1 when it failed, 5 when it found no tests.
Stdlib only, like the rest of the gate.
"""
import os
import sys
import unittest


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    top, skipfile = argv[1], argv[2]
    # `python3 -m unittest` puts the working directory first on sys.path, not this script's folder (tools/, whose
    # modules would otherwise shadow same-named ones for tests elsewhere).
    sys.path[0] = os.getcwd()
    suite = unittest.TestLoader().discover(top, pattern="test_*.py", top_level_dir=top)
    result = unittest.TextTestRunner(verbosity=0).run(suite)
    with open(skipfile, "a", encoding="utf-8") as f:
        for test, reason in result.skipped:
            name = test.id() if hasattr(test, "id") else str(test)
            reason = " ".join(str(reason).split()) or "no reason given"
            f.write(f"{top}: {name}: {reason}\n")
    if result.testsRun == 0 and not result.skipped:
        return 5
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
