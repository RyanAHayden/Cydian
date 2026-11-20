# T59a: the concept tool lists the eras in its Theme menu

## What changed

- `tools/concept/build.py` `styles()` (called from `palettes()`): reads Theme > Style's eras from
  `core/settings.js` the same way the light/dark lists are read: the `style` setting's options and `default`, and
  `STYLE_PALETTES` (an era's own theme per tone). An era with no `STYLE_PALETTES` entry uses the lightTheme and
  darkTheme lists, as `themeState()` does. Its own themes get their label from the theme lists when the value is
  there (oled: OLED Black), else the value capitalised (white: White): `core/settings.js` has no labels for them.
  The default era comes first. It fails the build loudly if the style setting or an era's light/dark pair is missing.
- `tools/concept/frame.html`: the Theme menu has one group per era and tone (`iOS 6 · Light`, `iOS 6 · Dark`,
  `iOS 7 · Light`, `iOS 7 · Dark`). The default era keeps its old values (`light:classic`), so saved controls
  and `check.mjs --themes light:classic` still work; another era's values are `era:tone:theme`
  (`ios7:light:white`). The app's storage is seeded as the app stores it: `ifizbox.style` (theme-boot.js puts it on
  `html[data-style]`), `ifizbox.appearance`, and the tone's pick only in an era that uses the lists.
- The frame's status bar glyphs are now dark over any light bar colour, in the apps too (before: only the site's
  Safari strip). Without it iOS 7 White showed white glyphs on #f7f7f7. Brushed Metal's bar (#9aa0a9) now also gets
  dark glyphs in the apps. The real app has the same problem on White (B221, open); the concept shows the intended look.
- `tools/concept/check.mjs`: `--themes` takes `era:tone:theme`; each run checks `data-style/data-theme:data-palette`.
- `tools/concept/test_concept.py` `test_lists_the_eras_of_core_settings`: loads `core/settings.js` in the vm and
  compares `STYLES`, `STYLE_DEFAULT`, `STYLE_PALETTES` with the page's era list; checks the frame seeds `ifizbox.style`.
- `.claude/skills/concept/SKILL.md`: the eras in the Theme menu, the `--themes` era form, the seeded keys.

## Checks

- `python3 -m unittest tools/concept/test_concept.py`: 14 OK.
- A copy of settings.js with a made-up `ios8` era (own themes white/graphite) gives a third era with no tool change.
- `check.mjs --modes jailbreak,sideload,site --themes light:classic,dark:gunmetal,ios7:light:white,ios7:dark:oled`
  at iphone-se and iphone-17-pro-max (the default two devices): all clean (482 checks, 24 runs), the app's
  `data-style` was `ios7` on the iOS 7 runs. Shots looked at: iOS 7 White in the apps with dark status-bar glyphs.

## Not verified

- The published Artifact viewer itself: no concept was published for this tooling change (check.mjs's CSP stands in).
- The frame's home bar stays light over iOS 7's light tab bar in the apps (hard to see). The frame doesn't know the
  tab bar's colour; left as it was.
