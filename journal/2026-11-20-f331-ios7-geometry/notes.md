# F331: iOS 7 era geometry

iOS 7's four pieces of geometry, set in `web/app/ios7.css` through hooks only:

- **Switch 51 x 31**: new hooks `--sw-w`, `--sw-h`, `--sw-knob-size` (style.css, Era hooks) and `--sw-travel` (a second
  `:root` in style.css for hooks read outside it). `ios6.css`'s on state is `--x: var(--sw-travel)`, the fill's offset
  is `--x + knob/2 - width` (iOS 6: the old −63.5px), and `nav/switch.js` reads `--sw-travel` at each pointerdown
  instead of a fixed 50. iOS 7: 51 x 31, knob 31, travel 20, track corners 15.5px (look).
- **Theme's Mode inset 15pt**: `--settings-seg-margin` / `--settings-seg-h` (settings.css). iOS 7: `0 15px`, 29px
  (the control's own height), its type and corners in look rules.
- **Separators to the label on icon rows**: look only (background position/size) in ios7.css, `:has(> .cell-inner >
  .cell-icon)`: 15 + 29 + cell gap = 52pt, 47pt for Theme's 24pt swatches. No hook needed: `background*` is look.
- **Home's tiles edge to edge**: `--home-inset` (head and tile rows) and `--home-tile-pad` (home.css). iOS 7: 0 and
  `0 15px`; tiles square with hairline edges (`--tile-radius: 0`, `--tile-edge: var(--table-edge)`, .5px borders).

Docs: docs/eras.md's hooks table and its "no hook yet" list. Test: ios6-css.test.js "F331".

## What went wrong on the way

- The knob's size hook was first `--sw-knob`, which is ios6.css's knob gradient token: iOS 6's knob drew 2px wide and
  its fill lost its transform (seen in the first run's `shots/ios6-general.png`, since re-shot; computed style read with
  `steps-ios6-switch.json`). Renamed `--sw-knob-size`; the F331 test now fails if a switch/Mode/Home hook shares a name
  with a token another stylesheet defines.
- Home's GitHub | Discord pair drew a row separator along the second half's top (already there in F201's shot, from
  15pt; the label inset moved it). The first `background: none` lost on order to the grouped separator rule of the
  same weight further down; it now carries `.home-row` / `.home-links`.

## Checks

- `node --test web/app/ios6-css.test.js` (and the theme, palettes, settings and rowicons tests): pass.
- 3x screenshots, headless Chromium against `worker/node.mjs` (capture.mjs from the T12 journal): `shots/` White and
  OLED Black Home, Settings, Theme, General; iOS 6 Home, Settings, Theme, General. iOS 6's switch computed: knob
  27x27, fill at −63.5px, as before.

## Not verified

- No computed-style diff of every iOS 6 page against main (C44's `shots.mjs`/`diff.py` are not in that journal folder
  any more; only the spike PNGs are). iOS 6 checked by eye on Home, Settings, Theme and General, and by computed
  style on the switch.
- Dragging the switch: not driven in the browser (no drag step in capture.mjs); the travel is read with
  getComputedStyle at pointerdown, the same value the CSS uses.
- On a phone: not tried (no iOS 7 build on a device in this run); `:has()` needs iOS 15.4+, so on 15.0–15.3 the
  icon-row separators stay at 15pt, as before this task.
