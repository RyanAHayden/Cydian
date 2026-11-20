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
Recommended, Sources after tapping Edit, and Manage after Edit with a row's minus tapped (armed Delete). `diff.py` is
C44's, unchanged. Base: a scratch worktree at this branch's base commit (1da9495a), not today's main, so only this
branch's change shows. Six themes (Classic, Sepia, Solarized, OLED Black, Gunmetal, Midnight) × 16 app routes, plus
Home and Settings on the website: 98 shots.

RESULTS

## Not verified

NOTVERIFIED
