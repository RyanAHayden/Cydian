"""tools/check.sh runs the native build in the background beside the Python dirs listed in early_dirs, then waits for
it before every other dir. These checks keep that split honest: a dir that runs beside the build must not read its
output (native/build), and the wait must come before the dirs that do. Stdlib only.
"""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECK = ROOT / "tools/check.sh"


def code_lines():
    return [l for l in CHECK.read_text(encoding="utf-8").splitlines() if not l.lstrip().startswith("#")]


class GateParallel(unittest.TestCase):
    def early_dirs(self):
        line = next(l for l in code_lines() if l.startswith("early_dirs="))
        m = re.fullmatch(r"early_dirs='\^\((.*)\)\$'", line.strip())
        self.assertIsNotNone(m, line)
        return m.group(1).split("|")

    def test_early_dirs_dont_read_the_native_build(self):
        for d in self.early_dirs():
            path = ROOT / d
            self.assertTrue(path.is_dir(), f"{d} in early_dirs is not a directory")
            for f in path.glob("test_*.py"):
                text = f.read_text(encoding="utf-8")
                for needle in ("native/build/", '"native", "build"', 'NATIVE, "build"', 'HERE, "build"'):
                    self.assertNotIn(needle, text, f"{f.relative_to(ROOT)} reads native/build: drop {d} from early_dirs")

    def test_the_build_is_waited_for_before_the_late_dirs(self):
        code = code_lines()

        def line_of(text):
            return next(i for i, l in enumerate(code) if l.strip() == text)

        self.assertLess(line_of("wait_native"), line_of('run_py_dirs ${late[@]+"${late[@]}"}'))
        self.assertLess(line_of('run_py_dirs ${early[@]+"${early[@]}"}'), line_of("wait_native"))


if __name__ == "__main__":
    unittest.main()
