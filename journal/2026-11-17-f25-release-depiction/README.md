# F25: Release Depiction as the fallback depiction

## What I did
- `web/app/core/sources.js`: `verifySource` and `refreshSource` now keep the Release's `Depiction:` field on the
  source record as `depiction` (null when the Release has none). `refreshSource` only sets it when a Release was
  read, so a flat repo whose Release can't be fetched keeps the stored template.
- New `releaseDepiction(source, id)`: the template with every `*` replaced by the id (Cydia replaces all
  occurrences), null unless the result is http(s).
- `web/app/screens/browse.js` `renderPackage`: the HTML depiction (the "Depiction" row that opens the sheet) is the
  package's own `Depiction:`, else the source's template. Decision: a package with its own *non-http* Depiction
  gets no fallback, which is how Cydia reads it ("the package's Depiction:, or else the source's"; the http check
  comes after). Sileo JSON depictions are unchanged and still win for the native view.
- Test in `web/app/core/sources.test.js`: add and refresh keep the field, a Release without it clears it, no
  Release leaves it, `*` substitution, non-http and missing templates give null.

## Tried and failed
Nothing.

## Not verified
- Not checked in a browser: no rendered package page with a fallback depiction. It needs a repo whose Release has
  `Depiction:` and a package without one, served through the proxy; the browse.js change is one expression and
  the URL logic is unit-tested.
- Sources already stored before this change have no `depiction` until their next refresh (Refresh in Sources, or
  the app's auto refresh); nothing migrates them. Not tested on a device; the 4S was not touched (the task doesn't
  say to).
- `Support:` templates (the same Release fallback for the Support row) are not done: the package page has no
  Support row yet, and the task only asked for Depiction.
