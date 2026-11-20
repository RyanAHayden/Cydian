# F305: Find More Sources (Canister's repo index), Canister trust, sideload Search tweaks

Concept: https://claude.ai/artifact/ACNfYiCTv6dz39vphokG8R (user-approved v2, 2026-11-20).

## What was built

- **core/canister.js** (tests: core/canister-repos.test.js, fixtures fetched live 2026-11-20 in core/fixtures/f305/)
  - Repository endpoints: `repoSearchUrl`, `rankingUrl`, `repoUrl`, `repoPackagesUrl`; `createCanister` gains
    `.repos(q)`, `.ranking(r)`, `.repo(slug)`, `.packages(slug)` (same 10-minute cache, one request per URL).
  - `repoFrom` / `mapRepos` / `popularRepos` (tiers 1 and 2, empty repos out, most packages first),
    `canisterSafe` (tier 1 or bootstrap), `repoLabel` (blocked > our known-safe list > Canister > Trusted > Unknown),
    `repoMatch`, `trustQuery`, `mapRepoPackages`, `injectableWith`/`loadInjectable`, `createRepoCache`
    (localStorage `ifizbox.canisterRepos`, facts 7 days, misses 1 day, 300 repos).
  - `mapResults` rows now carry `tag` and `repo.tier` / `repo.bootstrap` (canister.test.js's deepEqual updated).
- **screens/findmore.js** (new; tests: screens/findmore.test.js)
  - `#/sources/manage/find`: Search Repos bar, Popular on Canister or results, a round Add on each row (green at
    once with a spinner), Other Directories: ios-repo-updates.com ↗ "Not checked by <NAME>", footer crediting Canister
    with a canister.me link and "Piracy repos are never shown".
  - `#/sources/manage/find/<slug>`: Trust (Label, Why, HTTPS, Signed Releases), Packages (Tweaks for Sideloaded Apps
    in the sideload app, counted from Canister's package list through the injectable filter, tap = sheet of them;
    All Packages; Open Source once added), Add/Added in the nav bar.
  - `labelCanister(li, source)`: an Unknown APT row on the Sources list turns "Known Safe · Canister" when Canister
    says tier 1 or bootstrap (asked once per repo by host, cached).
  - `addRepo`: Unknown repos go through Unknown Source (Add & Trust / Add Source / Cancel) first; then
    `manage.sourcesChanged(ctx)` so Sources loads it under the reload bar.
  - `searchAllRepos({ appName })`: Search All Repos sheet (for part 3, see F305a).
- **screens/extras.js**: `canisterApi` exported (one cache for Search, Find More and labels); Other Sources leaves out
  piracy-listed repos in both builds; in the sideload app (`tweakSourcesOn`) "Other Sources · Canister" lists only
  injectable tweaks with "Works in" (when the .deb was checked before) and the repo's label; a tap = `offerTweak`
  action sheet (Add Source & Add to App / View Repo; "<NAME> hasn't checked this repo." for Unknown);
  `addSourceAndAddToApp` (add, refresh it alone, catalog, then screens/tweaks.js addToApp). Add Source & Install
  and it share `addAndLoad` (behaviour unchanged; its tests pass).
- **screens/search.js**: Canister is asked in the sideload app too.
- **screens/sources.js**: Find More Sources is the last row of Tweak Sources (sideload app) or of Individual Sources
  (jailbroken), hidden while searching; rows get `labelCanister`.
- **screens/manage.js**: routes `find/…` to findmore.js; Manage's Recommended group gets a Find More Sources row.
- **screens/home.js** Credits > Software: Canister (Aarnav Tale), linking canister.me.
- **sources.css**: Find More row icon, green Add/Added, spinner, external arrow.

## Decisions

- **Tier 1 = the ranking's quality 1.** Ranking answers carry `quality`, search answers `tier` (same value for Chariz,
  Havoc, Procursus). Bootstrap = `bootstrap`/`isbootstrap`/`isBootstrap` true.
- **Trust lookup by host search** (`repository/search?q=<host>`): checked live, it finds Chariz, Havoc, Procursus,
  ElleKit, BigBoss by host. `repository/safety` only answers piracy safe/unsafe, so it isn't enough.
- **Known Safe · Canister beats the user's Trusted** (Known Safe beats Trusted in trust.js too); our own list wins
  over Canister (Chariz, BigBoss, Procursus show plain Known Safe).
- **Injectable filter on Canister data uses Architecture, Section and tags only**: package results carry no Depends
  (checked: keys listed in the session), so a tweak needing e.g. AltList can still show; the .deb check at Add to App
  is the real gate.
- **"Manage > Add"** read as the Manage page (its nav Add is an alert): a row under Recommended.
- **Find More shows where APT repos are kept**: jailbroken device types (end of Individual Sources) and the sideload
  app (end of Tweak Sources); the website while Not Jailbroken has no APT sources, so no row.
- **Part 3 (Add Tweaks' Search All Repos) split to F305a, after F302a**: the Add Tweaks page with Browse Tweak Sources
  is F302a's (running now, owns screens/tweaks.js). `searchAllRepos` is built and tested here; F305a adds the row.
  F305a also puts HTTPS / Signed Releases on an added source's own page (browse.js, not on this task's line); here
  they show on Find More's repo page.
- Repo page placeholder is the list shape (the test DOM has no lastChild for the page shape).

## What failed on the way

- Test DOM (nav/fakedom.test-helper.js) matches one class only: `:scope > .cell` and `.a .b` selectors found nothing;
  findmore.js now queries one class at a time.
- Process: two edits went through python/heredoc (the `export const canisterApi` line in extras.js and the CSS
  appended to sources.css) instead of the edit tool. The gate covers them.

## Not verified

- **Not run in WebKit or on a phone** (no sideload or jailbreak build made): the Find More page, the green Add, the
  action sheet and Add Source & Add to App were exercised with node tests and a fake DOM only. Needs a look in the
  sideload app and the site.
- **Canister's repo package list size**: `repository/<slug>/packages` ignores limit/page and returns everything
  (Chariz 1.5 MB, BigBoss ~10 MB). Fetched only on a repo page in the sideload app; not measured on a phone, and on
  the website it would go through the fetch proxy's size cap (the site never asks: Tweaks for Sideloaded Apps is
  sideload-only).
- **ios-repo-updates.com** link opening in the app (app.openURL, else window.open) not tried on a device.
- **Canister rate limits**: none published; each unknown APT source costs one search a week (misses a day).
