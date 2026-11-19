# B99: app page header text stops short of Share

## What I did
- Found the header already had a 12px flex `gap` between `.store-head-text` and the Share button (packages.css
  `.store-head`), so nothing was overlapping. The ellipsis still ended only about 12pt from the button's border,
  which looked cramped next to iOS 6's App Store price button.
- Added `margin-left: 8px` to `.store-head .store-head-share` (web/app/altstore.css). That makes 20pt between the
  text box and the button. I put it on the button, not as a margin-right on `.store-head-text`, so a header without
  an action (a package page with no Share) keeps the full text width. packages.css is unchanged.
- Check: `fixture.html` builds storeHeader's markup with the app's real stylesheets (three rows: plain Unbound, a
  long Unbound name and author, and W/M worst case). Rendered at 390pt wide and 3x in headless Chromium, light and
  dark (`?dark`):
  - `before-light.png`: before the change.
  - `after-light.png`, `after-dark.png`: after. The name and author ellipses end clearly before the button.

## Tried and failed
- nothing

## Not verified
- I did not render the live app page for unbound (the real source data in the running app). I used the fixture with
  the same markup and CSS instead, because the bug is pure layout and the app page needs a loaded source.
- I did not check it on a phone (iPhone 7 / WKWebView), because the task doesn't ask for the phone. Flex `gap` and
  margins render the same in WebKit.
