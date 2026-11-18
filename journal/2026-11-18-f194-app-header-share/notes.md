# F194: Share on the app page's header; no sideload tools in the jailbreak build's sheet

## What I did
- `screens/storepage.js` `storeHeader` takes an optional `action` element and puts it on the header's right edge,
  where the iOS 6 App Store had its price/install button. Install / Modify stays in the nav bar (F181).
- `screens/handoff.js`:
  - `headerShareButton(source, opts)` builds the button: the nav bar's bar button with the action glyph
    (`bar-button bar-icon share-button store-head-share`). It opens the same sheet as before (`showShareFor`), and it
    starts loading the apps' icons. It returns null when there is nothing to share.
  - `SIDELOAD_TOOLS` lists every app that takes an IPA source: AltStore Classic, AltStore, SideStore, Feather,
    LiveContainer, StikStore, TrollApps, Scarlet, ESign and GBox. `shareItems` takes a `mode`, which defaults to
    `detectMode()`. When it is `"jailbreak"`, the list drops these tools. A source page and an app page in the
    jailbreak build then show Copy Link and Add on Another Device for an IPA source; APT sources keep the four APT
    managers. The sideload IPA (`"sideload"`) and the website (`"site"`) keep the full list.
- `screens/altstore.js` `renderApp` passes `headerShareButton(...)` as the header's action. It no longer calls
  `setSourceShare`, so the page has one Share, on the header.
- `altstore.css`: `.store-head .store-head-share` lines the button up with the top of the header text.
- Tests:
  - `handoff.test.js`: the jailbreak, sideload and site lists; the header button opens the sheet (with a fake DOM
    that drives the real `nav/sharesheet.js`) and lists no sideload tools in the jailbreak build.
  - The same file reads the source to check that renderApp passes the button as the header's action.
  - `storepage.test.js`: the F181 "no button in the header" check now lets `headerShareButton` through. A new test
    covers `action`.

## Renders
`harness.html` (serve `web/` so that `app/` resolves; the real CSS and modules) at 3x in headless Chromium:
`header-3x-light.png`, `header-3x-dark.png`, `header-3x-pressed.png`. I checked them zoomed in. The button is the
bar button with its border and gradient. There is no light line at the bottom, and the glyph is centred and lined up
with the top of the name. The dark theme uses the dark bar button.

## Tried that failed
- A render of the open sheet (`?open`) came out without the sheet. The likely cause is the harness's
  `html{height:auto}` override, or the screenshot landing during the slide-up. The sheet itself is F76's and did not
  change here. The unit test checks that it opens and what it lists.

## Not verified
- I did not render a real app page in the app or on the site; only the harness. The live page needs a source to
  load, and it is wired the same way through `storeHeader`. A source-reading test covers the wiring.
- Not checked on the iPhone 7: the task does not call for the phone.
- The jailbreak build's mode comes from `cydianNative.mode` (`core/settings.js` detectMode). The unit test sets the
  mode directly; I did not run a real native build to check it.
- browse.js's APT package page still has no Share on its header. The task named the AltStore app page, and APT
  package pages keep their Open In group.
