# B32: alerts widened by long text (Search's "Add this source?")

Per the user's correction, the broken alert was Search's "Add this source?" (`web/app/screens/search.js` offer), not
Sources > Add. Before: main checkout's `ref/7/screens/roll-0009.png`. The box was pushed right and its message,
title and Add Source button ran off the screen.

## Cause
The message already wrapped (`overflow-wrap: anywhere`, and on the phone the URL did break inside the box). The
problem was the scrim. `.alert-scrim` is a grid with one implicit `auto` column, and `.alert`'s
`width: min(340px, 100%)` is a percentage of that column, which is indefinite while the column is being sized. So
iOS 15 WebKit sized the column to the message's max-content width (the whole URL on one line), roughly 490pt on a
375pt screen. The 340px box was then centred in that column, starting about 92pt in and ending past the right edge.

## Fix (`web/app/sources.css`)
- `.alert-scrim { grid-template-columns: minmax(0, 1fr) }`: the column is exactly the screen's width (minus the
  16px padding), whatever the content.
- `.alert { max-width: 100%; min-width: 0 }`: the box never gets wider than that column.
- `.alert-title` and `.alert-message`: `overflow-wrap: anywhere` plus `word-break: break-word`, a fallback for
  WebKit before Safari 15.4. The title can hold a long app name.

Test: `web/app/nav/alert-wrap.test.js` checks these rules in sources.css (gate: `node --test web/app`).

## Checked
- iPhone 7, .deb 0.9.4-1207 built from this branch: searched `youmod` and tapped the YouMod result under
  Recommended Sources. The alert is centred and the URL wraps over three lines inside it:
  `ref/7/screens/b32-after-search.png`. Sources > Add still looks the same (field and Paste lined up with the
  buttons, centred above the keyboard): `ref/7/screens/b32-after-addsource2.png`. `b32-after-addsource.png` was
  taken mid-glide and shows the caret below the box before the box settles. That's the existing keyboard
  animation, not a layout problem: the second shot has the caret back in the field.
- Browser (headless Chromium, 375x667 @2x, a scratch page that calls showAlert with the real CSS):
  `ref/7/screens/b32-browser-after-search.png` and `b32-browser-after-addsource.png`.

## What didn't work / dead ends
- Chromium does **not** reproduce the bug. With the old CSS it already draws the box centred. It resolves the
  percentage width differently from iOS 15 WebKit, so the browser check only shows that nothing regressed. The
  phone is the real before/after.
- My first headless shots came back identical before and after, either from caching or from the shot being
  taken mid pop-in animation. A cache-busting query and `--virtual-time-budget=5000` fixed that.

## Not verified
- Safari on the public website on a real iPhone: only the app's WKWebView (the same WebKit) was checked.
- Other alerts with long text (e.g. long package names in titles) weren't opened on the phone. They share these
  rules, and the CSS test covers title and message.
