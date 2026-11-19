# F231: theme preview grip as iOS 6's NC grabber (flipped); Light/Dark rows set Mode

F230 is on main (merge 4520c3d). Neither part of this task was in it, so I did both.

## What I did

1. **Grip** (`web/app/settings.css` `.theme-preview-grip::after`). I sampled `ref/4s/screens/nc-grabber.png` at 2x:
   - The tab runs from x 278 to 363 at 2x, so it's 43pt wide. On screen it's about 17pt tall: from y 926 to the bottom edge at 960.
   - Its sides are 2px of about #121212 and its inside is #010101 to #0a0a0a. The top corners have a radius of about 6px at 2x, so 3pt.
   - There are 3 bars, each 7px tall at 2x (3.5pt), with 3px of black between them (1.5pt). Each bar has a 1px #323334 edge on top, then a 6px fade from #666768 to #727375.
   - The bars' ends slope about 2px at 2x (1pt): each bar is widest at its bottom row, where it touches the sides (x 280 to 361).

   Flipped for the preview: the tab hangs at `top: 0` of the grip, with its flat side on the preview's edge and its bottom corners rounded 3pt. Each bar goes #727375 → #666768 with a 0.5pt #333435 edge at its bottom, and is widest at its top. It's all CSS backgrounds:
   - 3 bar gradients and 6 black corner triangles for the sloped ends, over #050505.
   - Inset box-shadows draw the #121212 sides.

   The grip's `::before` touch area and the strip's 25px height are unchanged.
2. **Mode** (`web/app/screens/settings.js` `render`). Opening a tone list (`lightTheme` or `darkTheme`) sets `appearance` to that tone, the same way `pick()` does. It does this before the page is added to `pages`, so the redraw only touches pages already open, and the new page draws once.
   New test: "F231: opening Theme > Light or Dark switches Mode to that tone, without picking a theme".
   - Opening Dark from Light gives dark, and opening Light from Auto gives light.
   - No theme setting changes.
   - Theme itself and General leave Mode alone.

## Check
- `node --test web/app/screens/settings.test.js`: 18/18 pass.
- 3x render: Chromium headless at `--force-device-scale-factor=3`, with the grip on a light (classic) and a dark (oled) preview. Renders are in `grip-light.png` and `grip-dark.png`.
- I put them, zoomed 4x, next to the 4S crop (flipped, scaled to 3x) and the zoom crop, using `cmp.py` (`python3 -I cmp.py <nc-grabber.png> <nc-grabber-zoom.png> grip-light.png grip-dark.png out.png`). They match in tab width, bar pitch, the sloped ends, the corners, and the bar shade and edge. That side-by-side image isn't committed because it includes the Apple screenshot.

## Tried and failed
- Nothing.

## Not verified
- Not checked on a phone (iPhone 7 or Safari) at its real size: the task didn't ask for it, and the iPhone 7 is only touched when a task says so. The check was the headless Chromium render.
- Not checked when a theme is changed live while the Theme page's Mode control is open in the stack. The redraw goes through the existing `settings.onChange` → `draw`, which the test covers only indirectly.
