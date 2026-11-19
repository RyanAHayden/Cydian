"""Each wrangler*.toml starts the Worker from a module that exports only its handler.

Local workerd (`wrangler dev`) refuses to start on a main module with plain named exports
("Incorrect type for map entry 'HOST_WAIT'"), and src/index.js exports constants for the tests and node.mjs.
"""
import pathlib
import re
import tomllib
import unittest

HERE = pathlib.Path(__file__).resolve().parent


class EntryTest(unittest.TestCase):
    def test_main_exports_default_only(self):
        configs = sorted(HERE.glob("wrangler*.toml"))
        self.assertTrue(configs)
        for cfg in configs:
            with self.subTest(cfg.name):
                main = HERE / tomllib.loads(cfg.read_text())["main"]
                self.assertTrue(main.is_file(), f"{cfg.name}: main {main} is missing")
                exports = [l for l in main.read_text().splitlines() if re.match(r"\s*export\b", l)]
                self.assertEqual(len(exports), 1, f"{cfg.name}: {main.name} must only re-export default")
                self.assertRegex(exports[0], r'^export \{ default \} from "\./src/index\.js";$')


if __name__ == "__main__":
    unittest.main()
