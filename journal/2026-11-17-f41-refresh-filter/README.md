# F41: Not Jailbroken refreshes only AltStore sources; Tweaks/Themes hidden

## What I did
- `core/sources.js`: `sourceFilter(type)` — `null` for a jailbroken type, a predicate keeping `alt:` keys for
  `"none"` (the same split as F37's `sourcesFor`). `sourceCalls().refreshSources(onEach, { filter })` fetches only
  the sources the filter keeps.
- `core/altstore.js`: `withAltSources().refreshSources(onEach, { filter })` filters the AltStore list too, and
  when the filter keeps no APT source it doesn't call the wrapped `refreshSources` at all. That matters for
  `backend-native.js`, whose refresh runs `apt-get update` and ignores a filter: it's now skipped, not filtered.
  With some APT source kept, the filter is passed through (native ignores it; apt refreshes everything anyway).
- Callers pass `{ filter: sourceFilter(settings.deviceType()) }`: Refresh on Sources (`screens/sources.js`),
  Refresh on Changes (`screens/changes.js`) and Refresh on Launch (`app.js`). These three files are outside the
  brief's file list; the filter has to be passed by someone who knows the device type, and a one-line change at
  each call site is smaller than giving both backends a settings dependency.
- Search: `scopesFor(type)` — All, Apps while Not Jailbroken. The hidden buttons keep their SCOPES index (so
  `scopeIndex` is unchanged); a Tweaks/Themes scope left from Jailbroken resets to All. Redrawn on a `device` change.
- Home: `showsThemes(type)`; the Themes tile's `<ul>` is hidden while Not Jailbroken (Featured then fills the
  row, `.home-row > .table { flex: 1 }`), redrawn on a `device` change. Featured's "Browse Themes" row is left out too.
- Tests: sources.test.js (no fetch at all with the "none" filter), altstore.test.js (wrapped APT refresh not
  called for "none", called for a jailbroken type; AltStore still refreshed), search.test.js, home.test.js.

## Left as is
- Search's Filter sheet still lists the Tweaks/Themes groups and sections. Not in the brief; whether the sheet
  should follow is a design call.
- The segments' `.selected + .scope-segment` darker divider is computed on DOM siblings, so with All selected and
  Tweaks/Themes hidden, Apps' left border is the normal one. Cosmetic.

## Not verified
- No browser render of the Search scope bar with two segments or of Home with the Themes tile hidden: only unit
  tests of the pure helpers and `node --check` of the screens. The corner radii come from `:first-child` /
  `:last-child` (All and Apps), so they should be right, but nobody looked at it.
- Not run on the phone or in the native app (task doesn't touch the device).
