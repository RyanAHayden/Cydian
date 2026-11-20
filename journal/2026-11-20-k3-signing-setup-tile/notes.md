# K3 Signing Needs Setup tile (concept)

Page: https://claude.ai/artifact/M5uPpxgUxsy3pvbJ9gY4P3 (source: concept.html here)

User: with no certificate and no login, Home's plain Signing half-tile should go; the expiry tile's spot says
signing needs setup instead.

Where it lives today (web/app/screens/home.js):
- `showsSigningTile(mode, setUp)` + `signingSetUp(mode)`: the Signing half-tile (sideload + site) while not set up;
  sideload "set up" = `missingStep(status, server) == null` (certificate + https server), site = `signingReady()`.
- `certRow()` / `paintCert` / `CERT_STAGES` (F244): the full-width expiry tile, sideload only, styles in
  home.css `.home-row.cert.{soon,close,gone}`.

Options: A red tint fixed text, B amber + next step from `missingStep` (recommended), C solid red.
An ASC key (devaccount.js) or free Apple ID without a certificate still counts as "needs setup".

**Not verified**: the mock is hand-drawn HTML, not a render of home.css; exact website subtitle wording when the
Free Apple ID relay is off.

**Page:** https://claude.ai/artifact/M5uPpxgUxsy3pvbJ9gY4P3
