"""F304: the fetch proxy's GitHub API route (src/github.js), tested in Node (test-github.mjs) like worker/test.mjs."""
import pathlib
import shutil
import subprocess
import unittest

HERE = pathlib.Path(__file__).resolve().parent


class GitHubRouteTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_github_route(self):
        r = subprocess.run(["node", str(HERE / "test-github.mjs")], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("worker github: ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
