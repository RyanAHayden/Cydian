# B201 Action sheet close() easing

- `web/app/nav/actionsheet.js` close() animated the sheet with `easing: ease`, a name left
  undefined when C26 moved the curve to `EASE` in nav/motion.js (already imported there). The
  ReferenceError fired before the scrim was removed and before resolve ran, so no action sheet
  button, Cancel, dim tap or Escape closed it. Changed it to `EASE`, as B199 did in sharesheet.js.
- Checked by hand with a throwaway fake-DOM script (scratchpad, not committed): open a sheet,
  click its first button; it now resolves 0 and removes the scrim.
- Grepped web/app for `easing: ease`: only screens/search.js, which defines a local
  `const ease = EASE`, so no other instance.

## Not verified
- No device or real-browser run of an action sheet (Modify, Downgrade): the fix is a
  one-identifier change to an imported constant; the fake-DOM check and tools/check.sh cover the rest.
