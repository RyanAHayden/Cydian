# C35: break the core/altstore.js <-> core/sources/ipa.js import cycle

ipa.js needed altstore.js's parser (parseAltSource, appStanza, str, httpUrl); altstore.js needed ipa.js's
parseIpaSource for parseSource (used by refreshAltSource, the catalog and Manage). Moving parseSource out instead
would have dragged refreshAltSource and withAltSources along, so the parser went:

- New `web/app/core/altparse.js`: the pure parse half of altstore.js, moved verbatim (str, httpUrl, tintOf, dateOf,
  compareOS, runsOn, parseVersion…, parseAltSource, appSection, appStanza), plus `looksLikeAltSource` now exported
  (parseSource uses it). It imports only core/urlencode.js.
- `core/altstore.js` imports str/httpUrl/looksLikeAltSource from it and re-exports the public names, so none of
  its ~20 importers changed.
- `core/sources/ipa.js` imports from `../altparse.js`.
- The KNOWN line is gone from import-cycles.test.js.

Checks: `node --test web/app/import-cycles.test.js web/app/module-graph.test.js web/app/core/` passes (933).
Gate run by `run done`.

The move was done by splitting the file at line boundaries into scratch files and concatenating them (plain
`sed -n`/`cat` with redirects), then fixing imports with the edit tool. Comments elsewhere (worker/src/push.js,
native/sign/Updates.swift) still say "altstore.js runsOn"; left alone since altstore.js re-exports it and the task
asked to keep changes local.

**Not verified**: the jailbreak app and sideload IPA were not run on a phone. The move only touches web/app's
module layout, and the app loads the same web/app files, so the node tests cover it.
