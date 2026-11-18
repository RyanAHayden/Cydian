# F76: Share button and the iOS 6 share sheet

## What I did

- `web/app/nav/sharesheet.js` (new): `showShareSheet({ items })`, UIActivityViewController as iOS 6 draws it on
  the iPhone, and `setShare(body, open)`, which puts the Share button (the iOS 6 action icon) in the page's nav bar,
  left of the page's own right button (Edit, Install). It creates the button the first time it's used, so no
  screen's `nav()` or `app.js` had to change, and the existing tests that read `nav().right.label` still hold.
- `screens/handoff.js`: `shareItems(source, { app, jailbroken, origin })` (pure, tested) lists Copy Link (the
  source's URL), Add on Another Device (the existing /add QR sheet), then `sourceLinks` hand-offs, each with a tile
  (`APP_TILES`: initial letter on a colour close to that app's own, no copied icons). An app's page gets the first two
  only. APT managers show only for a phone set to Jailbroken, the same rule `openInGroup` used. `setSourceShare`
  connects it to a page.
- APT source page (`browse.js` drawSections), AltStore source page and the unsupported-format page, and the app page
  (`altstore.js`): the Open In group is gone, and `setSourceShare` takes its place. The AltStore source page keeps
  header, news, featured, All Apps, Website.
- `browse.js setRightLabel` now skips the Share icon (`:not(.share-button)`), so Install/Modify still finds its own
  button.
- `ios6.css`: `.share-*` and `.bar-button.share-button`. The action icon's two paths come straight from the kit's
  "Action" bordered button (sheet.svg shape_89 masks), drawn white with the bar text's dark shadow.
- Tests: `web/app/screens/handoff.test.js`.

## Decisions (unattended, so written down here)

- **3 a row and a translucent black panel, not "4 a row on dark linen".** The brief remembers the sheet as 4 a row
  on linen. The Teehan+Lax kit, which AGENTS.md makes the source of truth, has the iPhone share sheet ("Share" layer):
  3 a row, 57 pt icons 100 pt apart, a black panel at about .7 that fades to grey over its top 42 pt, and the black
  "Button (Large Black Semi)" Cancel. I followed the kit. More than 9 items (an ESign source has 10) go on a second
  page you swipe to, with page dots, as iOS 6 paged them.
- **The icon is iOS 6's, not "a square with an up arrow".** That shape is iOS 7's action icon. iOS 6's is a tray with
  an arrow curving up and out of it to the right, which is what the kit draws, so that's what this uses.
- **Copy Link copies the source's URL on the app page too.** That URL is what Add on Another Device encodes, and
  Cydian's own hash route to an app only works where that source has already been added.
- **APT package pages keep their Open In group.** The brief only names a source's page and an app's page. Moving an
  APT package's page to Share would be its own task if the user wants it.
- Copy shows the HUD ending on "Copied" (`hud.done`), because a web page gives no other sign that the copy worked.
  It falls back to `execCommand("copy")` where `navigator.clipboard` refuses.
- Item actions run inside the tap, while the sheet starts closing, so clipboard writes and `location.href` app links
  keep the user's gesture.

## Tried and dropped

- I first added `className`/`ariaLabel`/`hidden` to `app.js`'s nav `button()` and a `shareButton()` spec for each
  `nav()`. That would have touched `app.js` (not on this task's file list) and turned package pages' `right` into an
  array, which breaks `home-browse.test.js`. `setShare` now creates the button itself.
- Chromium drew a focus ring around Cancel (it's focused on open). `.share-cancel:focus { outline: none }`.

## Checked

- `node --test web/app/screens/handoff.test.js`: 5 pass. The whole `node --test web/app/screens/` passes.
- Headless Chromium at 2x and 3x, 320x568, on a scratch page that loads the real CSS and `showShareFor` for an
  AltStore, APT and ESign source: compared by eye with the kit's composite (`original-2x.png` crop x 131-771,
  y 2100-2937). Grid, labels, panel fade and Cancel line up, and the nav icon matches the kit's "Action" button.

## Not verified

- **On the phone, and in the real app shell**: I only rendered the sheet on a scratch page, not inside
  `index.html` with a real source page. This run had no device task (and AGENTS.md says to touch the 4S only when a
  task says so), and the brief says the user tries it. So the button's position next to Edit/Install in the live
  nav bar, the dark theme, and the slide-in timing on a real WebKit are all unchecked.
- **Each hand-off link opening its app**: the URLs are `core/handoff.js`'s, unchanged and tested there, but nothing
  here opens them on a device.
- **The clipboard write on iOS Safari / WKWebView**: there's a fallback, but neither path was run on a phone.
