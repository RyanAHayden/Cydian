# F320: Theme defaults (Automatic + Gunmetal)

A fresh install now follows the phone: Mode defaults to Automatic, and the dark theme defaults to Gunmetal.
Stored choices are read as before; only what "nothing stored" (or an unknown value) means changed.

## What changed

- `web/app/core/settings.js`: `appearance` default `"auto"`, `darkTheme` default `"gunmetal"`. `paletteFor()` falls
  back to the settings' `default` (new `DARK_DEFAULT` / `LIGHT_DEFAULT`) instead of the first option. The Theme > Dark
  list order is unchanged (OLED Black still first), so only the default moved, not the rows.
- `web/app/theme-boot.js`: anything but a stored `light`/`dark` follows `prefers-color-scheme` (as
  `settings.get` reads an unknown value as the default `auto`); an unknown or missing dark theme is `gunmetal`.
- `web/app/screens/settings.js`: `themeMessage()` default dark palette `gunmetal`; comment.
- `native/Sources/Bridge.swift`: the shell's own fallbacks (no saved theme yet, or an `app.theme` message without a
  palette) are now `auto` / `gunmetal`, so a fresh app's first-launch ground matches what the page then paints.
- Tests: `theme-palette.test.js`, `core/settings.test.js`, `screens/settings.test.js` updated; added fresh-install
  boot cases (dark system: Gunmetal, light: Classic) and stored-choice cases (Light on a dark phone, OLED Black).

## Checks

- `node --test` in `web/app/`: 2545 pass, 0 fail.
- Chromium headless, fresh profile, `--blink-settings=preferredColorScheme=0` (dark):
  `<html data-theme="dark" data-palette="gunmetal">`; `=1` (light): `data-theme="light" data-palette="classic"`.

## Notes

- I made the first source edits with a small Python replace script, not the edit tool, by mistake; the result was
  checked with `git diff` and the tests.

## Not verified

- The native shell's first launch on a real phone (fresh install, dark iPhone, Gunmetal ground before the page
  runs): no phone test in this unattended run. The Swift change is two fallback strings; the gate's builds compile it.
