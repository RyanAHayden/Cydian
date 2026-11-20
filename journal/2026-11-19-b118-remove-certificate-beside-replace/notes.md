# B118: Remove Certificate beside Replace Certificate, red

## Done

- (2) Settings > Signing (sideload app and website): Remove Certificate is no longer a group of its own at the bottom.
  Once there is something to remove (a certificate in use, or files picked; on the website also a stored identity
  whose profile can't be read), the Certificate group's Import/Replace row becomes a row of two buttons under its
  table: Import or Replace Certificate (a one-row grouped table look, the cell selection when pressed) and Remove
  Certificate in red. With nothing to remove, the Import Certificate row stays in the table as before.
  - `screens/settings.js`: `certificateActions({ has, staged, removable })` (pure, tested) picks the labels;
    `certificateGroup` takes `remove` and `removable`; both pages pass their remove function
    (`removeDeviceCertificate`, `removeSiteCertificate`); the `remove` parts and `signingLayout`'s `remove` key are
    gone. The hidden file input goes in the button row, not inside the button (a click on it would bubble back into
    the button's handler).
  - `core/settings.js`: `"remove"` left `SIGNING_GROUPS`.
  - `ios6.css`: `.button-pair`, `.cell-inner.pair-button`, `.pair-button.delete-button`. The buttons are
    `button.cell-inner`, so app.js's PRESSABLE gives them the pressed look without touching app.js. The red one is
    sampled from the 4S's `UIPreferencesDeleteButtonNormal` / `...Pressed` / `...Dark` / `...DarkPressed` (88px@2x:
    1pt translucent black edge over the page, gloss split at row 43, 1pt white emboss under it). Its border is drawn
    over the page in the art, so `background-clip: padding-box` with `background-origin: border-box` keeps the
    gradient's stops at the art's rows.
  - Chose UIPreferencesDeleteButton (iOS 6 Settings' own red Delete button) over packages.css's action-sheet
    destroy button: this is a settings page, and it is the art meant for one.
- Tests: settings.test.js F134 layouts without `remove`, new B118 test (no `remove` group in any build,
  certificateActions for each state); installsigning.test.js's layout too (it listed `remove`; not on the task's file
  list but it would fail otherwise).
- 3x render (headless Chromium, a static page with ios6.css + settings.css): light normal and pressed, zoomed on the
  red button's bottom edge: its last rows read #b72022, then the edge, then the emboss, as the art's rows 84-87; no
  light line. Dark theme checked at 2x.

## Split off

- (1) "Apple Developer Account shows whether or not a certificate is in": the `account` group and its
  `account: certificate && …` line exist only on wip/F273 (F278 brings them to main), so there is nothing to change
  on main yet. Filed as **B118a**, `--after F278`, critical.

## Tried and failed

- First render: the plain button had no background or border: `.cell-inner` (later in ios6.css, same specificity)
  reset them. Fixed with `.cell-inner.pair-button`.
- First gate: theme-palette.test.js refuses fixed colours in dark rules. The Dark art's gradients moved into OLED
  Black's block as `--dk-delete` / `--dk-delete-pressed` (Gunmetal inherits them); the dark render is unchanged.
- Edited the two test files' layout lists once with a Python heredoc before remembering the rule against it; the
  result was checked by grep and the tests. Everything after went through the edit tool.

## Not verified

- On a phone (iPhone 7 / sideload build): not in this task's scope (no phone step asked for); the renders were
  desktop Chromium, not WebKit on iOS.
- The real Signing page drawn end to end in a browser with a stored identity: checked with a static page using the
  same markup and stylesheets instead, and the DOM building only by reading (settings.js's draw functions need the
  browser's IndexedDB / the native bridge).
- Part (1): waits for F278 (B118a).
