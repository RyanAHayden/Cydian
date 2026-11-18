# F175: the link-preview card for iFizBox

**What I found.** Most of the brief had already landed with the rename: F170 rendered og.png with the globe icon
and the new name and moved og:image to `?v=3`, and F172 put og:url and og:image on ifizbox.com. `native/brand.py
sync` writes index.html's title, og:site_name, og:title and og:image:alt from brand.env (index.html is static
because crawlers don't run JS, so it can't import brand.js; brand.py is the brand source for it). manifest.json says
iFizBox, and apple-touch-icon / manifest icons are the globe `icon-web-*` at `?v=3`.

**What I did**
- Re-rendered `web/app/icons/og.png` from `tools/og.html` on the current main, using headless Chromium as its header
  describes, plus a small http.server subclass that answers `/` and missing paths from web/app/. Home's header has
  changed since F170's render (a smaller icon, and a Browse row now shows at the bottom), so the card now shows the
  app as it is today. About 1.3% of the pixels changed, all of them inside the phone's screen. The card is in
  this folder: `og.png`. Checked by eye: globe icon, "iFizBox", "ifizbox.com" button, and iFizBox on the white 4S.
- Added `web/app/icons/test_og.py`: index.html and manifest.json have none of the old name; og:image is
  `https://<brand.js DOMAIN>/icons/og.png?v=3`; title, og:site_name, og:title, og:image:alt and manifest name come
  from brand.js NAME; og.png's real size matches og:image:width/height.
- Live check: `curl https://ifizbox.com/` already serves all the new tags (title, og:*, og:image `?v=3`, manifest
  iFizBox). `/icons/og.png?v=3` answers 200 image/png.

**Decisions**
- I kept `?v=3`, as the brief says. Anything that cached v=3 already holds F170's iFizBox card. The only
  differences in the new render are inside the phone screen, so a v=4 bump would only make the caches fetch a
  near-identical card.
- I added no separate `twitter:title/description/image` tags. X falls back to og:title, og:description and og:image,
  and new tags would spell the name in index.html outside what brand.py sync manages (native/ is outside this task's
  files).

**Tried and failed:** none.

**Not verified**
- How Discord, iMessage and X show the card. Each one needs someone to paste the link into the app, and nobody
  watches this unattended run.
- That ifizbox.com serves the *re-rendered* og.png. It goes live only after this branch merges and deploys. What is
  live now is F170's card, which is already iFizBox.
