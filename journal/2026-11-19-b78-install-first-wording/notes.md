# B78: Install iFizBox First popup no longer overclaims

## What changed

`web/app/websign-gate.js` had the same claim in three alerts: FIRST_VISIT (Install iFizBox First, Not Now /
Install), BROWSE_GATE (the locked-row popup) and WARNING (Install on the Website?). They said apps are "signed and
installed on the iPhone itself ... with no upload". That isn't quite right. Signing and the IPA do stay on the
phone, but iOS's install prompt needs an itms-services manifest over HTTPS, and that comes from the Signing Server
(`/sign/manifest`), which sees the bundle ID, name and version.

All three now say: "The NAME app signs your IPAs on the iPhone, so your apps never leave it: much faster than this
website. (Our server only sends iOS the install prompt.)" WARNING uses the short form: "Install in NAME signs on the
iPhone, so your apps never leave it: much faster. (…)". The name comes from `${NAME}`, never spelled out.

New test in `websign-gate.test.js`: all three messages make the new claim, and none says "no upload" or "installed
on the iPhone itself". BROWSE_GATE isn't exported, so the test reads it through `askToBrowse` with a stub alert.

## The rest of the grep: left as is, on purpose

- `screens/guides.js:51` ("signed and installed on the phone") and its lite answer: true. The install does happen
  on the phone, and the text claims nothing about uploads or servers.
- README "Signing happens on your own device ... No server ever signs anything or sees your key": true. The
  `/sign/manifest` row in the Worker table already says what the server is for.
- docs/signing.md (On the phone, option B row) and docs/sideload.md (iFizBox section) already say the Signing
  Server sees the app's bundle ID, name and version. The brief also mentioned the "phone's LAN IP", but that is only
  true of Feather/api.palera.in, and docs/sideload.md:137 already says so. iFizBox's manifest names
  `http://127.0.0.1:<port>`, so our server gets no LAN IP. Adding one to the docs would make them wrong.
- `screens/settings.js:822,1295` ("signed in the app, on the iPhone itself"): true, signing only. That file isn't
  in this task anyway.

## Checks

- `node --test web/app/websign-gate.test.js`: 13/13 pass. `python3 native/test_brand.py`: OK.
- Rendered FIRST_VISIT and WARNING at 320×568 @2x in headless Chromium: a scratch page that imports `showAlert`
  and the alert objects from `web/app/`. Both read cleanly.
- Seen in that render: the "Install iFizBox" button shows as "Install iFiz…". That's the button title, not this
  change: Chromium on Linux has no Helvetica Neue, so the fallback font is wider. I couldn't check it on a phone.

## Not verified

- Not seen on a real iPhone (Safari, Helvetica Neue). This task doesn't allow driving the iPhone 7's screen. That
  includes whether the "Install iFizBox" button truncates there.
- BROWSE_GATE (three stacked buttons) wasn't rendered. It has the same message text as FIRST_VISIT, which was.
