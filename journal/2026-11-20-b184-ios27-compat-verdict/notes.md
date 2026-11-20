# B184: package page verdict on an iOS 27 sideload iPhone

## Why it said "Not your iPhone"
The cut-off line was the package page's Works On tile (storepage.js worksOnTile): value "iOS 14+" with
"Not Your iPhone ✗" under it. iOS 27 was never the problem: `iosOk` compares versions, so 27.0 >= 14 holds
(a test now says so). The cause was the jailbreak: in the sideload build the device is jailbreak `none`, and
compat.js gave every non-app stanza reason `jailbreak`. The catalog (catalog.js `judge`) already skips compat for
injectable Tweak Source stanzas, but the package page calls `compat()` directly and didn't.

## What changed
- `core/compat.js`: a stanza marked `injectable` (only Tweak Sources in the sideload build get that mark) is no
  longer refused for want of a jailbreak; only its iOS range is judged. iOS 27 added to the picker list
  (`27: 1`, i.e. 27.0 and 27.1; 27.1 assumed out by late November 2026 — the bridge's own version is judged even if
  it is newer than the list).
- `screens/storepage.js`: a `jailbreak` verdict's tile says "Needs Jailbreak ✗", not "Not Your iPhone ✗" beside
  the iOS range (the Information footer already says "Needs a jailbroken iPhone.").
- `packages.css`: the verdict line (`.store-tile-sub[data-ok]`) wraps instead of ellipsis.
- Tests: compat.test.js (27.0 rootless works, 27.0 none -> jailbreak, injectable on none by iOS only),
  storepage.test.js (the jailbreak tile text).

## Render
Chromium headless at 3x, 320 and 430 pt wide, the real CSS on a static copy of the tile markup:
`tiles-320-3x.png` — the verdict wraps to two lines at 320, one line at 430. The tile *value* ("iOS 14–16.2")
can still ellipsise at 320; that is the range, not the verdict, and was left alone.

## Not verified
- Not checked on the iOS 27 iPhone itself (no device access in this run); the render is of the tile markup with the
  page's CSS, not the full package page in the app.
- Whether iOS 27.1 is really out: assumed from the date.
