# B271: description More opens in place

User, 2026-11-21: tapping More on an app page's description must not move the view; the text grows downward in place
(slides, no jump, no scroll into view). Less keeps today's scroll back to the description.

## What was wrong

`screens/description.js` used one handler for both rows: after the toggle it added the row's movement to the
scroller's `scrollTop`, so the row stayed under the finger. For Less that is what the user likes (the page comes back
to the description); for More it scrolled the page down by the whole opened text, which read as a jump.

## What changed

- `web/app/screens/description.js`: More now goes through `growOpen(box, open)`: it keeps the scroller's `scrollTop`
  (puts it back if anything moved it), opens the text, and uncovers it downward:
  - nav/slide.js already slides the rows below (the Less row, the groups under it) from their old place;
  - a `clip-path: inset()` on the text whose bottom edge starts at the folded height and moves with the Less row's top,
    so the text never shows under the Less row while it travels (the table's cells are transparent);
  - a `clip-path: inset(... round)` on the group's `.table` (which draws its ground, outline and corners) whose
    rounded bottom moves with the Less row's bottom, so the group's edge doesn't jump down ahead of the row. Its
    radius is read from the table's computed style, so every style keeps its own corners.
  Only clip-path animates (Web Animations, the rows' `DURATION`/`EASE`); no height, so no reflow per frame. Reduced
  motion or no layout: it just opens, still without moving the page. Less is unchanged (it cancels a running grow
  first).
- `web/app/screens/description.test.js`: growOpen keeps scrollTop and clips from the folded height; More leaves the
  scroll alone while Less still scrolls back (this one fails on the old code: More scrolled by the row's move).
- `tools/smoke/smoke.mjs` step 7: a real long description in a page, More tapped with CDP mouse events at phone size
  (390x844): every frame the scroll position is unchanged, the rows below slide, the text's visible bottom never
  passes the Less row's top and moves with it, the group's bottom edge moves with the Less row's bottom; then Less
  folds it and scrolls back with the row under the finger. With `--shots` it runs at a tenth of the speed.

- `web/app/screens/altstore.js`: the app page's second folded text, the "From the App Store" card (its More row goes
  when tapped), goes through `growOpen` too (the spec review found it): it used to swap the text at once. There the
  text gets no clip of its own (nothing follows it in its table); the table's rounded edge slides with the group
  below. Smoke step 7b checks it (scroll held, edge off by 0.0px).

Folded texts with More: `descriptionGroup` (IPA app page and AltStore pages in altstore.js, the package page in
browse.js) and the App Store card (altstore.js). One frontend serves the site and both builds; the F181 store page
style draws What's New, not a folded text.

## Tried and dropped

- A `max-height` transition on the text (like a height slide): it worked visually but animates a layout property,
  which docs/native.md forbids (120 Hz) and the smoke test fails on. The memory note said `.preview-slot` used a height
  transition; it doesn't any more (B195 made it transform + clip), so I followed revealSlot's approach instead.
- Clipping the text alone: the group's table grew at once, so an empty grey band with the group's outline showed
  under the sliding Less row (seen in the slowed smoke shots). Clipping the table too fixed it.

## Checks

- `node --test web/app/screens/description.test.js`: 7 pass.
- `node tools/smoke/smoke.mjs` and `--site`: pass, including the new step (`More kept the scroll position (1112px)`,
  text and group edges off by 0.0px, `Less ... scroll 1539 -> 1018px, row 444 -> 445`). Slowed shots looked right.

## Not verified

(filled in below)
