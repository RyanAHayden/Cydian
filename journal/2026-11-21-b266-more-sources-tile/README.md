# B266: More Sources takes See What's New's place on Home

User, 2026-11-21: "more sources option should go up and replace what's new item, make it highlighted with its blue
like see what's new is".

## What changed (web/app/screens/home.js)

- `stateTile()` returns `{ kind: "more", label: "More Sources", href: MORE_SOURCES_HREF }` where it gave See What's
  New (sources loaded, none failed, upgrade count unknown). Loading, Add a Source, Upgrades Available, Failed and
  Up to Date are unchanged.
- `paintTile()` draws the More Sources row icon (`rowIcon("moreSources")`, the blue plus, this Style's art) inline
  on the tile's glyph in place of a green glyph, so the tile keeps the green row's highlighted look with More
  Sources' blue icon. It repaints when Theme > Style changes.
- The More Sources row in Home's list (`MORE_SOURCES_ROW`) gets `hidden` while the tile is More Sources
  (`showsMoreSourcesRow`); nav/slide.js slides the rows when it goes or comes back.
- The link is the row's own (`#/sources/more`, Sources > More on Home's stack through router mountLink).
- Locked website: the whole state row is `.home-locked` already, and the list row still is, so More Sources stays
  locked either way (test checks `openWhileLocked(MORE_SOURCES_HREF)` is false).

Read "its blue" as More Sources' own blue icon, and "highlighted like See What's New" as the green state row
it sits in. home.css is not in this task's files, so no new CSS: the icon is set inline.

## Checks

- `node --test web/app/screens/home.test.js`: 12 pass (tile kinds, row shown for every other kind, hidden for
  More Sources, locked).
- `node tools/smoke/smoke.mjs --shots`: passed. home.png is the jailbreak app's Home with the fake bridge: the
  More Sources tile in the green row, no More Sources row under Find Extensions.

## Not verified

- Not checked on a phone: the change is web-only and the Chromium shot shows the result.
- I didn't see the row slide out on screen. With the fake bridge the tile is already More Sources when the list is
  drawn, so the row starts hidden. On a real device the slide depends on nav/slide.js's watcher.
- I didn't take an iOS 7 Style shot of the tile. The code uses the same `rowIcon` Style path as the list rows.
