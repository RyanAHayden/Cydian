# F266 Not-an-iPhone page

## What it does

- `web/app/core/platform.js` (pure, `node --test` in `platform.test.js`): `notIphoneKind(navigator, { native })`
  returns `"mac" | "pc" | "android"` or `null` (normal app). Order: native bridge → app; `iPhone|iPod|iPad` → app;
  `Macintosh` + `maxTouchPoints > 1` (iPadOS desktop UA) → app; `Android` → android; `Macintosh|Mac OS X` → mac;
  `Windows|Linux|CrOS|X11` → pc; anything else (crawlers, link-preview bots, no UA) → app, so the og: card and
  unknown clients are never locked out. `notIphonePage(win)` adds the bridge check and the dismissal key
  `ifizbox.notIphoneDismissed`; `notIphoneText(kind, NAME)` has the per-platform wording.
- `web/app/screens/notiphone.js`: `showNotIphone(kind)` builds the page from ios6.css (`.navbar`/`.nav-title`,
  `.page-body.grouped`, `.group`/`.group-header`, `.table.grouped` cells, `.bar-button` for Copy Link) and the
  guides' `.guide-num` step badges. Everything is a palette token, so light and dark follow theme-boot.js; the
  only new CSS (`notiphone.css`) is layout. The QR code uses the existing in-house encoder `core/qr.js` (already
  used by Manage/Handoff/Account), so I left `web/app/vendor/qr/` out: no vendored code needed.
- `app.js`: right after the imports, `notIphonePage(window)`; if it returns a kind, the boot spinner goes and a
  top-level `await showNotIphone(kind)` holds the rest of startup (no screens, router, refresh or alerts run under
  the page). The check is synchronous before anything is drawn, so an iPhone/iPad/native app never sees the page.
  - Look Around Anyway: stores the key, removes the page, the app starts as normal (wide.css on desktop).
  - What Is iFizBox?: removes the page **for this visit only** (not stored, my decision: they asked what it
    is, not to skip it for good) and starts the app on `#/home/guides/faq` (guides are open while Home is locked).
- `index.html`: links `notiphone.css` (before wide.css so wide.css's `.page-body` column padding still applies).
- `launch.js` (on the task's file list) needed no change.
- Extra file not on the task's list: `screens/notiphone.test.js` (fake DOM): wording, QR data URL, Copy Link copies
  `https://ifizbox.com`, Look Around Anyway stores the key and resolves `null`, What Is resolves the FAQ route and
  stores nothing.

## Checks

- `node --test` on platform.test.js and notiphone.test.js: 10/10 pass.
- Chromium headless (scratch static server, CLI `--user-agent`, theme via a same-origin page setting
  `ifizbox.appearance`), shots in this folder: `mac-1280-light/dark`, `mac-390-light`, `android-390-light/dark`,
  `android-1280-dark`, `ipad-1024-light` (normal Home), `mac-1280-dismissed` (Mac UA with the key set: normal Home).
- `zbarimg` decodes the drawn code as `https://ifizbox.com`.

## Tried / failed

- First screenshot server on port 8731 failed (port in use by something else); moved to 18266.

## Not verified

- Clicking the rows in a real browser: headless Chromium from the CLI can't click, and the repo has no
  Playwright package. Covered by the fake-DOM test and by the dismissed-key screenshot instead.
- iPadOS desktop UA in a browser: the CLI can't fake `maxTouchPoints`; covered only by platform.test.js. The iPad
  shot uses the classic iPad UA.
- Real devices (Mac Safari, Android Chrome, an iPhone): not touched; no task permission for the phones and no Mac
  browser here.
- Copy Link on a real clipboard (uses the existing `nav/menu.js copyText`).
