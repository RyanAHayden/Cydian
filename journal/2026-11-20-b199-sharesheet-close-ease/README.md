# B199 Share sheet close() easing

- `web/app/nav/sharesheet.js` close() animated with `easing: ease`, a name left undefined
  when C26 moved the curve to `EASE` in nav/motion.js (already imported). The ReferenceError
  fired before the scrim was removed and before onSelect/resolve ran, so the sheet never closed.
  Changed it to `EASE`.
- Grepped web/app for the same pattern: screens/search.js defines a local `const ease = EASE`
  (fine); nav/actionsheet.js close() has the identical bug. That file is outside this task,
  so it is filed as B201 (critical).

## Not verified
- No device or browser run of opening and closing the share sheet: the fix is a one-identifier
  change to an imported constant; relied on tools/check.sh (its lint/smoke) for the rest.
