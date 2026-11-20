# C24: break the screens/settings.js import hub

## What I did
- `web/app/settings-store.js`: the settings store instance (`createSettings({ mode: detectMode(), helper, native })`),
  moved out of screens/settings.js, unchanged.
- `web/app/nav/switch.js`: `createSwitch`, moved out of screens/settings.js and not changed.
- screens/settings.js imports both and re-exports them (`export { settings, createSwitch }`), so app.js
  (`settingsScreen.settings`), queue.js's lazy `import("./settings.js").then(m => m.settings…)` and the tests that
  import `settings` from the screen keep working unchanged. Removed its unused `createSettings` import.
- The 16 importers that took only `settings` / `createSwitch` from the screen now import the new modules: device.js,
  signing-sheet.js, screens/{website-settings,handoff,findmore,search,importlink,account,extras,installed,browse,
  altstore,sources,changes,home,manage}.js.
- `web/app/import-cycles.test.js`: finds static-import cycles in shipped web/app modules (Tarjan SCC, the same
  static-import regex as module-graph.test.js; import() is ignored). Also checks that screens/settings.js is in no
  cycle and that no module except app.js imports `settings`/`createSwitch` from the screen.

## The cycle, and the ones it did not cover
Before: `device.js -> screens/settings.js -> screens/version-foot.js -> device.js` (static imports; the 6-file
loop in the audit counted dynamic edges too). It is gone now.

The cycle finder found four more static cycles that this task did not cover:
core/altstore.js <-> core/sources/ipa.js, core/catalog.js <-> core/installed.js, a 10-module loop in signing/
(left by C28's split), and screens/browse.js -> manage.js -> roulette.js. Breaking them means changing files that
belong to other work, so I didn't do it here. Decision: the test lists them in `KNOWN` and fails on any cycle
not in that list, and also when a listed one has gone (so the list only shrinks). They are filed as C35-C38
(low, after C24), one per cycle.

## Checks
- `node --test web/app/import-cycles.test.js web/app/module-graph.test.js`: pass (startup closure still under
  its cap of 124 with the two new modules).
- `node --test web/app`: 2504 pass, 0 fail. `run done` then runs the whole gate (tools/check.sh).

## Not verified
- I didn't drive the app on a phone or in a browser: this is a pure module move with the same code. The node tests
  and the browser smoke test in the gate (if it runs here) load the modules. The store now gets created as soon as
  device.js loads instead of when screens/settings.js loads. Both happen during startup, after the native bridge
  global is injected, so `globalThis.ifizboxNative` is read the same way. I did not check this on a device.
