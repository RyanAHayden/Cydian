# B54: the screenshot gallery loads without a jump

## What changed

- `web/app/screens/altstore.js`
  - `galleryImage` now loads off the page (`loading = "eager"`: a lazy picture outside the document never loads)
    and gives `i.ready`, a promise that is true once `onload` has fired, the picture isn't icon-sized and
    `img.decode()` resolved. It is false when it failed for good (after the proxy retry) or `decode()` rejected.
  - `previewSlot` starts as a 44px loading strip (`.shots-loading`, the iOS 6 grey spinner turning a spoke at a time
    like the other spinners). When there is nothing to look in (no shots, no html, no GitHub repo) it shows no strip at
    all, so a package with no gallery shows nothing, as before. `sources` can now be a promise. The app page that waits
    for the App Store's screenshots uses that and gets the strip, instead of an empty slot swapped out later.
  - `fillGallery`: only ready pictures go in. Once the first is ready it waits up to 1.2 s for the rest. When all
    have settled, or the time is up, it builds the group with the ready ones (in source order) and `resizeSlot` makes
    one height transition from 44px to the gallery's height. The group fades in (WAAPI opacity). A picture that becomes ready
    later is inserted at its place in the sideways strip and fades in. The slot height only animates again if
    that made the strip taller (only a landscape-first gallery would do that). If none load, the slot collapses
    44→0 with the same transition.
  - `slot.gallery` settles to `{ shown, grows }` for tests.
- `web/app/altstore.css`: `.preview-slot` is `display: flow-root` (so the group's margins stay inside and the
  measured height is what the page moves by) with a `height .3s` transition. It gets `overflow: hidden` only while
  resizing. The brief allows a single height transition on the slot; transform can't move the content below.
- `web/app/screens/altstore-gallery.test.js` (new): starts as the strip; none loaded → collapses, `grows: 1`; some
  failed → only loaded ones in order, `grows: 1`; a late one joins without a second growth; empty sources → no strip;
  a promise of sources → strip meanwhile; `galleryImage.ready` true/false on load+decode, decode failure, dead URL.
- `web/app/screens/previews.test.js` (not on the task's file list, but its "lazy" assertion had to follow): now asserts `eager`.

## What failed on the way

- The first headless trace showed the content below jump up by 30px when the gallery came in. The slot's class
  `loading` matched packages.css's global `.loading` (flex, `margin: 40px 20px`). It's renamed `shots-pending`.

## Check (headless Chromium over CDP)

`srv.py` serves `web/app` and a harness (`b54.html`), with PNGs that answer after a delay and 404s after a delay.
`cdp.mjs` takes frames at 300/1000/1400/1700/2600 ms and reads the harness's trace (the top of a "Content below"
box on every animation frame). Results are in `shots/`:

| case | pictures | gallery | moves of the box below |
|------|----------|---------|------------------------|
| good (3 loading, 600–1100 ms) | 3 shown | grows: 1 | 134 → 507 in one 300 ms ease (19 frames, biggest step 46.6px at 60 Hz mid-ease), then still |
| mixed (2 dead, 2 good) | 2 shown, no blank frames | grows: 1 | the same single ease |
| dead (2 × 404) | 0 | grows: 1 (collapse) | 134 → 90 in one ease, biggest step 5.5px |

`shots/*-300ms.png` show the spinner strip. `good-1400ms.png` / `mixed-2600ms.png` show the full gallery and
`dead-2600ms.png` shows the strip gone. Run it again with
`python3 srv.py <worktree>/web/app b54.html 8754`, then `node cdp.mjs 9301 "http://127.0.0.1:8754/b54.html?case=good" <outdir> good`.

## Not verified

- Not run on a phone (iPhone 7 / iOS 15 WKWebView, or the website in mobile Safari): the task didn't call for the
  devices. The height transition's smoothness at 120 Hz on a real ProMotion screen is unmeasured; headless ran at 60 Hz.
- Not shot on a real package page inside the full app (browse.js / altstore.js app page with a live source): the
  harness mounts `previewSlot` directly with the real CSS files, which is the code both pages use.
- Dark theme look of the strip: the dark theme already maps `--spinner-gray` to white (ios6.css); not shot.
