# F26: Home like Cydia's on the 4S

Reference: `ref/4s/screens/cydia-home.png`. Files: `web/app/screens/home.js`, new `web/app/home.css` (linked from
`index.html`), `web/app/img/cydian-icon.svg` (a copy of `native/icon/icon.svg`: the server and the app bundle only
ship `web/app/`), test `web/app/screens/home.test.js`.

## What Home has now
- Icon, "Welcome to Cydian", "by Ryan Hayden" (links the GitHub repo; the name is already public in About's URL).
- Tile rows, sizes from the 4S shot halved (43px tiles, 10px apart, 9px between halves, 8px corners, #999 edges):
  GitHub | Sources as one unfilled outlined pair split by a line (Cydia's Facebook | Twitter), then Featured and
  Themes as white half tiles. Themes = Sources tab, All Sources, section "Themes" (`#/sources/*/section:Themes`).
  Only the exact "Themes" section: catalog sections are not simplified, so "Themes (SpringBoard)" etc. aren't in it.
- Green state tile (#eefff0, Cydia's Manage Account), `stateTile({ sources, upgrades })`, in order:
  loading -> "Loading Sources"; no sources -> "Add a Source" (More Package Sources); upgrades > 0 ->
  "n Upgrade(s) Available" (Changes); any source with an error -> "n Source(s) Failed to Load" (Sources);
  upgrades === 0 -> "Everything Up to Date"; upgrade count unknown -> "See What's New" (Changes). No backend counts
  upgrades yet (needs the installed list), so today it never claims up to date; home.js calls
  `backend.upgrades()` if a backend grows one. The tile re-checks whenever the hash returns to `#/home`.
- Grouped list like Cydia's help links (white, #999, text may wrap): Upgrading & Jailbreaking Help (`home/help`, our
  own page), Find Extensions for Applications (Search tab), More Package Sources (`home/sources`), About.
- More Package Sources: Chariz, Havoc, Twickd, SparkDev, ElleKit, palera1n. Each answered with a Release (Origin
  checked) on 2026-11-17. Tap -> confirm alert -> "Verifying URL" HUD -> `addSource`; listed ones are ticked.
- Featured (`home/featured`): a note that featured packages appear when sources publish them, plus Browse Themes and
  All Packages, until F20 brings sileo-featured.json banners (they go above the tiles).
- Held look: every tile is a `.cell-inner` link, so app.js's `.is-pressed` and ios6.css's blue selection, white text
  and white chevron apply unchanged (shots `*-home-4s-held.png`).
- Dark: tiles use `--table`/`--table-edge`, green tile #2f4a36, by-line #a9c4f2.

## Tried / found
- First render showed a ~120pt gap above the links list, and Help/About showed only their first group: the
  rubber-band rule `.page-body > :first-child { min-height: calc(100% + 1px) }` (dca99b5) stretches the first child.
  Home wraps each page in one div. Settings root and the package page have the same problem: filed **B4**.
- `.grouped .cell + .cell` matches inside the pair because `.page-body` itself has class `grouped`, which drew a
  divider highlight across the top of the Sources half; reset in home.css.
- `addSource` only verifies flat repos, so the dist defaults (Telesphoreo, BigBoss, Procursus) can't be one-tap
  sources; the curated list is flat repos only.

## Screenshots
`shots/`, made by `tools/shots.mjs` (static `python3 -m http.server 8746` in web/app, headless chromium with
`--remote-debugging-port=9346`): `{light,dark}-home-4s` at the 4S's 320pt width (2x) for comparison with the
reference, `-home-4s-held`, `-home` at 390x844 3x, and the help, featured, sources and about pages.
Compared by eye with the reference: same order, proportions and colours; 3x zoom of tile edges shows no white lines.

## Not verified
- On the 4S itself: the task didn't ask to drive the phone, and the screen is shared under a lock; shots are
  headless Chromium, not iOS 6 Safari/WebKit.
- Adding a curated source end to end: the static server has no `/api/fetch`, so the Add flow (alert, HUD,
  addSource) was not run; the URLs were checked with curl instead.
- The state tile's upgrades and failed states on screen: only "See What's New" was rendered (the static server's
  default sources have no error field until a refresh); the text choice is covered by the node test.
- The native app build (needs its toolchain; the gate skips it where absent).
