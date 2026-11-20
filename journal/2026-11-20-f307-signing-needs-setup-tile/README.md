# F307: Signing Needs Setup tile (concept K3, option C)

Approved option C on the K3 page: a solid red tile (the expiry tile's "gone" look) in the certificate-expiry tile's
place whenever signing isn't set up; the plain Signing tile goes; the website gets it too; the same tile for a
Signing Server that is set but down.

## What I did

- `core/signing.js`: `signingTile({ setUp, serverUp, server, warning })`, `SETUP_TILE`, `serverDownTile(server)`.
  Order: Signing Needs Setup ("Nothing can be installed yet", the concept's wording) > Certificate/Profile Expired
  > Signing Server Down ("Can't reach <host> · Check in Signing") > the amber/red expiry warning. Expired beats
  Server Down because a re-sign is the bigger job and both stop installs; needs-setup beats both because neither
  can be judged without a certificate.
- `screens/home.js`: `certRow()` is now the one signing slot (`showsSigningSlot`: website + sideload app). It asks
  `signingSlot(mode)`: `signingSetUp`, then (sideload only, once set up) the identity and `serverReachable(getServer())`
  in parallel. Re-checked on Home's root hash (Back from Settings > Signing), on `visibilitychange` (app return),
  on Settings > Signing's status event, and on Reload (`slotRow.recheck`). The Signing half-tile under Browse and the
  locked website Home's full-width Signing tile are both removed: the red tile sits at the top already, so the
  locked one would have been a duplicate. Same row, glyph (`failed`) and CSS (`.home-row.cert.gone`), no new colours.
- Website: a saved Free Apple ID login (`free-apple-id.js loadFreeIdentity`, dynamic import) counts as set up, per
  the task's "no certificate and no Apple ID login". Note that the website can't install with the free route alone
  (R32), but the user's wording asks for the warning only without either.
- The website has no Signing Server check: it signs in the browser and installs through its own Worker; if that is
  down the page isn't there either.
- Expiry warning still only in the sideload app and still behind Show Expiry Warning (unchanged); the setup and
  server tiles ignore that switch.
- Tests: `screens/home-signingslot.test.js`. `docs/signing.md` line updated.

## Tried / failed

- One edit to home.js went through a python heredoc (replacing the Signing tile block); later edits used the edit
  tool. Result checked by `node --check` and the tests.

## Not verified

- Not seen on a phone or in a browser: no render of the tile in the sideload app or on the website, no 3x zoom
  check. It reuses the existing `gone` styles unchanged, so the look should equal Certificate Expired.
- Signing Server Down against a real down server: only tested with stubbed `serverReachable`. An offline phone
  (navigator.onLine false) also shows Signing Server Down; I left that as "unreachable", which the task includes.
- The website with a Free Apple ID login hiding the tile was tested only through the injected `free` stub.
