# F199: Appearance menu (Settings > Theme)

Following the user's 2026-11-18 notes on the brief: no Style row and no eras. Settings > Theme (F205's name for
Display) is now:

- **Mode**: an iOS 6 segmented control, Automatic / Light / Dark (`kind: "segmented"` in core/settings.js; drawn by
  screens/settings.js `modeControl()`, reusing storepage.js `segmented()` and ios6.css `.store-segmented`, made
  44px and full group width in settings.css). Footer: Automatic switches between the two chosen themes.
- **Themes**: two push rows, Light > Classic and Dark > OLED Black (`lightTheme`, `darkTheme`, `kind: "list"`). Each
  opens a checklist with a swatch per row (option `swatch: [bar, ground]`, drawn as a 24px `.theme-swatch` tile).
- **Live preview**: while Theme > Light or Theme > Dark is the page on screen, the app shows that tone in the theme
  chosen there, whatever Mode says (picking Gunmetal repaints at once). It is read off the URL hash (`previewOf()`),
  so it starts before the page is drawn and ends the moment the route goes back; `init()` re-applies on
  `hashchange`. The shell gets the previewed tone too (status bar and keyboard follow), then Mode's again.
- **Storage**: `ifizbox.appearance` (Mode), `ifizbox.lightTheme`, `ifizbox.darkTheme`, each separate.
  `core/settings.js themeState()` is the one rule; theme-boot.js applies the same before first paint, including the
  preview when the page is reloaded on a theme list. lightTheme/darkTheme travel with the user (TRAVELS).

## Decisions

- **Mode stays under the key `appearance`** (stored at `ifizbox.appearance`), not a new `mode` key as the brief's
  first version said: renaming would drop every stored choice, and the key is what TRAVELS (the transfer to the app
  and the account sync) and the shell's `app.theme` message are built on. Its label is "Mode" now.
- **DARK_PALETTES / LIGHT_PALETTES** are derived from the settings' options, so a new theme is one option plus its
  ios6.css block (and theme-boot.js's one line).
- The mockup was not reopened (the brief says it was read; the artifact needs a signed-in browser). Header names
  ("Mode", "Themes"), the footers and the 44px control height are my reading of the brief.

## Checks

- `node --test` on core/settings, screens/settings, settings, theme-palette and transfer tests: pass. New:
  theme-palette's "F199: themeState, theme-boot.js and the store agree…" runs every Mode (incl. unset and a bogus
  value) × light theme × dark theme × system × preview through the store, `themeState()` and theme-boot.js in a vm;
  applyTheme previews; Theme page layout (header, segmented, footer; Light/Dark details); list rows with swatches;
  `previewOf` routes.
- 3x screenshots (headless Chromium, 390x844 @3, site via `node worker/node.mjs`, `capture.mjs` from F198 driven by
  `shots.json`): `light-theme.png`, `oled-theme.png` (Mode tapped to Dark), `light-dark-list-preview.png` (Dark's
  list from Light mode, previewing OLED), `oled-dark-list.png`, `gunmetal-dark-list.png` (Gunmetal tapped: repaints
  live), `light-light-list.png`, `oled-light-list-preview.png` (Light's list from Dark mode). The script's evals also
  confirmed: back on Theme the preview ends; a reload on the Dark list boots dark.

## What went wrong on the way

- The first capture run used `history.back()` after two hash pushes and landed on the wrong page, so the "Dark" tap
  hit the Gunmetal row. Replaced with explicit `go` steps.
- The first `done` failed the gate on icons/rowicons.test.js (every setting row must have a tile, except choices).
  It now also exempts `segmented` (no row) and the `tone` rows (Light / Dark), which stay bare as Appearance's options did.
- The tests' fake DOM has no `Element.after()`, so the segmented control goes in with `replaceChildren` instead.

## Not verified

- **Real Safari / the iPhone 7 app**: screenshots are Chromium; the task didn't say to drive the phone. Not checked:
  the shell following a preview's pinned style and returning to "auto" (Bridge.swift already takes style
  light/dark/auto, unchanged here).
- **The mockup itself**: not reopened (see Decisions), so spacing and wording may differ from it.
- **VoiceOver** reading Mode as radio buttons: only the roles/attributes were checked, not with a screen reader.
