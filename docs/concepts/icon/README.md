# Icon concepts (2026-11-18)

Kept for later changes. The chosen icon (blue starburst, OpenAppMkt-style globe) is the real one in
`tools/icon.svg.in` + `tools/icon_bg.py`, rendered by `tools/icons.sh`. These SVGs are the rounds that led there;
render one with `rsvg-convert -w 512 FILE.svg -o out.png` from this folder (they share `bg-1.jpg`, the old brown
starburst; the blue rounds recolour it with an SVG filter).

- `box-height-*.svg`: the old box at side heights 168 (was), 154, 142 (Cydia's proportions, shipped for a while), 130.
- `round2-*.svg`: box and globe ideas in white line art on the brown (rejected: looked like stickers).
- `round3-globe-*.svg`: glossy globe on blue, too big and thick-lined.
- `round4-globe-*.svg`: matched to OpenAppMkt's globe (white rim, dark outline, slate grid); `a` became the icon.

Reference images (Cydia's icon, OpenAppMkt's) are not kept here: third-party art, reference only (AGENTS.md).

## Dark-mode icon (shelved 2026-11-18)

`dark/gen.py` builds six dark starburst variants of the real icon (same `tools/icon_bg.py` generator, other colour
ramps; globe shape unchanged): 1 navy, 2 midnight (white globe), 3 black burst (blue halo), 4 twilight, 5 deep sea,
6 chrome. `dark/sheet.jpg` shows them in that order. Favourites so far: 3, then 2. Not wired into `tools/icons.sh`.

## One icon per theme

The real per-theme icons are built, not concepts: `tools/icon_themes.py` holds the theme table (names from
`web/app/theme-boot.js`) and writes one master SVG per theme; `tools/icons.sh` sashes each with LITE and renders
`native/icon/themes/<theme>/` (every AppIcon size, named as `native/icon/`'s own) and `web/app/icons/themes/<theme>/`
(flat 180/192/512, glossy 76/152/228). Dark themes: the blue glass globe on a bright-centred radial light,
recoloured per theme around its accent (Gunmetal is the original); OLED Black takes the black starburst with a blue
burst (`dark/gen.py`'s 3). Light themes: today's starburst, its ramp recoloured along its own brightness (Classic
unchanged, Sepia warm brown, Solarized cyan on cream). A new theme needs a row in `THEMES` there; the run refuses a
table that doesn't match theme-boot.js.
