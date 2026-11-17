# F13 Settings tab, Appearance and the dark theme

## What I did
- **`web/app/core/settings.js`** (pure, node-tested): every setting from the brief as data (key, section, kind,
  options, default, modes, feature, footer). `createSettings({ storage, mode, features })` gives `get/set/onChange`,
  `sections()`/`visible()` (rows this mode shows), `holds` (Ignore Upgrades per package). Values live in
  `localStorage["cydian.<key>"]` as strings, so `backend.js getArch()` keeps reading `cydian.arch` unchanged (I did
  not move getArch: backend.js is not on this task's files, and the key is shared). Bad stored values read as the
  default; storage that throws (private mode) falls back to memory.
- **Rows wait for their feature**: `FEATURES` lists what exists. Today: `appearance` and `sources` (F4), so the tab
  shows Appearance (Automatic / Light / Dark), Architecture (Rootless / Rootful, pushes a picker) and Refresh
  Sources on Launch (switch). The others (Check for updates, Use cellular data, Notifications, App icon badge,
  Ignore upgrades, the three automatic-install rows, Keep previous versions, Re-sign reminder) are defined, with
  their modes and defaults, and appear once their task adds the feature name. Tests cover each mode's full row set.
- **Mode**: `detectMode()` reads `cydianNative.mode` (I2 will set it); a bridge without one is the N1 jailbreak
  shell; no bridge is the site.
- **Settings screen** (`screens/settings.js`), sixth tab after Search (router `TABS`, router test updated), with a
  gear glyph of our own. iOS 6 switch drawn in CSS from the kit's "switch (on)/(off)" layers.
- **Dark theme**: `ios6.css` colours of tables, text, chevron, plain lists and category bars are now custom
  properties; `html[data-theme="dark"]` swaps them for gunmetal pinstripe/tables with white text, and the nav bar
  becomes the kit's black bar ("Status Bar (Black)" under the notch, black menu bar #4c4c4c→#000 at 52%), bar
  buttons "Button (Black)", the back button a black copy of the kit's arrow. Tab bar is black in both.
- `index.html`: two `theme-color` metas (light #4f698b = top of the blue status bar, dark #000) with media queries;
  JS repaints both when Appearance is fixed. `color-scheme`, `darkreader-lock`. `theme-boot.js` (classic script in
  `<head>`) sets `data-theme` before first paint so dark never flashes light.
- Refresh Sources on Launch: `app.js` calls `refreshSources()` in the background after start. Default off on the
  site (it costs proxy fetches), on in the app.
- Screenshots of every screen, light and dark, plus Automatic following the system both ways with the switch on:
  this folder, made by `tools/shots.mjs` (static `python3 -m http.server 8732` in web/app, headless chromium on
  :9334). Console errors: none.

## Decisions (no one to ask)
- "sideload mode says 'about'" in the brief I read as: the Check for updates text says what it checks; in sideload
  mode the footer says apps, elsewhere packages.
- Defaults the brief left open: Check for updates On Launch, Notifications Summary, Badge on, Cellular on, Auto
  install Off, Only when charging and locked on, Respring Just notify me, Keep 1 version, Re-sign 2 days before.
- Architecture is shown on the site and in jailbreak mode, not sideload (no apt there).
- Holds are stored on the device in every mode for now; the jailbreak path (apt-mark through the helper) is F22,
  because N2's helper allowlist has no apt-mark.

## Follow-ups filed
- F22: helper allows `apt-mark hold|unhold|showhold`; wire Ignore Upgrades to it.
- F23 (low): the native shell's own bars follow the theme.

## Not verified
- On a real iPhone (Safari or standalone): not checked; the 4S runs iOS 6 (no `prefers-color-scheme`, no CSS
  custom properties in its Safari 6, so it is no test for this) and the task did not ask for device time. Checked in
  headless Chromium at 390x844 @3x with emulated safe areas only.
- Dark Reader honouring `darkreader-lock`: the extension is not installed here.
- `theme-color` tinting of Safari's chrome: Chromium headless has no chrome to tint; I checked only that the metas'
  `content` changes.
- Sources tab after changing Architecture: the counts already drawn there are not redrawn until the list next loads
  (sources.js is not this task's file).
- The Sources screenshots show the static server's missing `/api/fetch` (no Flask), i.e. the empty/error state.
