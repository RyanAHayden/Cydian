# C1: makeSwitch as a thin wrapper over createSwitch

## What I did
- `web/app/screens/settings.js`: `makeSwitch(d)` (settings rows) now only calls
  `createSwitch({ label, checked: settings.get(key) === true, onToggle })`, where `onToggle` writes the setting
  if the store differs. The hold/drag/tap code lives once, in `createSwitch`; I moved makeSwitch's comments
  (knob travel, hold/drag/tap, the handled click) onto it. 50 lines removed, nothing else touched.

## Behaviour change (small, deliberate)
The old makeSwitch wrote to the store whenever the store differed from the switch's target state, even when
the switch itself didn't change (e.g. a cancelled drag on a switch showing a stale value would write that stale
value back). Now a write happens only when the switch actually flips (createSwitch's rule) *and* the store
differs. In normal use the switch and store always agree (only the switch changes a toggle setting), so
nothing visible changes.

## Checks
- Drove `createSwitch` in node with a fake DOM (scratch script, not committed): click on, tap off, a drag that
  ends on the same side and a pointercancel give `onToggle` calls `[true, false]` and end `aria-checked=false`,
  as expected.
- `tools/check.sh` through `agent-runner done`.

## Not verified
- In a real browser or on the 4S: no browser test drives the switch, and the task doesn't allow using the
  device. The code that runs is the same `createSwitch` that F24's Section Visibility already uses, which lowers
  the risk.
