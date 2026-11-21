# D22 docs/eras.md: the small stylesheets and palettes are clean

## What I did

- `docs/eras.md`, "What is clean today": sources/home/settings were already listed by C47 itself, and ios6.css and
  packages.css by D21, so this adds what was left:
  - a table of C48's 14 small stylesheets, each with its look-only stretches (read off each file's
    `/* ==== look-only { ==== … */` comments) and its `:root` tokens (read off the files with grep/awk, not copied
    from C48's journal). account.css has a stretch but no tokens. tweaks.css repeats nine of myipas.css's
    `--price-btn*` tokens (not `-go-pressed` / `-fill`), same values. Literal leftovers named: plain colours, SVG
    data-URI glyphs, freeid.css's `--dm-*` pictures.
  - the lazily-loaded-sheets note: signing, signsheet, myipas, freeid, tweaks (from the brief, checked against the
    `loadStyle(` calls), and also settings.css, which loads the same way and has `:root` preview tokens (C47).
    appicon.css also loads lazily but has no `:root`, so it is not named.
  - the light palettes paint the chrome through tokens (C49).
  - "Not yet clean": "the small ones" is gone; the palettes line now names only the App Store segmented control
    rules and Brushed Metal's etched text (a rule on purpose, from C49's journal).
- The list says each not-yet-clean item is queued; the segmented-control rules were not, so I filed **C56** (low).
  The floating tab bar is C52.

## Tried and failed

none

## Not verified

- Rendered markdown (the new table, the `#writing-an-era` anchor): not opened in a renderer.
- Whether every stretch description is complete: they are the files' own stretch comments, condensed.
