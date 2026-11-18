"""F214: the shell's launch grounds (native/Sources/App.swift Launch) match web/app/palettes.css, and the shell
knows every palette Settings offers (web/app/core/settings.js), so no theme falls back to another one's ground."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(*p):
    with open(os.path.join(ROOT, *p)) as f:
        return f.read()


def css_pins(css, tone, name):
    block = re.search(r'html\[data-theme="%s"\]\[data-palette="%s"\] \{(.*?)\n\}' % (tone, name), css, re.S)
    assert block, name
    pins = dict(re.findall(r"--pin-(dark|light): #([0-9a-f]{6});", block.group(1)))
    return pins["dark"], pins["light"], block.group(1)


class LaunchGrounds(unittest.TestCase):
    def setUp(self):
        self.swift = read("native", "Sources", "App.swift")
        self.css = read("web", "app", "palettes.css")

    def striped(self, name):
        m = re.search(r"static let %s = striped\(0x([0-9a-f]{6}), 0x([0-9a-f]{6})(?:, plain: 0x([0-9a-f]{6}))?\)"
                      % name, self.swift)
        self.assertIsNotNone(m, name)
        return m.groups()

    def test_f200_palettes_match_the_css(self):
        for tone, name in [("dark", "midnight"), ("dark", "linen"), ("dark", "nord"), ("dark", "dracula"),
                           ("light", "sepia"), ("light", "solarized")]:
            dark, light, block = css_pins(self.css, tone, name)
            sd, sl, plain = self.striped(name)
            self.assertEqual((sd, sl), (dark, light), name)
            if name == "linen":  # the overscroll is the weave's base colour
                self.assertIn("#%s;" % plain, block)
            else:
                self.assertIsNone(plain, name)

    def test_every_settings_palette_has_a_ground(self):
        settings = read("web", "app", "core", "settings.js")
        for key in ["lightTheme", "darkTheme"]:
            block = re.search(r'key: "%s".*?options: \[(.*?)\}\],' % key, settings, re.S).group(1)
            values = re.findall(r'value: "([a-z]+)"', block)
            self.assertGreater(len(values), 1)
            for v in values[1:]:  # the first is the default the switch falls back to
                self.assertIn('case "%s": return %s' % (v, v), self.swift, v)


if __name__ == "__main__":
    unittest.main()
