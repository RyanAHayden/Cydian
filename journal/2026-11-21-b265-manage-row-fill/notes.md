# B265 Installed > Manage rows: one fill, red check, Remove from List without a sheet

## What was wrong
- A Manage row's content (`.cell-inner`) slides 37pt right for the circle. The pressed look (`.cell-inner.is-pressed`,
  the blue `--select`) painted only that content, so the circle's strip stayed the old colour.
- The picked fill went on both the row and its content. In light that was the same opaque `#e1e8f5`, but in the dark
  theme it was `rgba(255,255,255,.15)` on both: the content stacked two layers (a lighter grey) while the strip had one.
  That's the "left strip another shade, grey not tint" in the user's 15 screenshots (dark theme).
- The iOS 7 and iOS 13 looks' pressed rule (`.cell-inner.is-pressed * { color: inherit }`) also turned a held row's
  icon letter black.

## What changed
- `ios6.css`: new token `--multi-select` (light `#e1e8f5`, dark `rgba(95,162,255,.2)`, a blue tint over any dark
  ground, palettes included). The base pressed rules skip Manage rows:
  `.cell-inner.is-pressed:not(:where(.managing .manage-row > *))`. `:where` keeps the rule's weight unchanged, so
  every other override (held rows, package rows) wins as before.
- `packages.css`: the fill goes on the row only, `.managing .manage-row:is(.picked, :has(> .cell-inner.is-pressed))`,
  so pressed and picked look the same and cover the whole row. The old light/dark double rules are gone.
- `ios7.css`, `ios13.css`: the same `:not(:where(...))` on their `* { color: inherit }` line (one line each), so a held
  Manage row keeps its colours in those looks too.
- The red check against `UIRemoveControlMultiCheckedImage@2x` (4S UIKit art), rendered side by side at 2x and zoomed:
  size (23pt disc with a 2pt white rim) and the reds/gloss already matched. The tick was ~0.5pt too far right/low and
  bolder: path now `M10.5 17.5 17.5 26.5 28.5 10`, stroke 5.5 (was 6), from the art's pixel rows. Shadow
  `0 1px 3px rgba(0,0,0,.85)` (was `0 1px 2.5px .7`): the art's halo is darker. The unpicked ring matched.
- `installed.js` `confirmDelete`: "forget" (Remove from List) runs at once, no sheet. Used by the swipe's red button,
  the hold sheet's button and the app page's row. "uninstall" keeps its sheet, "installed" its alert. Manage's bulk
  Delete (`runManage`) has its own confirm and is untouched (the correction in the brief).

## Checks
- Static Chromium harness (scratchpad): plain list with normal / picked / pressed / picked+pressed rows in light iOS 6,
  dark iOS 6, light iOS 7 and dark iOS 13. All show one fill edge to edge, pressed the same as picked, white icon
  letters (computed style checked in iOS 7 and 13).
- `node --test web/app/screens/installed.test.js`: 39 pass (B46's test now expects no sheet for Remove from List).

## Tried
- Mail's Edit mode on the 4S for the selected-row tint: Mail has no account there (it opens iCloud's sign-in), so
  there's no message list to put in Edit mode. Compared the circle with the UIKit art instead.

## Not verified
- The tint `#e1e8f5` itself against iOS 6 Mail: no Mail account on the 4S (above), so it stays the value F222 sampled.
- The disc's vertical place: in the 29pt UIKit image the disc sits 1pt above centre. How UIKit places that image in
  the row isn't known, so the circle stays centred.
- On the iPhone 15 in the app itself: checked in desktop Chromium with the real CSS only, not on the phone
  (`:has` needs iOS 15.4+, fine for the 7 on 15.8 and the 15 on 27).
