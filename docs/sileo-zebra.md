# What Sileo and Zebra do, and what Cydian should take (R11)

Read on 2026-11-18 from shallow clones: Sileo `c9f7015` (2024-10-08, github.com/Sileo/Sileo) and Zebra `e2f3c27`
(2026-11-15, github.com/zbrateam/Zebra). File paths below are relative to those repos.

**Licences.** Sileo is BSD-4-Clause (its `LICENSE` clause 3, the advertising clause, can't be combined with the GPL):
take **ideas only**, never its code. Zebra is GPL-3.0, like Cydian: code may be reused, with credit in the file
header and on the Credits page. Cydian is web code and Zebra is Objective-C, so in practice nothing below copies code
from either app. Each proposal describes behaviour, and each follow-up writes its own JS.

**Short version.** Cydian already has most of what these two apps are known for: Canister search for sources you
haven't added (F20), `sileo-featured.json` banners (F20), native Sileo depictions (`screens/depiction.js`), the
Payment Provider API (F20/F57), plain-language dependency errors (F18), refresh skipping by Release fingerprint, and
ETag/Last-Modified caching. The gaps worth filling are smaller: search history and ranking polish, a one-tap install
for Canister results, a Wish List, four depiction views, and two fields missing from the payment request bodies. The
ranked list of follow-ups is at the end.

## Search

### Sileo
- **Where it looks:** `Backend/Package Manager/PackageListManager.swift` `packageList(search:)`. It does a substring
  match (`localizedStandardContains`, so case and diacritics are ignored) on package id, Name, Author name and
  Maintainer name. It doesn't search the description.
- **Narrowing cache:** `UI/PackageListViewController` keeps `searchCache[query] = results`. On the next keystroke
  it finds the longest cached prefix of the new query (dropping characters from the end until one matches) and
  filters only those results, not the whole package list. Typing "snowb" therefore filters the results for "snow".
- **Ranking:** `sortPackages`: names starting with the query come first. Ties go to the name closest in length to
  the query (`name.count - query.count`), then alphabetical order. "Snowboard" therefore ranks above
  "Snowboard Classic Theme".
- **History:** words go into `UserDefaults["UserSearchHistory"]` when Search is pressed. The empty search page shows
  them as a list with a Clear button. Bug: the setter saves `Array(Set(newValue))`, so the order is lost and there's
  no cap.
- **Canister global search:** `Backend/Canister Resolver/CanisterResolver.swift`. 0.5 s after typing stops,
  queries of 2+ characters go to `api.canister.me/v2/jailbreak/package/search?q=`. Queries already asked are skipped
  for the session. Results ("provisional packages", minus bootstrap repos) show in their own section under the local
  ones. Tapping **Get** on one calls `queuePackage`, which adds its repo. When the refresh finds the package,
  `queueCache()` puts it in the install queue on its own, so the user gets **one tap from search to queued**. A
  Settings switch (`ShowProvisional`) turns it off.
- **Telemetry:** `ingest(packages:)` POSTs every installed package's id, version, author and repo to Canister's
  `/download/ingest`, along with device headers. Cydian should **not** do this. Zebra puts Canister behind a privacy
  screen (`Tabs/Home/Canister Privacy Controller`).
- **Piracy check:** `CanisterResolver.piracy(urls)` asks Canister's `/repository/safety` before adding a source.

### Zebra
- **Where it looks:** `Database/ZBDatabaseManager.m` runs SQLite queries. A scope bar under the field picks one
  field: **Name | Description | Author**. Name search is
  `WHERE NAME LIKE %q% ORDER BY arch weight, (exact = 1, prefix = 2, else 3), NAME COLLATE NOCASE`, which is the same
  tiers Cydian uses.
- **Live vs. full search:** with Live Search on (a Settings switch), each keystroke fetches only 7 columns with
  `LIMIT 30` (`ZBProxyPackage`). Pressing Search fetches every result in full.
- **Short queries:** a one-character query is ignored when the character is Latin (`< 0xFF`) and allowed for CJK
  scripts (`ZBSearchTableViewController.m`).
- **Recent searches:** the last **5** searches, newest first, no duplicates (`MAX_SEARCH_RECENT_COUNT`). They're
  saved when Search is pressed, show as a table on the empty Search page, and a Clear button removes them. Tapping
  one runs it again.
- **Filters:** `Tabs/Home/Settings/Filters` hides whole sections and **authors** (and blocks packages by author)
  everywhere: lists, search and Changes.

### Cydian today
`screens/search.js` with `core/catalog.js search()`, run in the worker:
- Every word must appear somewhere in name, id, description, author or maintainer.
- Rank tiers: exact name or id, then prefix, then substring in name or id, then author or maintainer. Ties are
  alphabetical.
- 120 ms debounce. A scope bar (All, Tweaks, Themes, Apps) plus a Filter panel (section, source, installed,
  free/paid, Show Incompatible).
- Canister "Other Sources" under the local results (`screens/extras.js discoveryGroup`, 2+ characters, 10-minute
  cache, `core/canister.js`).
- No search history. Each keystroke scans every row.

### Proposals (iOS 6 style)
1. **Recent Searches** (from Zebra): with the field empty, the results area shows a grouped table titled "Recent",
   holding the last 5 queries saved when Search is pressed or a result is opened. Newest first, no duplicates. The
   header has a Clear button, styled like the Mail and Maps "Clear" in iOS 6. Tapping a row runs it. Store the list
   in localStorage through `core/settings.js`, the way the other settings are stored. Don't copy Sileo's lost-order
   bug.
2. **Ranking tie-breaks** (from Sileo): inside the prefix and substring tiers, sort by name length (closest to the
   query first), then by how many sources list the package (`rankPopular`'s measure), then by name. Add a tier
   between "prefix" and "substring" for a **word-start** match, so "board" finds "Snow Board" before "Keyboard Plus".
3. **Narrowing cache** (from Sileo): in the worker, keep the last query and its hit rows. When the new query extends
   the old one (`q.startsWith(prev)`, same filters), scan only those rows. This is cheap on a modern phone, and on
   the 4S it keeps typing smooth with 20+ sources loaded. Measure it before adding it: it is only worth doing if a
   full scan takes more than ~16 ms on the 4S.
4. **Single Latin character**: skip local and Canister search for a one-character Latin query. Allow one CJK
   character (Zebra's rule). Today a one-letter query returns thousands of rows.

## Canister: from search result to installed

Sileo goes from a Canister result to the install queue in one tap: add the repo, refresh, then queue the package.
Cydian's alert (`screens/extras.js offer`) offers **Add Source** and then says "Refresh Sources to list it". The user
has to refresh, search again and tap Install.

**Proposal:** in the jailbreak app, the alert's buttons become **Cancel / Add Source & Install** (and Depiction).
Tapping Add Source & Install:
- shows the "Verifying URL" HUD and adds the source;
- refreshes that one source (the existing per-source refresh);
- opens the package page and queues the package (`getBackend().queue`), which brings up Confirm as usual.

If the refreshed source turns out not to list the package (stale Canister data), say so in an alert. On the site and
in the sideload build, keep the current Add Source.

Cydian already has its own static piracy list (`core/warnings.js`, taken from Canister's MIT list). Asking Canister
live would send every added source URL to a third party, so keep the static list.

## Native depictions (Sileo JSON)

**The format.** A package's `SileoDepiction:` field points at JSON shaped like
`{ class: "DepictionTabView", tabs: [ { tabname, class: "DepictionStackView", views: [...] } ], tintColor,
headerImage, minVersion }`. Sileo creates each view from its `class` name (`DepictionBaseView.view(dictionary:)`)
and skips classes it doesn't know.

**Views Sileo has**, from `UI/PackageViewController/DepictionView/*`:
- Layout: TabView, StackView, AutoStackView, LayerView, SpacerView, SeparatorView.
- Text: HeaderView, SubheaderView, LabelView, MarkdownView (fast; `useRawFormat` switches it to the slow HTML path).
- Media: ImageView, ScreenshotsView, VideoView.
- Tables and buttons: TableTextView, TableButtonView, ButtonView.
- Sileo-only: **RatingView** (stars from `rating`), **ReviewView** (`title`, `author`, `rating`, `markdown`; built
  from Rating, Subheader and Markdown views), **WebView** (`URL`, `width`, `height`, `alignment`: an embedded web
  page), **MinVersionForceView** (`minVersion` with a `view`: shows the view only when the app is that version or
  newer, otherwise "Requires a newer Sileo").
- Forms: a button action that opens a form fetched from a URL (`DepictionFormViewController`, kept to the form's
  host).

**Who ships them.** The default paid repos (Chariz, Havoc) and most modern repos give tweaks a `SileoDepiction:`.
F20 checked their featured files live. This task didn't sample depiction JSON across repos: see **Not verified** in
the journal.

**Cydian today.** `screens/depiction.js` renders every class in the list above except Rating, Review, WebView,
MinVersionForce and forms. Markdown is parsed locally and raw HTML goes through an allowlist. Unknown classes are
skipped, as in Sileo.

**Proposal:** add the four missing views, in iOS 6 style:
- **RatingView:** five stars drawn in CSS or SVG, in the grey and orange of the iOS 6 App Store.
- **ReviewView:** a grouped-table cell with the title in bold, then the author and stars, then the markdown.
- **WebView:** a sandboxed `<iframe>` (no scripts touching us, no top-level navigation), like HTML depictions. Use
  the `width`/`height` aspect ratio, http through the proxy as `mediaUrl` does.
- **MinVersionForceView:** compares against Sileo's version numbers, which mean nothing for Cydian. Render the inner
  `view` (that's what a current Sileo shows).

Forms stay out (they post user input to the repo). Their button can open the URL outside the app like any link.

## Featured banners (`sileo-featured.json`)

**Sileo.** Each repo's `sileo-featured.json` (`FeaturedBannersView`: `itemSize`, `itemCornerRadius`, `banners: [{url,
title, package, hideShadow}]`) sits at the top of that repo's page. Sileo's own Featured tab loads
`featured-<device>.json` from its store URL. That one uses more classes (`FeaturedPackageView`, `FeaturedHeaderView`,
`FeaturedButtonView`, …) and only Sileo's own server serves it. Zebra shows featured repos on Home
(`ZBFeaturedCollectionViewCell`).

**Cydian.** `core/featured.js` already parses `FeaturedBannersView`, shows banners on the source page, and shows a
few from each source on Home. Nothing to add. Sileo's store-wide featured file is Sileo's own curation, not a repo
format, so leave it out.

## Payment Provider API (paid packages)

**The flow** (both apps; Sileo `Backend/Payment Manager`, Zebra `Tabs/Sources/Helpers/ZBPaymentVendor.m`):
1. Read the endpoint from `<repo>/payment_endpoint`. `GET info` gives the vendor's name and icon.
2. Sign in by opening `authenticate?udid=&model=` in `ASWebAuthenticationSession` with callback scheme
   **`sileo`**. The callback carries `token` and `payment_secret`.
3. Keychain:
   - Sileo: the token is a plain item. The secret uses `.userPresence` with `WhenUnlockedThisDeviceOnly`, read
     after an `LAContext` check.
   - Zebra: the secret is stored under `<repo>payment`. When reading it fails with `LAErrorPasscodeNotSet`, Zebra
     carries on without the secret ("payment secret only applies when a passcode is set").
4. Get the price: `POST package/<id>/info`. Zebra tries **GET first** and falls back to POST for vendors that
   reject GET (`supportsGETPackageInfo`).
5. Buy: `POST package/<id>/purchase`. Status 0 means done. Status 1 means open `url` (https only) in another auth
   session, then treat the package as bought.
6. Download: `POST package/<id>/authorize_download` returns `{url}`. Download that URL as usual.
7. A reply with `invalidate: true` drops the saved token.

**What each sends.**
- Sileo puts `udid` and `device` in **every** POST and adds `token`, plus `payment_secret` for a purchase.
  `authorize_download` adds `version`, `repo` and **`architecture`**.
- Zebra sends `token` (`"none"` when signed out), `udid` and `device` everywhere. Its purchase also sends
  `payment_secret` (`null` when there is none). Its `authorize_download` adds `version`, **`architecture`** and
  `repo`.

**Cydian today** (`core/payment.js buildRequest`, `native/Sources/Paid.swift`): the same flow and the same `sileo`
callback. Keychain items use `.userPresence`/`WhenPasscodeSetThisDeviceOnly` and fall back to plain items when the
phone has no passcode. Two differences from both apps:
- `purchase` sends only `{token, payment_secret}`, with no `udid`/`device`.
- `authorize_download` doesn't send `architecture`.

A vendor that checks the device on purchase, or that serves different .debs for rootful and rootless, could refuse
or send the wrong build. Both are one-line fixes in `buildRequest` (follow-up 1).

**What R10 should check** (R10 is the device test of F57, still blocked for lack of a modern phone):
- After a purchase, the vendor's purchase and download records show the right device.
- `authorize_download` returns an **arm64 (rootless)** .deb. Check the downloaded control file's `Architecture:`.
- On a phone with no passcode, sign-in and purchase still work (Zebra's `PasscodeNotSet` case).
- An expired token produces `invalidate` and asks the user to sign in again.

## Queue and dependency resolution

**Zebra** (`Database/ZBDependencyResolver.m`, `Queue/`):
- It has its own resolver. It walks Depends with `|` alternatives in order and version comparisons, counts Provides,
  and queues conflicting installed packages for removal.
- Queue rows show why each one is there: "Dependency of X" / "Removed by X" in a subtitle, or red "Issues" when a
  dependency can't be met.
- Tapping a row with problems opens an alert listing them. Confirm stays greyed out while any row has issues.
- Queue types: Install, Remove, Reinstall, Upgrade, Downgrade, plus Dependency and Conflict for rows the resolver
  added.

**Sileo** (`Backend/Dependency Resolver`, `UI/DownloadsViewController`) runs libapt's resolver. Its queue sheet
lists installs, upgrades, removals and the packages they pull in, plus apt's broken packages as errors. Confirm
stays off while there are errors.

**Cydian today.** It already does better than Zebra's own resolver. Confirm runs real `apt-get -s` over the whole
queue (N4) and shows Modifications. "Cannot Comply" carries F18's one-sentence explanations with actions (Add
Chariz, Remove Y), with apt's output underneath.

**One idea to take:** Zebra's "Dependency of X" subtitle. In Confirm's Modifications, a package apt pulled in that
the user didn't queue could say why ("For Snowboard") in the iOS 6 grey subtitle. `apt-get -s` doesn't say which
package pulled what in. `core/deps.js` already has a `via` chain, so the reason can come from there. This is
low priority.

## Source refresh speed and caching

- **Sileo** (`Backend/Repo Manager/RepoManager.swift`): Release first, with a timeout per repo, and repos refresh
  concurrently. It tries `Packages.zst`, `.xz`, `.lzma`, `.bz2`, `.gz`, then plain, in that order. It keeps a hash
  cache (`RepoHashCache.json`) of each Packages file's sha256 from the Release, and when a new Release lists the same
  hash it doesn't download Packages again. On a normal launch it refreshes only repos older than **3 hours**
  (`repoRequiresUpdate`). Pull to refresh forces all of them.
- **Zebra** (`Downloads/ZBDownloadManager.m`): `If-Modified-Since` from the saved file's date, parsed into SQLite.
- **Cydian today:**
  - Release fingerprint (`core/health.js fingerprint`): an unchanged Release skips Packages, the same idea as
    Sileo's hash cache.
  - ETag/Last-Modified kept in IndexedDB (`core/cache.js`).
  - 8 repos at a time with a 20 s timeout each (`REFRESH_CONCURRENCY`, `REFRESH_TIMEOUT`).
  - Parsing runs in a worker.

  Nothing to take here. One thing to check later: does a cold start refresh everything, or only stale sources, as
  Sileo's 3-hour rule does? That's out of scope here.

## Other things worth having

| Feature | Sileo / Zebra | Cydian today | Proposal |
|---|---|---|---|
| **Wish List** | Both (`Wish List Manager`, `ZBWishListTableViewController`): add a package from its page, then list them all on one page | none | A "Wish List" row on the package page's More sheet ("Add to Wish List"), a Wish List page from Home/Manage as a plain package list. Rows that are installed drop off. Stored like holds |
| Hide by author | Zebra Filters | sections can be hidden, authors can't | Low: a "Hide Packages by <author>" row on the author page, listed in Manage > Hidden with sections |
| Installed sort | Sileo: Name / Install Date / Size | A–Z only | Low: a scope bar on Installed (Name, Recent, Size), as on iOS 6's Usage screen. dpkg's `info/<pkg>.list` mtime gives the date |
| Installed files | Zebra `ZBInstalledFilesTableViewController` | none for dpkg packages | Low: a "Files" row on an installed package's page listing `dpkg -L` (needs a helper call) |
| News tab | Zebra: r/jailbreak via api.getzbra.com; Sileo: recently updated packages | Changes tab (recent updates, Cydia's) | Skip: Reddit is third-party content, and Changes already covers updates |
| Community sources | Zebra: a list per jailbreak | `core/recommended.js` | Already there |
| Telemetry | Sileo: Canister ingest of installed packages | none | Keep it that way |

## Ranked follow-ups

Each one is filed with `agent-runner plan add`, with its files and test.

1. **B10: payment request fields.** `purchase` should send `udid` and `device`, and `authorize_download` should send
   `architecture`, as both Sileo and Zebra do (`core/payment.js`, test `payment`). This is small, and it's a
   correctness risk for paid installs.
2. **F99: Add Source & Install from Canister results.** One tap from a search result to Confirm in the jailbreak app
   (`screens/extras.js`, test `search`). It's the biggest everyday gain.
3. **F100: Recent Searches** on the empty Search page: last 5, Clear (`screens/search.js`, test `search`).
4. **F101: search ranking.** Word-start tier, name-length and source-count tie-breaks, and skip single Latin
   characters (`core/catalog.js`, `screens/search.js`, test `catalog`).
5. **F102: Wish List.** Add from the package page, a list page (`core/wishlist.js` new, `screens/browse.js`,
   `screens/home.js`, test `wishlist`).
6. **F103: the four missing depiction views.** Rating, Review, WebView, MinVersionForce (`screens/depiction.js`,
   `packages.css`, new test `depiction`).
7. **R12 (low): search cost on the 4S.** Time `catalog.search` per keystroke with all default sources loaded, then add
   the narrowing cache only if it's over 16 ms.
8. **F104 (low): Installed sort by Recent and Size**, and Hide by Author. Filed together as low. They're small and
   nobody asked for them.

## Search cost, measured (R12)

`core/catalog.js search()` timed per keystroke in desktop node 26 (Ryzen 7 9800X3D) with every default source loaded,
2026-11-18 (`journal/2026-11-18-r12-search-cost/bench.mjs`; 6 typed queries, 39 keystrokes, median of 15 runs each):

| Load | Rows | Typical keystroke | One-letter query | Worst single run |
| --- | --- | --- | --- | --- |
| arm64 (what a modern phone reads) | 2,614 | 0.24 ms | 0.5–0.7 ms | 1.6 ms |
| arm + arm64, every APT source twice (heaviest) | 12,919 | 1.25 ms | 3.4–4.3 ms | 7 ms |

Every keystroke is far below the ~16 ms threshold, so **the narrowing cache (proposal 3) was not filed**. The
scan over `_hay` is ~1 ms per 10k rows. One-letter queries cost the most because they sort thousands of hits, and
F101's single-Latin-character skip (proposal 4) removes those. The 4S is a reference device only and never runs
Cydian, so search was not timed on it. It wasn't timed on a modern iPhone either: no task allows driving one.
