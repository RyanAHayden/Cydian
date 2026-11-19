# B107: AltStore app page lit the last screenshot dot at open

## What was wrong
`galleryGroup()` in `web/app/screens/altstore.js` calls `drawDots()` → `markDot()` while the group is still
detached (previewSlot builds it, then puts it in the page). Detached, `scrollLeft`, `clientWidth` and `scrollWidth`
are all 0, so the "at the end" rule `scrollLeft + clientWidth >= scrollWidth - 2` (0 >= -2) was true and the last
dot went dark. Nothing scrolls until the user touches the strip, so the wrong dot stayed.

## What I did
- `markDot()`: the end rule now applies only when `strip.clientWidth > 0`. Detached, every `offsetLeft` is 0, so
  the nearest-left-edge search keeps `at = 0` and the first dot is dark.
- `altstore-gallery.test.js`: a test builds a gallery of 3 pictures through `previewSlot` with every element's
  layout numbers at 0 (a detached node) and expects dots `[on, off, off]`. Checked it fails without the fix
  (1 fail) and passes with it.

Once attached, the strip only changes its dot on a scroll event, as before; a first-paint check isn't needed because
the strip opens at scrollLeft 0, where dot 0 is right.

## Not verified
- Opening opentennis on the public site and seeing the first dot dark: the site only serves `main` after the runner
  merges and publishes this branch, and this unattended session has no browser on the published site. The unit test
  reproduces the exact detached state (all widths 0) that caused it.
