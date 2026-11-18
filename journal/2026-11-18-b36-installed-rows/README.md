# B36: every row on Installed's apps list opens, holds and swipes

User 2026-11-18: OpenTennis Beta on the sideload app's Installed page couldn't be tapped (and didn't highlight), while
iFizBox could; they also wanted a hold for actions and a swipe for remove.

## Cause

`web/app/screens/installed.js` drawAppList gave a row an href only when a source still listed the app
(`cands.has(r.id)`), so OpenTennis (no source lists it now) was a plain `div.cell-inner`: app.js only presses
`a.cell-inner`/`button.cell-inner`, so no blue. F91's extra rows (signed apps the list doesn't remember) had no href,
no decorateApp (no swipe Delete) at all.

## What changed (all in installed.js)

- `appRowHref`: the source's `package:<id>` page when a source lists the app, else a new installed-app page
  `app:<id>` (`pageKind` "app": under the root without a jailbreak, under `#installed/apps` in the jailbreak app).
  Every row, extra rows included, is a link now, so the pressed highlight comes from app.js as for other rows.
- The installed-app page (`renderAppPage`, `appPageSections`): browse.js `installedAppSection` (version, I4's note)
  plus Bundle ID (and the original ID when signed as another), Source, Installed date, Signature ("6 days left",
  core/signing.js signatureState), then the actions as rows and Remove in its own group (myipas.js's IPA page style).
- Hold (nav/menu.js `longPress`, 500 ms, as Sources uses): an iOS 6 action sheet (nav/actionsheet.js) with
  `appActions`: Open (sideload: `signing.openApp`, not for iFizBox itself), Re-sign (sideload, when signing.installed
  has the app: queues `resignJob` like Re-sign All), Save Signed IPA (when My IPAs has a signed copy of that bundle ID:
  `library.export`, the label myipas.js uses for the same call), Remove (red; never on iFizBox's own row).
- Swipe Delete on every row but iFizBox's own: an extra row's Delete calls `signing.forget` (as Settings > Signed
  Apps) and reloads the list; a remembered row's `removeInstall` as before. The self row gets `data-self` and no
  delete controls, and the swipe skips it (its removeInstall never worked anyway: core/installed.js withSelf adds it
  back).
- The list's table is built by an exported `appListElement` so the test can drive it with a fake DOM.

Decision: no packages.css change was needed (the brief listed `web/app/css/packages.css`, corrected to
`web/app/packages.css`): the rows reuse `.source-row`/`.del-confirm`/`.cell-inner.is-pressed` as they are.

## Checks

- `node --test web/app/screens/installed.test.js`: 29 pass, 5 new B36 tests (hrefs for a no-candidate row and an extra
  row, `a.cell-inner` on every row, swipe arms Delete on the extra row and never on iFizBox's, a 500 ms hold opens
  the sheet with Open/Re-sign/Remove and runs the choice, actions per build, kept-IPA match, the app page's rows).
- 3x render (headless Chromium, `--force-device-scale-factor=3`, the real stylesheets, rows from `appListElement`):
  `list-3x.png`: OpenTennis Beta drawn pressed (blue, white text, chevron), the extra row "Mine" with its Delete.
- `tools/check.sh` via `agent-runner done`.

Tried and failed: the first hold test read the sheet straight after the timer tick; `appSheet` awaits the kept-IPA
lookup first, so the assertions moved after a `setImmediate`.

## Not verified

- On a phone (sideload build): nothing here drove a real touch. The render sets `.is-pressed` by hand (what app.js's
  pointerdown does for `a.cell-inner`), not through a real tap; the hold and swipe are tested with synthetic pointer
  events in a fake DOM. No task permission to use the iPhone 7, and the sideload IPA isn't on a test device.
- `signing.openApp`, `signing.forget`, `library.list`/`library.export` from this page: the calls exist in
  Sideload.swift/MyIPAs.swift and are used the same way elsewhere, but weren't run from here.
- The installed-app page wasn't rendered (its loading needs the app's backend); `appPageSections` is unit tested.
