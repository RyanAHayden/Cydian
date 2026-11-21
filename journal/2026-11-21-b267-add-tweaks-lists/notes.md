# B267 Add Tweaks lists: scroll, plain rows

## What was wrong

- Browse Tweak Sources (`pickSourceTweak`), Search All Repos (`searchAllRepos`), a repo's Tweaks for Sideloaded Apps
  (`showRepoTweaks`) and Add to App (`pickApp`) put their content straight into the sheet's `.sheet-body`, which
  doesn't scroll. Add Tweaks itself got its scroller in B186 (`sheet-scroll page-body grouped`); these didn't.
- The Canister lists (`findmore.js tweakList`) used `nav/ui.js grouped()` with `icon.src` = Canister's `icon_url`.
  Nothing sized that `<img>` in those sheets, so a full-size logo (SparkDev's `/package-logo/<id>` images are big)
  was drawn at its own size over and across the rows, while the 29pt grey letter box stayed empty-looking.
- The subtitle started with the repo's trust label (`labelNode(labelOf(repo))`): "Unknown · SparkDev" on every
  row of a repo not on the known-safe list. Canister's data has version and author (checked with
  `api.canister.me/v2/jailbreak/repository/sparkdev/packages`: 492 rows, `author: "Spark"`, `icon_url` set).

## What I did

- New `web/app/screens/tweakrow.js`: `tweakListRow(r)` (Cydia's list row: 29pt `.tw-icon` with the package's Icon
  cropped into it over its section's icon, via `core/sectionicons.js packageIcon`; name; `tweakSubtitle`) used by
  Browse Tweak Sources and both Canister lists. Subtitle: version · author, plus the repo name for Search All
  Repos (results from several repos); the description only when neither exists. The trust word is gone from rows:
  offerTweak's sheet still says the repo is Unknown before anything is added.
- Scrollers: Browse Tweak Sources, a repo's tweaks and Add to App are `sheet-scroll page-body grouped`; Search All
  Repos uses `pinned()` (Search's layout), so its search bar stays under the nav bar and only the results scroll.
- CSS in `tweaks.css` (tweakrow.js loads it itself, since the repo page can open without Add Tweaks).
- `screens/tweakrow.test.js`.

## Checked

Scratch CDP harness (headless Chromium, SparkDev's real Canister data, live icon URLs): the three sheets in site
and app mode (fake bridge), iOS 6 / 7 / 13, at 320x568 and 430x932 (36 runs). Each: the scroller overflows and
scrolls to 300, the sheet bar doesn't move, every icon box is 29x29 with its picture inside, rows don't overlap,
no subtitle says Unknown, the page never scrolls sideways, no page errors. Screenshots looked right (iOS 6 search
at 320x568, iOS 13 browse at 430x932).

## Not verified

- On the iPhone 15 Pro: see the end of this file.
- The jailbreak build: Add Tweaks is the sideload/website flow; "app" mode in the harness ran with `jailbreak:
  null` (Lite). The jailbreak app shares the same CSS/JS for these sheets but hides the sideload flow, so there is
  nothing extra to see there.
