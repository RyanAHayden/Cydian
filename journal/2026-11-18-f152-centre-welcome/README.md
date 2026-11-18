# F152 Centre Home's welcome text in its space

User 2026-11-18: "center the welcome text and others between the empty space it looks off".

## What I did
- **Home** (`web/app/home.css`): the words block ("Welcome to Cydian", by-line, nod) was 22px from the icon with
  the whole rest of the row empty on its right. Cydia's Home on the 4S (`ref/4s/screens/cydia-home.png`) centres the
  block between the icon and the tiles' right edge (32pt left, 36pt right), with the lines flush left inside the block.
  Now `.home-head { gap: 0 }` and `.home-head > .home-words { margin: 0 auto; padding: 0 10px }`: auto margins share the
  free space and the 10px each side is the closest the text gets, equal so the centre stays true. Down it was already
  centred (`align-items: center`). I added new rules after the old ones and left the existing lines as they were,
  so merges stay clean.
- **Empty states** (`web/app/style.css`): a `.empty` note that is a page's only content (Wish List, No sources,
  Nothing here, error messages…) sat 40px under the nav bar, with the page empty below it. Now
  `.page-body > .empty:only-child` is a flex box centred across and down, 72% tall like the loading page's spinner
  (`packages.css .page-body > .loading`, "in the middle", user 2026-11-17). Both land at the same spot. Notes that sit
  under other content (e.g. Manage's head + error) aren't only-children, so they keep their 40px margin.
- Left alone on purpose: the package page head, the signing sheet's head and the walkthrough heads. Cydia draws
  those flush left beside their icon, so they don't have this problem. Home's hint and version lines were already centred.
- Test: `web/app/centre-text.test.js` (node --test, part of the gate) checks the centring rules.

## Renders (3x, headless Chromium, website build)
`shots.mjs` renders Home and the empty Wish List at 375/390/430 and measures them. `before/` is HEAD and `after/` is this change.

| width | Home text gap left/right, before | after | icon vs text middle | Wish List note top/bottom space, before | after |
|---|---|---|---|---|---|
| 375 | 22 / 57.8 | 39.9 / 39.9 | 93 / 93 | 40 / 474 | 179 / 335 |
| 390 | 22 / 72.8 | 47.4 / 47.4 | 93 / 93 | 40 / 474 | 179 / 335 |
| 430 | 22 / 112.8 | 67.4 / 67.4 | 93 / 93 | 40 / 474 | 179 / 335 |

The empty note sits a little above the exact middle, where the loading spinner sits. I kept that height so a page doesn't
jump between loading and empty. If the exact middle is wanted, change both 72% rules together.

## Tried and dropped
- `.home-words { flex: 1; text-align: center }`: this centres each line on its own, so the by-line no longer lines up
  under "Welcome". Cydia keeps them flush left.
- Keeping the 22px gap together with auto margins: the gap only sits on the icon's side, so the block ended 11px right of centre.

## Not verified
- The jailbreak and sideload apps (WKWebView on the iPhone 7): not rendered. The task didn't ask me to drive the
  phone, and it's the same `web/app/` CSS. In the app the nav bar is native (`html.native`), which only changes the
  page-body's top padding, and the empty-state centring follows that.
- Real Safari/WebKit on an iPhone: only Chromium renders here. These are plain flexbox auto margins, nothing engine-specific.
- Dark theme: no colours changed, so I didn't render it.
- Empty states other than the Wish List: they all use the same `.empty` rule and I rendered only one.
