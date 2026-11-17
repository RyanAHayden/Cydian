# F31: Cydian's icon

The user asked to "get cydia icon or remake it". Cydia's icon is SaurikIT's trademark and AGENTS.md says never
commit it, so this is a remake: our own drawing with the same idea.

## What I did

- Looked at `ref/4s/Applications/Cydia.app/icon@2x.png` and `Icon-60@3x.png` for the era's style only. They are
  Apple CgBI PNGs, decoded locally with `tools/themecmp.py`'s `load()`, and nothing from them was committed. Their
  idea: a white ring and a white box drawn with brown lines, on a brown-tan gradient.
- (First version, since redrawn: see below.) Drew `web/app/icons/icon.svg`, the one master, by hand. It has a **warm amber gradient** (#f6b25c → #d97a33 →
  #9a4518) with a soft glow behind the middle, and a white ring. Inside the ring is an **open shipping box** seen
  from the front: a dark inside, a back flap leaning away, side flaps folded out, a strip of tape and a label on
  the front, and a **down arrow dropping in** ("install"). It differs from Cydia's on purpose: no stack of small
  cubes inside, a front view instead of a three-quarter view, a different palette. The master is flat and square
  with no gloss, because iOS 7+ masks the corners itself.
- `tools/icons.sh` (needs rsvg-convert) builds everything from the master:
  - `web/app/icons/icon-glossy.svg`: the iOS 6 variant for places inside the app. It is the master's drawing
    with iOS 6's rounded corners (radius 10/57 of the side) and the system gloss (a white sheen over the top
    half with a curved lower edge). It is generated text: it copies the master's content, so there is still one
    master.
  - `icon-180.png` (apple-touch-icon), `icon-192.png` and `icon-512.png` (manifest), all flat.
  - `icon-glossy-{58,116,174}.png`: the glossy variant at the Home header's 58pt, 1x/2x/3x.
  - `native/icon/AppIcon60x60{,@2x,@3x}.png` (60/120/180), flat. They replace the old parcel.
- Wiring, outside the task's file list but needed for it to work, each change one or two lines:
  `web/app/manifest.json` now lists 192 and 512; `web/app/screens/home.js` points the Home header at
  `icons/icon-glossy.svg`.
- Removed the old parcel's copies, `web/app/img/cydian-icon.svg` and `native/icon/icon.svg`. Only `home.js` used
  the first, and nothing used the second. This leaves one master.
- `web/app/icons/test_icons.py` (in the gate) checks:
  - every PNG exists at its size;
  - `icon-glossy.svg` still holds the master's drawing (it fails with "run tools/icons.sh" when it's stale);
  - the master has no gloss;
  - the manifest, `index.html` and `home.js` point at files that exist.
- Screenshots:
  - `home-header.png`: Home in headless Chromium at 2x, served from `web/app/`.
  - `home-screen.png`: a mock home screen at 3x, scaled to half. It shows the native @3x and the web 180 icons
    with iOS's rounded mask, beside placeholder apps.

## Redraw: the classic colour and starburst (user direction, relayed by another session)

After the first version landed, another session passed on the user's direction: make it like the original Cydia
icon, with our own little download box, on the classic colour with the star pattern behind it. Keep the rest of
F31. So the master's background changed (the box and arrow glyph stayed):

- A warm brown radial base, with colours sampled from the 4S's Home screenshot (`ref/4s/screens/cydia-home.png`,
  icon at x 50-168, y 150-268 @2x): #442213 at the edges, rising to about #8e5a46 at the middle.
- A starburst: 138 thin wedges of #a37060 from the centre, each 0.5-2.2° wide with 0.4-2.2° gaps and opacity
  0.2-0.75. They fade towards the corners under a radial mask, with a lighter glow at the centre. I laid them out
  once with Python (`random.Random(31)`) and wrote them into the SVG as plain paths, so the master stands alone.
- The white ring is a little thinner (40). The glyph's lines and the inside of the box use the same browns.
- The flat master has no glossy top band. iOS 7+ takes it flat, as the brief says. The band is in the glossy
  variant: `tools/icons.sh`'s gloss is now stronger (0.62 → 0.18) with a flatter, higher lower edge, like the
  4S's.
- I didn't redraw Cydia's stacked boxes: the glyph is our open box with the arrow going in. The starburst is
  drawn from scratch and not traced: the rays are random, not Cydia's.
- The screenshots were taken again for the new art. `glossy-and-flat.png` shows the glossy variant beside the
  flat master. While comparing, I placed a crop of Cydia's icon next to ours but didn't commit that image,
  because AGENTS.md forbids committing Cydia's logo.
- The colours and the starburst-in-a-ring layout are now close to Cydia's on purpose (the user asked for that).
  The glyph and every path are ours. If the trademark ever matters, the glyph is what tells the two apart.

## Decisions

- About has no icon. It is an alert, like Cydia's on the 4S (`ref/4s/screens/cydia-about.png`), so the glossy
  PNGs serve the Home header and any future iOS 6-style spot. I didn't add an icon to About.
- `AppIcon60x60.png` (60, 1x) is generated because the brief asks for it. `native/build.sh` copies only @2x/@3x,
  and no rootless iOS 15+ iPhone is 1x, so I left build.sh alone (it isn't in this task's files).
- A first draft had the ring a bit low and the box small inside it. I centred the ring and scaled the drawing to
  1.05 so the side flaps and box corners stay clear of the ring.

## Not verified

- **The icon on a real iPhone home screen.** The 4S runs iOS 6, which the native app doesn't target, and this
  task doesn't permit driving its screen. `home-screen.png` is a browser mock-up, not SpringBoard.
- **The native build with the new PNGs.** It runs in the gate only where the iOS toolchain is set up. The file
  names and sizes are unchanged, and `native/test_native.py` copies them.
- **PWA install on iOS and Android** (apple-touch-icon and manifest icons). Not tried on a device. The references
  are checked by `test_icons.py`.
- **The PNGs being byte-for-byte reproducible.** Other librsvg versions may anti-alias differently, so the test
  checks sizes and the glossy SVG's source, not PNG bytes.
