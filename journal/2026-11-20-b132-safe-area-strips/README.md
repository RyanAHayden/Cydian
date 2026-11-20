# B132: the safe-area strips above the nav bar and below the tab bar

## What changed

- **Tab bar, web and app** (`web/app/ios6.css` `.tabbar` and Gunmetal's `--dk-tabbar`, `web/app/palettes.css`
  Linen/Nord/Dracula `--dk-tabbar`): the gloss layer was `0 1px / 100% 48px`, so it ended at 49 pt and the strip over
  the home indicator (`--safe-bottom`) was a band of plain black (or the theme's flat colour) about as tall as the
  gloss. It is now `100% calc(100% - 1px)`: the background spans the whole bar, strip included, and keeps its
  half-and-half split. OLED Black and Midnight tab bars have no gloss (a top line over a flat colour), so they were
  already continuous and are unchanged. palettes.css was not on the task's file list, but its three tab bars had
  the same 48 px gloss; leaving them would have left the bug in those themes.
- **Status-bar strip, app** (both builds): `native/Sources/App.swift` `Web.make` adds a document-start user script
  that sets `data-shell="app"` on `<html>`. Under it, `.navbar::before` covers the strip plus the bar's top 22 pt,
  takes the bar's own background (`background: inherit`) and re-sizes the layers: the gloss at `100% 200%` from the
  top (so its top half stretches over the layer), the highlight at the very top, base line and status fill hidden.
  The bar's bottom half is untouched, and the colours meet at the half, so there's no line or colour step where the
  strip ends. It works for every theme because every nav bar (the themes' and the console's) has the same four
  layers: base line, highlight, gloss, status fill.
- **Status-bar strip, web**: `html:not([data-shell="app"]) .navbar::before` paints the strip plain `#000`
  (index.html's opaque black status bar, see the iOS 26 top-blur memory). The bar's 1 px top highlight sits right
  under it, as iOS 6 draws a bar under a black status bar.

## Tried and dropped

- Stretching the nav bar's whole art over the strip plus 44 pt (`background-size: … 100% 100%` on the bar).
  Fine for Classic's smooth gradient, but the dark themes' hard gloss split landed at 50% of 91 pt = 45.5 pt, right
  on the strip's 47 pt edge. That reads as a separate status band, which is a seam. Replaced by the top-half
  stretch above.
- The first Chromium run of the app variant showed no change: CDP's `addScriptToEvaluateOnNewDocument` can run
  before `<html>` exists, so `documentElement.setAttribute` threw. The test hook now waits for it with a
  MutationObserver. WKWebView's `.atDocumentStart` runs after the document element is created (Apple's docs), so
  the Swift script sets it directly.

- The first `run done` failed in `native/helper/test_helper.py`. `cc` failed with "error writing to /tmp/cc*.s: Disk
  quota exceeded": /tmp, a tmpfs shared with the other slots, was nearly full at the time. That's the machine, not
  this change. A retry hit the same error. Running the gate with TMPDIR on disk fixed that, but
  turned up `native/daemon/test_auto.py` `test_rollback_keeps_previous_versions` failing every time on ext4/btrfs
  (rollback prune breaks mtime ties by readdir order). That's a latent daemon bug, filed as B142. The gate that passed
  ran with `TMPDIR=/dev/shm/ifizbox-b132` (tmpfs, not over quota).

## Checked

`shots.mjs` (here): headless Chromium at 390x844 CSS px, DPR 3, safe areas emulated at 47 top / 34 bottom
(`Emulation.setSafeAreaInsetsOverride`). It renders site and app (`data-shell="app"`) in Light (Classic), OLED Black
and Gunmetal: full shots plus 3x crops of the top and bottom 100 pt. Pixel columns through the old strip edge
(y = 141 px) and through the join at the bar's half (y = 207 px) step by at most one 8-bit level in every app
theme. `tools/check.sh` passes; it builds both the .deb and the sideload .ipa, so the Swift change compiles. The app's dark split sits on the same row as the website's. The tab bar's gloss now ends at half its
83 pt (124 px), with black below.

## Not verified

- On a phone (iPhone 7 .deb, sideload IPA on a notched iPhone): no device step in this task, and other slots
  overwrite the 7's .deb. Two things only a phone shows: (1) that WKWebView's document-start script sets
  `data-shell` before first paint (otherwise the first frame would show a black strip in the app), and (2) how
  legible the white status-bar text is on Classic's pale gloss top (#adbdd1 at the clock's height, 22 pt down). The status
  bar stays `.lightContent`.
- Themes other than Classic, OLED Black and Gunmetal (Sepia, Solarized, Midnight, Linen, Nord, Dracula) were not
  rendered. They share the four-layer nav bar shape the CSS relies on, which I checked by reading palettes.css.
- Sheets' nav bars (`.navbar.sheet-bar`, the console) get the same rules but weren't opened in the renders.
- The web Home Screen app on iOS: with the opaque black status bar its top inset is 0, so the strip isn't drawn
  there at all.
