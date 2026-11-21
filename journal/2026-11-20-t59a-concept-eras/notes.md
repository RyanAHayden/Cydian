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
- Tried and reverted (spec review: not asked): dark status-bar glyphs over any light bar in the apps (iOS 7 White
  shows white glyphs on #f7f7f7 in the frame's Jailbroken/Lite modes). Filed as B225; the real app's own status
  bar on White is B221.
- `tools/concept/check.mjs`: `--themes` takes `era:tone:theme`; each run checks `data-style/data-theme:data-palette`.
  The default era's long form (`ios6:light:classic`) maps to the menu's `light:classic`; a value the menu hasn't got
  fails ("the Theme menu has …") instead of quietly testing the fallback theme.
- `tools/concept/test_concept.py` `test_lists_the_eras_of_core_settings`: loads `core/settings.js` in the vm and
  compares `STYLES`, `STYLE_DEFAULT`, `STYLE_PALETTES` with the page's era list; checks the frame seeds `ifizbox.style`.
- `.claude/skills/concept/SKILL.md`: the eras in the Theme menu, the `--themes` era form, the seeded keys.

## Checks

- `python3 -m unittest tools/concept/test_concept.py`: 14 OK.
- A copy of settings.js with a made-up `ios8` era (own themes white/graphite) gives a third era with no tool change.
- `check.mjs --modes jailbreak,sideload,site --themes light:classic,dark:gunmetal,ios7:light:white,ios7:dark:oled`
  at iphone-se and iphone-17-pro-max (the default two devices): all clean (482 checks, 24 runs), the app's
  `data-style` was `ios7` on the iOS 7 runs (that run had the status-bar change since reverted; it only paints the
  frame's glyphs). After the review: `--themes ios6:light:classic,ios7:dark:oled,nope:light:x --drag-route none` at
  both devices: the first two clean, `nope` failed as it should.

## Not verified

- The published Artifact viewer itself: no concept was published for this tooling change (check.mjs's CSP stands in).
- The frame's home bar stays light over iOS 7's light tab bar in the apps (hard to see). The frame doesn't know the
  tab bar's colour; left as it was.
