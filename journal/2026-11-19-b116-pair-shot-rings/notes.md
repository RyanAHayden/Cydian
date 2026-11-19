# B116: pairing guide screenshots ring the row to tap

## What I did
- The committed screenshots were already cropped to the bare row (F268's `crop.py`), so a box "on the row" would
  only have traced the image's edge, and the reader couldn't see which row among its neighbours to tap. AGENTS.md
  allows committing whole iOS Settings screenshots (icons included) for tutorial steps, so I re-cropped the user's
  originals (`ref/pair-shots/`, main checkout) to the row plus its neighbours, at full width (1206 px, 3x), with
  `crop.py` here: Face ID / SOS / **Privacy & Security**; Apple Intelligence Report / Security header /
  **Developer Mode** / Wired Accessories; Other Devices header / **Pair with iFizBox** pill. JPEG q78, 12–29 KB each.
- Measured each row on the originals with Pillow (`profile.py` = luminance down a column, `hprofile.py` = lit extent
  of a line): group spans x 48..1158; separators are 3 px lines (212–214, 359–361, 527–529…); a row runs from the
  middle of the separator (or the group edge) to the next. Rows are 145.5–148.5 px tall, pitch 147.
- `PAIR_GUIDE` steps now carry `size` (image px) and `box` ({x, y, w, h} in % of the image). `ringStyle(box, pad=3)`
  (core) turns a box into absolute-position styles 3 CSS px outside the row on every side.
- Screen: the image sits in a `div.pair-shot` (position relative) with a `div.pair-ring` laid over it. CSS
  (settings.css, where the old `.pair-shot` rule lived; the brief's `app.css` does not exist and a new file would
  need an index.html link): 2.5 px solid #0a84ff (iOS dark-mode system blue), `border-radius: 999px`, no shadow. A
  pill matches the rows' own shape: the Pair row is a pill, and the group's corners are ~75 px, about half a row.
  The old orange #f5a623 box-shadow around the whole image is gone.
- Tests: every screenshot's `size` equals the JPEG's real size (SOF marker parsed in the test), its box is inside the
  image, is one row's shape (120–170 px tall, >900 px wide), and leaves ≥12 image px (3 CSS px at 300 px) around it
  for the ring; `ringStyle` output.

## Checked
- Headless Chromium render at DPR 3, 402 and 320 px wide (`shot.mjs` here, F268's with a taller viewport, fake
  sideload bridge), zoomed 2x on each ring: the ring hugs each row with even margins, top/bottom/left/right; all three
  rings render the same height (119 device px at 320 wide).

## Not verified
- On a real iPhone (WKWebView, iOS 15 jailbreak app or the sideload IPA): not tried; the task didn't call for the
  phones. `calc(% ± px)` in `left/top/width/height` and `border-radius: 999px` are long supported in WebKit.
