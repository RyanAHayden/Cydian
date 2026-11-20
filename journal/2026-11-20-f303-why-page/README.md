# F303: Why iFizBox page

## What I did

- **web/app/screens/why.js** (new): `#/home/why`, titled `Why ${NAME}`. Ten points as iOS 6 grouped tables (header,
  2-5 short lines as rows, a real screenshot in the last cell where there is one), in the brief's order: tweaks from
  APT repos injected into sideloaded apps (lead, ElleKit bundled), one app jailbroken or not, Cydia's iOS 6 look,
  signing on the phone, Free Apple ID, LocalDevVPN/Tailscale installs, AltStore + APT sources together, safety
  labels and malware checks, re-sign/update, reviews. Ends with Get Started: Install Lite on the website, Set Up
  Signing in the sideload app, nothing in the jailbreak app. Name only via brand.js.
- Styles (`WHY_CSS`, including Home's star glyph `glyph-why`) are put into `<head>` once by `ensureWhyStyle()`, so
  no new stylesheet link in index.html (not on this task's file line); ios6.css tokens only, so palettes follow.
- **Screenshots** `web/app/img/why/*.jpg` (7, 23-85 KB): cropped from real captures already in the repo
  (docs/img README shots, F288's Sign Options capture, F290's showcase stills). `crops.py` here re-makes them
  (Pillow; local only). The bezel, status bar and captions are cropped off. The routes/resign stills keep F290's
  yellow highlight rings; I left them, they point at the thing the line talks about.
- **home.js**: route + nav, `"why"` in OPEN_WHILE_LOCKED (open on the locked website), and a "Why iFizBox?" stack
  tile right under the welcome, above GitHub | Discord: always on the website, in the sideload app until signing is
  set up (`showsWhyTile`, follows the existing `setUp` flag), never in the jailbreak app.
- **notiphone.js** (desktop / Android page): a "Why iFizBox?" row first in the bottom group, leaving the page for
  this visit onto the Why page. This file wasn't on the line; it's the only way desktops see it ("shown on
  desktop"), a 4-line add.
- **README.md**: a "Tweaks without a jailbreak" paragraph under the tagline, linking the page.
  **docs/sideload.md**: a "Tweaks in sideloaded apps" paragraph under the intro. Current state only.
- **why.test.js**: order and lead, line length (<= 64 chars), each screenshot exists at the reserved size, no
  spelled name, tile visibility per build, style injection, Home/notiphone wiring, README/doc top mention.

## Checked

- `node --test` on why/notiphone/home tests: 58 pass; `native/test_brand.py` OK.
- Headless Chromium at the 18 Pro's size (F288's capture.mjs, website mode): Home with the tile, and the page top,
  middle and end: `phone-home-and-why.png`. Desktop 1280x1100: `desktop-notiphone.png` shows the new row.

## Decisions

- The website's "Install iFizBox Lite" on the page calls Home's `installiFizBox()`, which on a jailbroken device type
  hands over the .deb instead (same as Home's green row).
- "Welcome/setup flow" read as: Home's first screen (where the welcome is) while not set up, plus the desktop
  landing page. Settings > Signing's walkthrough isn't linked: signing.js isn't on the line and the user is already
  setting up there.

## Not verified

- Not looked at on a real iPhone (website or sideload app): no task permission for the phones; Chromium only.
- The sideload app's tile hiding after signing is set up: logic tested (`showsWhyTile`), not rendered with a fake
  sideload bridge.
- Dark theme render of the page: not captured; it uses only theme tokens.
