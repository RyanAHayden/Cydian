# F193: swipe a package row left to queue it

Built to the user's last design (concept v3 + v5): one action per swipe, not a strip of buttons. Share and Source
stay in F192's hold menu.

## What I did

- `web/app/nav/rowswipe.js` (new): the gesture. A touch on a `.pkg-row` asks right away what a swipe would do
  (`prepare`), then follows the finger once a move is clearly leftward (`swipeDecide`: > 10px and 1.5x more sideways
  than down). Vertical moves go to the list (`.pkg-row { touch-action: pan-y }`), rightward moves are never ours (the
  back-swipe side), and touches starting within 30px of the left edge are left to the edge swipe. The row's
  `.cell-inner` moves with `translate3d` (vlist.js already uses the row's own transform for its y); up to 30% of the
  width it tracks the finger, after that a UIScrollView-style rubber band (`swipeOffset`, capped at 30% + 50%).
  Past 30% the control scales up (armed, one haptic tick). Letting go armed runs the action, letting go before does
  nothing, and either way the row springs back (.32s). The lift's click is swallowed so the row doesn't open; the
  pressed blue comes off as the drag starts (UIKit drops the highlight when a swipe begins). `reset(row)` drops a drag
  when vlist rebinds a row; `packageList`'s bindRow calls it.
- `playHint(row)`: the first-run hint, WAAPI on `.cell-inner` only: 0 -> -44px -> 0 over 1.1 s, each half
  ease-in-out (the whole effect eased once with linear keyframes would turn at full speed and look like a bounce).
- `web/app/nav/undobar.js` (new): the kit's semi-transparent black bar (keyboard toolbar), 44pt, docked at
  `bottom: var(--tab-h)` (as `.filter-drop`), sliding up from behind the tab bar (z-index 2, under the tab bar's 3,
  over #screens), the message on the left and Undo as `.bar-button.done` (sources.css: the PSD's gloss blue
  #79a1f3 -> #3b71e1 49% / #215fdd 51% -> #2361dd, exactly the brief's colours). Hides after 4 s; a new one replaces it.
- `web/app/screens/browse.js`:
  - `rowSwipeAction(item, opts)` is a filter over F192's `rowMenuItems` (same states): the queue item as
    `{ kind: "add" | "remove" | "cancel" }`, or null (no queue, AltStore app, unbought paid package, nothing
    downloadable): then the row doesn't move at all.
  - `attachQueueSwipe` (only when the backend has a queue, i.e. the jailbreak app): installed/newest come from
    `catalog.history`, asked at the touch with a 20 s per-id cache (a scroll's touches don't each ask). Not on Wish
    List rows (their own left swipe shows Delete), held rows, editing lists or rows with no page.
  - Commit: `installQueue.add(job, { quiet: true })` or `installQueue.clear(id)` for Cancel, then the undo bar.
    Undo is `installQueue.restore(id, prev)`: the job that was there before (or none).
  - Messages: "Install X queued", "Upgrade X queued", "Remove X queued"; for Cancel (not specified in the brief),
    "<mode it had> X cancelled", e.g. "Remove curl cancelled".
  - Hint: `swipeHintDue({ seen, queued, logs, queue, reduce })`. "Never queued anything" = no `cydian.swipeHint`
    flag, nothing in the queue and no kept console log (`runLogs`: someone who ran a queue before this shipped has
    queued). The flag is set when the hint plays, on the first swipe, and on any queue add. Skipped with reduced
    motion. It plays on the top row on screen 0.7 s after a list is created; a list that's still empty then (Search
    before typing) leaves it to the next list.
- `web/app/core/queue.js`: `add(job, { quiet })` marks the event `quiet`; `restore(id, job | null)`.
  `web/app/screens/queue.js`: a quiet add doesn't open the Confirm sheet (every other add still does). These two files
  weren't on the task's file list, but a swipe that opened Confirm every time would defeat the design, and these were
  the smallest changes that stop it.
- CSS: `packages.css` `.row-swipe` (the pinstripes with an inset shadow, "sunk in") and `.row-swipe-control`
  (UITableView's editing control from `ref/teehanlax/ios6/sheet.svg`: 23pt, 2pt white rim, drop shadow 1.5pt/3.5pt;
  green #51b14f -> #3ba739 at 46.5% with the lower gloss #0f930d -> #1f9b1d under an arched top; red #dd878d ->
  #c73741 48% / #bd1321 50%; the glyph 13 x 3pt white bars with the kit's 0.5pt dark line above). Cancel is the red
  control's shape in grey with the + turned 45° into an x (the brief says both "grey x" and "same control in grey").
  `ios6.css` `.undo-bar`.
- Tests: `nav/rowswipe.test.js` (decide thresholds, offset/rubber band, armed; the gesture on a fake list: an armed
  lift commits once and swallows the click, an unarmed one doesn't; right swipe, scroll, edge start, pointercancel,
  a recycled row and a row with no action never commit), `screens/browse.test.js` (the action per state, messages,
  when the hint is due), `core/queue.test.js` (quiet adds, restore).

## Tried and failed

- First phone run: the row never moved. A debug overlay (copied into the installed bundle) showed `decide swipe`
  then at once a `lostpointercapture`: `setPointerCapture` on the list made WebKit drop the touch's implicit capture
  on the row's child, and that `lostpointercapture` bubbled up to the list and ended the drag as it began. Touch
  pointers are already captured by their target, so the explicit capture is gone; `lostpointercapture` alone (no
  pointerup) still cancels, as in `nav/swipe.js`.
- The row stayed blue (app.js's pressed look) during the drag: removed `is-pressed` when the drag starts.
- `.row-swipe.hint .row-swipe-control { transition: none }` failed `storepage.test.js` (packages.css may only
  transition transform/opacity); it's `transition-duration: 0s`.
- My first debug file had a raw newline inside a JS string (a heredoc ate the `\\n`), so the app stuck on Loading
  until I fixed the file.

## Checked

- `node --test web/app` (all pass after the fix above).
- 3x renders of the strip (headless Chromium, the real CSS, light and dark): `strip-3x-light.png`,
  `strip-3x-dark.png`: green at rest and armed, red, grey cancel, the 44px hint offset, the undo bar.
- iPhone 7 (built this branch's .deb, 0.9.2-1139, `apt-get install`; the final `rowswipe.js` copied into the bundle
  after the two fixes above, checked byte-equal with sha1 for every changed web file), under the F193 lock:
  - Search "appsync": slow swipe on AppSync Unified -> the row slides off over the pinstripes with the green +
    (no blue); let go -> springs back with "Queued for Install", Q'd badge, undo bar "Install AppSync Unified
    queued", no Confirm sheet. Undo -> mark and badge gone (`phone-install-undo.png`).
  - Installed: curl -> red minus, "Queued for Remove", "Remove curl queued"; swipe again -> grey x, mark gone,
    "Remove curl cancelled" (`phone-remove-cancel.png`).
  - Vertical flick on Installed scrolls. Sources > ElleKit > All Packages: edge swipe from x=1pt across a package row
    goes back to ElleKit, nothing queued. A right swipe from mid-row does nothing; a tap opens the package page.
  - Hint: with `cydian.swipeHint` and `cydian.consoleLogs` taken out of the app's localStorage (pulled, edited with
    Python's sqlite3, pushed back with the app stopped), opening Installed eased bash left ~44pt showing part of the
    green control, and back (`phone-hint.png`, a burst of screenshots). Relaunching: no hint. Then I put the original
    localStorage back (console logs and flag included).
- The phone is left on 0.9.2-1139 with this branch's final web files.

## Not verified

- Upgrade on the phone: no installed package has a newer version (as in F192), so only the unit test covers the
  green + for Upgrade.
- Changes tab and Browse section lists on the phone: same `packageList`, but I only swiped Search, Installed and a
  source's All Packages.
- The rubber band's feel and the armed scale-up mid-drag: phonectl swipes move at a constant speed and screenshots
  only catch moments, so how it feels under a finger is for a person to judge.
- Reduced motion skipping the hint: unit test only (`swipeHintDue`); I didn't turn Reduce Motion on on the phone.
- Recycling mid-drag on the phone (a row rebound while dragged): unit test only; with `pan-y` a horizontal drag
  doesn't scroll, so it's hard to cause by hand.
- The website: no swipe there (no queue), by design; not opened in a browser.
- 120 Hz: the iPhone 7 is 60 Hz. The swipe animates only transform (and the control's transform/opacity).
