# F298 AltStore source page: All Apps at the top

- `web/app/screens/altstore.js` `renderAltSource`: the "All Apps" row (and its "No app on this source runs…" footer)
  moves from below Featured to right under the source's header, above the description, news and featured apps.
  The file's top comment lists the new order. Nothing else on the page changes.
- F297 (a misread of this request) had landed an All Apps row on the Sources tab list. The user doesn't want it, so
  its code is taken out: `screens/sources.js` and `screens/browse.js` are restored to their state before F297 (no
  other commit touched them since), and `core/allapps.js` + `core/allapps.test.js` are deleted. F297's journal and
  DONE entry stay as history.
- Decision: the row goes above the description too, since the brief says "right below the source's header image".

## Not verified

- No render on a phone or in a browser: the change is a move of one existing `grouped(...)` call, so the look of
  the row is unchanged; only its position differs. The gate (`tools/check.sh`) is the check.
