# C47 Era readiness for sources.css, home.css and settings.css

Follow-up of C44 (`docs/eras.md`): the three stylesheets now keep their layout in plain rules and their paint in
look-only stretches, and the decorations the brief named (the Done button, Home's tiles, Theme's preview) come from
tokens.

## What changed

- **Splitting without moving the cascade.** Each section of a sheet is now its layout rules, then a
  `/* ==== look-only { ==== … */` stretch with the look half of the same rules. A mixed rule became two rules with the
  same selector. Look and layout properties never overlap (no shorthand crosses the two: `font` covers only font and
  line-height, `background`/`border` only paint). So moving every look declaration after the section's layout keeps
  each property's order among the rules that set it, and the cascade is unchanged. Both kinds keep their order across
  the whole file. `@media` blocks (only animation/transition here) stay with the layout, in order.
- **Tokens.**
  - Done (`sources.css`, `:root`): `--done-btn`, `--done-btn-edge`, `--done-btn-edge-top`, `--done-btn-pressed`.
  - Home (`home.css`, on `.home` beside the existing `--tile*` / `--by`): `--tile-radius` (8px; the tiles and the help
    links), `--tile-glyph-green` (the green tile's glyph), `--home-icon-shadow`. The help links' table and dividers
    painted `#fff` / `#999` literally. They sit inside `.home` (screens/home.js appends them to it), so they now use
    `var(--tile)` / `var(--tile-edge)`, which are the same values in every light palette (no palette sets `--tile`).
    The dark rules over them stay. `.app-offer` (Settings > Signing, not under `.home`) keeps its literals.
  - Theme preview (`settings.css`, `:root`): `--preview-ground` (the pinstripes), `--preview-shadow`, `--preview-grip`
    (the grabber's layers, built from `--preview-grip-l`, `-r` and `-bar`, which were the rule's local `--nc-*`),
    `--preview-grip-edge` and `--preview-grip-radius`. They live on `:root` and not on `.theme-preview`, so an era's
    `html[data-style=…]` block can set them. `--pin-dark` / `--pin-light` are only ever set on the root element, so
    resolving the pinstripe there gives the same value.
- `web/app/nav/spinner.test.js` (not on the brief's file list, but it broke): its "every spinner uses one of the
  images" check wanted `animation: hud-spin` and `background: var(--spinner-…)` in one rule body. Home's Reload
  spinner (`.bar-button.is-reloading::after`) is now split. The check now reads every rule of that selector in the
  same sheet and `@media` context. It is still as strict.
- `docs/eras.md`: "What is clean today" lists the three sheets and their tokens. They are off the "not yet clean"
  list.

## No visible change: how it was checked

`shots.mjs` here is C44's harness with more routes for these pages: Credits (thanks rows), Help, Theme, Theme > Light
or Dark (whichever matches the run's tone, so the pinned preview and its grip show), Signing, Sources > Manage,
Recommended, Find More, and Manage > Sources in edit mode, plain and armed (the second pass, below). `diff.py` is
C44's, unchanged. Base: a scratch worktree at this branch's base commit (1da9495a), not today's main, so only this
branch's change shows. Six themes (Classic, Sepia, Solarized, OLED Black, Gunmetal, Midnight) × 16 app routes, plus
Home and Settings on the website: 98 shots.

First pass (the 16 app routes plus the website's Home and Settings): base vs branch **same**, 98 shots, 0 px and 0
computed-style differences. But the new routes didn't all show what they were for. Sources has no Edit (Manage >
Sources does). The only source is the built-in one, which has no minus to arm. Signing is empty in the jailbreak
shell. So the harness changed:

- the edit routes are `sources/manage/sources+edit` and `+edit+arm`. `+arm` sets `.armed` on the built-in row when
  it has no minus, the way `--pressed` forces a held state;
- the website adds Signing (`.signing-page`) and Theme > Light;
- a `lite` shell (`ifizboxNative.mode = "sideload"`) for Classic and OLED Black adds Home and Installation & Signing
  (the status tile, `.value-slot`s);
- `ONLY=<regex>` shoots only the matching names.

Second pass: 110 shots. Each new route's dump holds the elements it is there for (`.theme-preview-grip`,
`.thanks-row`, `.editing` / `.armed` source rows, `.rec-get`, `.signing-page`, `.install-status`, `.value-slot`).
Result: 109 the same. `lite-classic-home` showed 1290 px in the reload bar's spinner (the reload bar is outside the
dump's scope) and 0 style differences. Shot alone (`ONLY='^lite-classic-home$'`), twice from base and twice from
the branch, all four are pixel-identical. The full runs' frame depends on state and timing left by the routes before
it (the app's modules run before DOMContentLoaded, where the harness adds its freeze style), not on this CSS. The
branch's two full runs matched each other.

After the spec review moved `content: ""` (below), the branch was shot again: the same result (109 the same, the
same spinner frame in `lite-classic-home`).

`node --test web/app`: 2575 pass, 0 fail. `tools/check.sh` is run by `run done`, which refuses to tick unless it
passes.

## Spec review (fresh subagent, diff + brief only)

- Fixed: `content: ""` that creates a pseudo-element's box now sits with that box's layout, as C44 did in
  `style.css`. This covers `.alert::before`, `.del-toggle::before` / `::after`, `.bar-button.is-reloading::after`
  and `.theme-preview-grip::before` / `::after`. Before, it was in the look stretch, where an era clearing the look
  would also have removed the grip's 12px touch area. Moving it changes no cascade: no other rule in these sheets
  sets `content` on those pseudo-elements.
- Answered, no change: the help links use Home's tile tokens. They are inside `.home` (screens/home.js
  `home.append(list)`), so the tokens are always defined. `--pin-dark` / `--pin-light` are set only on `html`
  (ios6.css, palettes.css), so `--preview-ground` resolving on `:root` is exact. The `opacity: 0` on the edit-mode
  chevron moved only past layout rules. The diff's base is the branch's base commit (stated above).
- Outside the brief's file list, both needed: `nav/spinner.test.js` (the split broke its same-rule check) and
  `docs/eras.md` (the "clean today" list).

## Not verified

- Edit mode with a real deletable source and a real armed Delete button (`.del-confirm` open): the fake bridge has
  only the built-in source, which never shows Delete. The armed rules were checked by forcing `.armed` on that row,
  but `.del-confirm` itself is never drawn in a shot. Its rules are split like the rest; only the test and the code
  read vouch for them.
- The Wish List's edit mode (`.wish-row`) and Find More's rows with results: Find More's index fetch gets a 404 in
  the harness (no `/api`), so only its empty or error state is shot, and the Wish List needs seeded data.
- Alerts (`.alert*`, Paste, coloured buttons), trust pills on other pages, the failed-source page, the
  certificate-expiry tile, locked Home rows and Check Connection's answer: none is on screen in any harness route.
  They were split with the same mechanical rule (layout half, then look half, each in order). The stretch test
  proves they hold no layout. That the cascade is unchanged is by construction, not by screenshot.
- Real devices: not tried. This is a CSS refactor with no visible change, and Chromium was the check.
