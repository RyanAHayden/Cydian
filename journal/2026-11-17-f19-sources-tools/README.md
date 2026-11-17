# F19: Sources tools

Five parts. (1) and the reorder half of (4) were already built by F45/F52 (Manage > Import & Export, Manage >
Sources' grabbers). This task added tests for every foreign format plus a stricter duplicate check, and built
the rest.

## What I did

1. **Export / import** (`core/sourcelist.js`): Import now drops a duplicate whichever way it is written: with or
   without a trailing slash, or as a bare URL beside `deb <url> ./`. New tests (`core/sourcetools.test.js`) cover
   the export → import round trip (everything comes back as Already Listed), plain lines, Sileo deb822, Zebra's and
   Cydia's one-line `sources.list`, and a SideStore/AltStore JSON list and links. Already-listed entries are skipped.
   It all runs on the site as well (same frontend).
2. **Repo health** (`core/health.js`, new):
   - Records gain `reachedAt`, `failures`, `releaseDate` (Release `Date:`), `releaseHash` and `countArch`.
   - `healthOf()` gives a state (unknown / ok / quiet = no new Release for a year / down) and a label, e.g.
     "Not Responding · last reached 10 days ago" or "Reached today · Release 3 days ago".
   - The Sources row puts "Not Responding · " in front of the URL; the row is already red on error. A source's
     Sections page has the full label as a footer under Open In (`screens/browse.js`, one line).
   - **Per-repo timeout**: `refreshTimed` gives each source 20 s (`withTimeout`). After that the source gets a
     "Not responding" error and the rest go on.
   - **Many repos**: `pool()` runs at most 8 refreshes at once, for both APT (`core/sources.js`) and AltStore
     (`core/altstore.js`). Before, it fired every source at once.
   - **Release first**: `refreshSource` reads the Release first. If its text has the same fingerprint as last time,
     with the same architecture and no earlier error, the stored count stands and no Packages is fetched. An
     unchanged repo costs one request (tested).
   - **Conditional GETs**: `/api/fetch` (`web/app.py` `_answer`) sends an ETag (sha256 of the body) and the repo's
     Last-Modified, and answers `If-None-Match` / `If-Modified-Since` with an empty 304. `backend-http.js` `text()`
     keeps validators and small bodies (`validatorCache`, LRU, ≤1 MB each) and sends them back; on a 304 it reuses
     the text it kept. Tested in Python (`test_app.py ConditionalFetchTest`) and node.
   - The native backend saves the health fields too (`backend-native.js`, `healthFields`).
3. **Source Warning** (`core/warnings.js`, new): our own list of 18 well-known piracy repos. Each entry has a reason
   and a link to its entry in Canister's public piracy list (github.com/cnstr/manifests, MIT; I checked the links
   with curl, 2026-11-17). Matching is on the exact host (`www.` dropped) and handles URLs, bare hosts, sideloader
   links and `{ uri, dist }`. Add Source (`manage.js addSource`, which /add links and browse's add-source rows use
   too) shows Cydia's "Source Warning" with Cancel / Add Anyway **before** anything is fetched. Import puts listed
   ones in a "Source Warning" group, unticked, with the reason as the subtitle.
4. **Search box in Sources** (`screens/sources.js`): the iOS 6 grey search bar (Search's `.search-bar`) above the
   list. It filters as you type (`filterSources`: every word must be in the name, URL, subtitle or origin;
   case and accents ignored). All Sources steps aside while a search is on, and the header shows "N of M". The bar
   is kept across redraws so typing keeps focus. Reorder was already there (F45).
5. **Recommended for the jailbreak** (`core/recommended.js`): each tweak repo has a `for: [...]`, and
   `recommendedFor()` lists that jailbreak's repos first. The lists come from Dopamine's own default.sources
   (DOBootstrapper.m) and palera1n's loader config (palera.in/loader.json). nathanlr writes no apt sources, so it
   gets the rootless stores. `detectJailbreak()` reads apt's source files in the app (new
   `backend-native.aptSourceFiles`): `palera1n.sources` means palera1n; a `default.sources` holding Dopamine's
   repos means Dopamine. Recommended has a **Jailbreak** row to pick one (kept in localStorage), and it shows the
   detected one. **First run**: on a jailbroken device type the Sources tab shows a "Recommended Sources" row
   (renamed "Recommended for Dopamine" once detected) until Recommended has been opened once.

## Decisions (unattended)

- **The warning list is ours, copied in from Canister, not fetched live**: the brief says "our own list in the
  repo". I took only the famous ones, not all ~170. Several Canister entries are personal github.io sites I couldn't
  judge.
- **The check runs before fetching**, unlike Cydia, which asked after verifying. There is no reason to fetch a
  flagged repo first.
- **No upstream conditional GETs**: `web/fetch.py` is not on this task's files and its Fetcher can't send extra
  headers. The proxy's 304 saves the phone's download. Release-first saves the Packages request. Filed **F55**
  for upstream revalidation.
- **nathanlr isn't auto-detected**: its marker (`.installed_nathanlr`) needs a native bridge change (native/ is not
  on the files list). Filed **F56**. Until then the user picks it on Recommended.
- BigBoss is in Dopamine's defaults but is a dist repo, and `recommendedSeed` only takes flat repos, so it is left
  out (commented in recommended.js).
- First-run means a row that leads to Recommended, not seeding different defaults. On the jailbreak app the list
  is apt's own, so seeding wouldn't apply. On the site, an alert at first launch would get in the way.

## Checked

- `node --test web/app`: 361 pass. `core/sourcetools.test.js`: 20 tests (round trip, each format, health states,
  failure counting, Release date, timeout/pool, Release-first reuse, a hung repo timing out without holding the
  others, conditional-GET reuse in backend-http, validator LRU, warning matches, warned import, search, jailbreak
  detection and lists, saved pick).
- `python -m unittest test_app` (web/): 8 pass, including ETag/304/If-Modified-Since.
- Headless Chromium over CDP at 390×844@2x (scratch script, jailbroken rootless type, site backend). The Sources
  tab showed the search bar, All Sources, Recommended Sources and the rows. Typing "cha" left Chariz and
  Flycast-iOS26 (github.com/chachillie). Recommended showed the Jailbreak row, "Not set" on the site. Adding
  https://repo.hackyouriphone.org/ showed the Source Warning alert with reason and link.

## Not verified

- **"Add Anyway" may be cut off** ("Add Any…") in headless Chromium, whose fallback font is wider than Helvetica
  Neue. On an iPhone it probably fits, but nobody has looked. If it doesn't fit, the shared alert CSS
  (sources.css `.alert-button`) needs a shrink-to-fit, which I left alone because other screens use it.
- **Not Responding on a real dead repo**: covered by the unit test with a hung fake backend. Not seen in the browser.
  The CDP run didn't refresh, to keep load off the public proxy targets.
- **Browser 304 pass-through**: per the Fetch spec, a 304 on a request with author-set conditional headers reaches
  script. Tested with a fake fetch and the Flask test client, not in a real browser against the real proxy.
- **Jailbreak app**: detection from `apt.sources`, the Jailbreak row's "found on this iPhone" text and health on
  the native refresh path were not run on a phone (no device for this task). Natively, Refresh reads apt's lists
  after `apt-get update`. If update failed for one repo, the stale local lists still read fine, so "reached" can
  be optimistic there.
- **Import review's Source Warning group and the picker alert** (5 stacked buttons) were not rendered; only their
  logic is unit-tested.
- **Refresh speed with hundreds of real repos**: not measured. The pool, per-repo timeout and Release-first skip are
  unit-tested; no benchmark.
