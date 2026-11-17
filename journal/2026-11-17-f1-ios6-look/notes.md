# F1: iOS 6 look, navigation stack, transitions and edge swipe

Screenshots (390x844 @3x, safe areas 47/34), the trace and the scripts that made them: `journal/F1/`.

## What I did

- **Navigation stack** (the T1 review's three points):
  - `nav/stack.js` keeps one stack per tab, with no DOM. `sync(route)` builds a whole stack from a deep link,
    reports what kind of change happened (`tab`, `push`, `pop`, `replace`, `none`) and lists the entries it took
    off. A push leaves the screen below in the DOM; a pop removes only the top (several at once when you tap the
    current tab). Router tests in `router.test.js` cover push, pop, multi-level pop, replace, deep links and tab
    switches that keep both stacks and their page objects.
  - Each page is a `.page` frame that transforms move, around its own `.page-body` scroller. Switching tabs or
    popping keeps every screen's scroll position (checked in Chromium, see below). Pages that aren't showing are
    `visibility: hidden`, so they keep their layout and scroll and paint nothing.
  - Nav bar height is `calc(44px + env(safe-area-inset-top))`, and the tab bar's is `49px + bottom inset`.
  - `router.replace()` (no history entry) and the pure helpers `prefixes()` and `parent()` were added. Back calls
    `history.back()` when we pushed here, so the parent is behind us in history. On a deep link there is nothing
    behind us, so it replaces the route with the parent instead.
- **Transitions** (`nav/transition.js`): one progress value p drives both screens and both nav-bar items. The top
  screen slides by `(1-p)·100%`, the screen below moves `-30%·p` and darkens to 10%, and the titles slide and fade.
  Duration is 350 ms with curve `cubic-bezier(.36,.66,.04,1)`. Everything runs on the Web Animations API with
  transform and opacity only. `finish()` jumps to the end at once, so a new route arriving mid-slide never leaves
  a half-finished state.
- **Edge swipe** (`nav/swipe.js`): starts on a 20px strip along the left edge that has `touch-action: none`.
  The screen follows the finger once per animation frame. When you let go it finishes or cancels: past half the
  width or a rightward flick (over 0.3 px/ms) finishes it, and a flick back cancels it (`swipeCommits`, tested).
  The finishing slide runs at about the finger's speed.
- **Look** (`ios6.css`): every value comes from `sheet.svg` and is named after its layer: "Menu Bar (Blue)",
  "Status Bar (Blue)" under the notch, the "blue button" and "back button" (the kit's arrow path drawn in an
  inline SVG and stretched with `border-image`), "Tab bar" with its grey/blue icon gradients and "selected
  highlight", the "# indicator" badge, "Grouped Table", dividers, "arrows copy" chevron, "Table Label" headers,
  plain "Scroll pane" keylines and the "category bar" sticky section headers. The pinstripes come from the
  "Stripe (light grey)" bitmap: a 16px period at 2x, so 2.5px dark plus 5.5px light, #c9ced8/#ccd1da. Tab glyphs
  (house, stacked sources, clock, tray, magnifier) are my own SVGs, used as masks. There are no Apple images.
- **HUD** (`nav/hud.js`): `showHUD(text)` returns `hide()`. It has a 12-spoke SVG spinner turned with
  `steps(12)` and fades by opacity.
- `html.native` hides the CSS nav and tab bars, and the screens then fill the web view (checked: 844 of 844px).
- Screens: the interface is now `title`, `render(body, route, ctx)` and optionally `nav(route, ctx)` (title,
  grouped or plain style, left/right buttons) and `init(ctx)`. The placeholder screens show each component with
  sample rows: grouped Home with a pushed About, plain Sources with the F4 default names, Refresh (HUD) and Edit,
  Changes with sample sections and a badge of 2, and Installed with alphabet headers. F4–F6 replace them. Table
  DOM comes from `nav/ui.js` (`grouped()` and `plain()`), and all text goes through textContent.
- **Mid-task change from the user** (relayed by another session; I checked it against commits 81ff767 and 189b112
  on main): nothing may be copied or adapted from sidedrop. I had used sidedrop's HUD numbers and its blue
  selection gradient. Both are now redone: the HUD is our own design in the kit's terms, and cell selection uses
  the kit's "Button (Matte Blue)" gradient. Nothing from sidedrop is left.

## Performance (journal/F1/trace-report.json, trace.json.gz)

Headless Chromium 155, touch emulation, driven over CDP by `journal/F1/tools/trace.mjs`. Each window runs from
the start mark to the point where `document.getAnimations()` is empty:

| | layouts during the slide | tasks > 8.3 ms | longest task |
|---|---|---|---|
| push | 0 (one layout before the first frame, building the new screen) | 0 | 3.1 ms |
| pop (back button) | 0 | 0 | 2.3 ms |
| swipe back (finger, then finish) | 0 | 0 | 2.7 ms |

- The only other layout in each window is taking the popped page out of the DOM, at the next idle moment after
  the slide.
- Two layouts had been landing on slide frames, and I removed both. (1) Toggling `will-change` at the start and
  end of a slide changes the containing block, which re-lays out the screens. Pages and nav items now always
  have their own layer. (2) Hiding the edge strip with `hidden`/display. It now uses `pointer-events`.
- During the swipe there is a style recalc each frame. This is expected: the finger sets inline transforms, and
  no layout follows. The trace also shows about one paint per frame of the root element with a zero-height clip.
  I didn't chase it.
- The functional checks in the same script all pass: scroll position kept across a tab switch and through
  push/pop, push gives 2 pages, back button gives 1, the page follows the finger mid-swipe
  (`translateX(102px)`), swipe back lands on `#/sources`, and a short slow swipe cancels.

## What failed on the way

- The first edge swipe was cancelled by the browser (`pointercancel` straight after `pointerdown`): with only
  `touch-action: pan-y` on the scroller, Chromium turned the edge drag into its own history-back gesture. That
  went back twice and left the app. The dedicated `touch-action: none` edge strip fixed it.
- My first scroll-position check used a list too short to scroll. The check now adds height first.

## Not verified

- **On a real iPhone / at 120 Hz**: everything was measured in headless Chromium on Linux, which has no ProMotion
  display and no real vsync. "Holds 120 Hz" rests on the trace (no layout and no task over 8.3 ms during slides)
  and on all movement being transform/opacity. It has not been measured on WebKit. R3 or N-tasks should measure
  it on a device.
- **Safari's own edge-swipe back** (Safari in a tab, not standalone or WKWebView) may still fight ours at the
  very edge. It couldn't be tested here. WKWebView has `allowsBackForwardNavigationGestures` off by default, and
  the home-screen app has no browser gesture.
- **WebKit rendering** of `mask` with a data-URI glyph (the `-webkit-mask` prefix is included), of `border-image`
  with an SVG that uses filters, and of 0.5px borders: only Chromium was checked.
- **The 4S comparison**: I didn't drive the 4S (the task didn't ask for it). I compared crops against the kit's
  `original-2x.png` instead: nav bar, buttons and tab bar match closely. The kit's active tab icon also has a
  light blue stroke that I didn't draw, because a CSS mask can't stroke.
- **Tab badge size**: the kit's badge is the 23px home-screen one. In the tab bar I scaled it to 20px with 13px
  text and kept the kit's gradient and 2px ring. That size is a judgement call, not a kit value.
- **Real content**: screens hold samples only. Virtualised long lists are F5's.
