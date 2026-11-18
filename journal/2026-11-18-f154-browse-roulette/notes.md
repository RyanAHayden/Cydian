# F154: Browse rebuilt from the approved concept, plus Tweak Roulette

## What was done
- **Browse page** (`screens/browse.js`, section "Browse (F154)"; home.js routes `#/home/browse` to it):
  - The nav bar title is a filter drop-down, "Featured ▾" (`titleView`, the hook F127 added). A tap opens an iOS 6
    action sheet with Featured / New / Top 25, and the title shows the choice. The page redraws in place and the body
    switches between grouped and plain. There's no segmented control (it overlapped Back). The choice lasts for the session.
  - **Featured**: a Tweak of the Day card, the Tweak Roulette row ("Spin for something new · N-day streak"), New This
    Week (3 rows; See All switches the drop-down to New), Collections (4) and All Categories.
    Placeholders while loading (pulsing bars in the card and 3 placeholder cells), no spinners.
  - **New** = F124's New list (`catalog.fresh("new")`, with day headers). **Top 25** = F124's Popular, cut at 25, with a rank
    on each row (`decorate` on `packageList`). The vlist is destroyed when the filter changes.
  - Tweak of the Day: `core/catalog.js dailyPick(rows, dayKey())` over the sources' featured rows plus Popular (top 60),
    narrowed to the build's kind (`browseKind`: tweaks/themes when jailbroken, apps otherwise). It falls back to all of them when
    none fit. Ids are deduped and sorted, then an FNV hash of the day picks one, so the pick holds for the whole day whatever order the rows arrive in.
  - Collections: `core/catalog.js COLLECTIONS`, each a test on the section and on words in the name or short description. They open as
    `browse/collection:<id>` (a searchable A–Z list through the new worker op `collection`). Jailbroken builds get Lock Screen, Home
    Screen, Keyboard and Make It Yours. Apps builds get Play / Create / Connect / Tools (decision: the tweak four don't
    mean anything for apps).
  - All Categories (`browse/categories`) shows the categories first, then F124's lists under "Lists", so Recently
    Updated, Free Apps and the others are still reachable.
  - Section icons come from `web/app/icons/sections`. The Roulette row uses a new `icons/roulette.svg`, the concept's own drawing.
- **No horizontal scroller**: `homeFeatured()` is gone from Home's root, Home's Reload, Home's `featured` route and
  Browse. `homeShowsFeatured` and `browseShowsFeatured` now return false. The F135 test is replaced by an F154 test.
  - Decision: a *source's* Sections page keeps its own sileo-featured banners (`featuredStrip`, F20). The brief's
    parenthetical scopes the removal to Browse's top and Home, and that strip is the source's own page, as in Sileo.
- **Tweak Roulette** (`screens/roulette.js`, `#/home/browse/roulette`): three wheels (type with section icons, vibe,
  price) moving by transform only, behind the iOS 6 band. A spin rests on a real free package (`catalog.roulette()` →
  `roulettePool`, then `spinPick`), and the price wheel always stops on a Free row. The result card has Wish List (toggles
  `core/wishlist.js`, "On Wish List" when added) and View (`browse/roulette/package:<id>`).
  - No spin limit (user's note on the task): no spins-left count and no Back Tomorrow. The stats are day streak and best streak.
    The streak counts once per day you spin, carries on if yesterday had a spin and resets after a missed day. It is stored in
    `localStorage["cydian.roulette"]`, the same storage and prefix as the settings. The option-based settings API can't
    hold a record, so it uses its own key, like the wish list.
  - Haptic tick: only when the app's bridge exists (`cydianApp` + `webkit.messageHandlers.cydian`; the native side
    has `haptic.tap`). Each frame it reads the reels' computed transforms and ticks when any wheel brings a new row under the band.
  - Apps builds name it "App Roulette" and spin app categories (`ROULETTE_TYPES.apps`). Decision: "Tweak" is wrong
    for a phone that can't install tweaks.
  - The type wheel is drawn at once from the device setting. If the worker's pool has other types (it knows the
    device for certain), the wheel is redrawn from the pool, and a spin rests on the pool's type by name. Found in the
    headless run: the wheel showed "Game" while the pool held tweaks.
- Card button: the concept's "Install" pill reads **View**, because it opens the package page (where Install lives). A button
  labelled Install that doesn't install would mislead.

## Tests
- `core/browse-f154.test.js`: dayKey/dayBefore (month, leap and year ends); dailyPick stable within a day across 20
  shuffles and duplicates, and varying over a month; browseKind; Collections over a real catalog (hidden sections, Not
  Jailbroken); roulettePool (free only, capped evenly, apps when Not Jailbroken); 300 spins per build all landing on
  a package `catalog.package()` finds in a source.
- `screens/browse-filter.test.js`: the drop-down's three choices through a fake action sheet (Cancel keeps the
  choice), each choice's rows (Top 25 cut and ranked from Popular), the routes below Browse and their titles, no
  segmented control, the CSS and icons present.
- `screens/roulette.test.js`: the streak across days (same day, missed day, month and year ends), no spin cap,
  storage (broken JSON, throwing storage), nextPos landing, Browse's row text.
- Headless Chromium (390×844 @3x) against a static server with the catalog patched to sample rows: screenshots in
  this folder (featured, sheet and Top 25, New and All Categories, Roulette before and after a spin). The spin landed on
  Cylinder Reborn, with the band reading Tweak / Hidden Gem / Free, and the streak went from 3 (yesterday) to 4. No console errors.

## Not verified
- **On a phone** (iPhone 7 / the app's WKWebView): not touched, because the task doesn't say to. Unchecked there: the 120 Hz wheel spin,
  the haptic ticks (they need the native bridge), and the action sheet over the title.
- **Real sources**: the headless run used a patched catalog (no Worker `/api/fetch` locally). The catalog functions
  are covered by node tests over real Packages/AltStore parsing, but the Collections word lists have not been
  checked against real repos for how many packages each catches.
- The placeholder state was not screenshotted (the patched catalog answers at once). Its DOM is built by the same code path.
- 3x zoomed render of the drop-down triangle and the pills against the kit: looked at in the screenshots only, not
  compared pixel by pixel to `ref/teehanlax` (the concept's values were reused, as the brief asks).
