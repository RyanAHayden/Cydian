# F149: certificate Password row reads as a text field

## What I did
- `web/app/screens/settings.js`: the Password input gets class `sign-field` and its placeholder from the new
  exported `passwordPlaceholder(kept, p12)`: "Required" (iOS 6 Mail account-field idiom) instead of "None";
  "Not Kept" stays for the sideload case where the Keychain holds the identity and no .p12 is picked.
  New exported `focusOnRowTap(li, input)`: a click anywhere on the row's `<li>` (padding, edges, label) focuses
  the input, except on the Browse button. The row was already a `<label>`, but the li's right padding/Browse area
  sat outside it.
- `web/app/ios6.css`: `--field-text` / `--field-hint` vars in light and dark; `input.sign-field` is left-aligned
  after the label (like iOS 6's grouped text fields), text `--field-text`, placeholder `--field-hint`, caret blue.
  No border/box.
- Colours from `ref/teehanlax/ios6/sheet.svg`: hint `#b3b3b3` (the "URL field"'s placeholder text "Google");
  typed text `#4c566c`, the kit's blue-grey (its "Table Label" text). The kit has no typed-text sample in a
  grouped-table field, so this is my pick: it differs from the value colour `#385487` as the task asked.
  Dark theme values (`#d6deeb`, `#868c96`) are ours.
- Test: `web/app/screens/settings.test.js` "F149: Password row placeholder and tap-to-focus".
- Render: a static mock of the rows with the real CSS in headless Chromium at 3x: hint grey, typed text blue-grey,
  no box, aligned after the label.

## Not verified
- Not seen on a phone (app or Safari): the task didn't call for the iPhone 7, and the 4S never runs Cydian.
- Caret colour `#426bf2` is an estimate of iOS 6's caret blue, not sampled from the 4S (screen lock not taken;
  task didn't say to touch it).
- The real Settings > Signing page wasn't rendered end to end, only a mock with the same classes and CSS.
