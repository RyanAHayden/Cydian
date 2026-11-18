# B23: apt-get update failures per source, a banner instead of an alert

## The bug
Add Source & Install (Search → Other Sources, `screens/extras.js` addSourceAndInstall) said
"<repo> was added, but refreshing it failed: apt-get update failed (100): E: Some index files failed to download"
even though the added repo refreshed fine. `backend.update()` threw on any non-zero exit. apt exits 100 when **any**
source fails, and on the iPhone 7 one always does: the built-in source is still `https://cydian.dev/repo/` (old
domain, HTTP 525) in `ifizbox.sources`. The same throw also put up Sources' Refresh "Error" alert and stopped every
other source being read back.

## What changed
- `web/app/core/aptupdate.js` (new): `updateFailures(stdout, stderr)` reads apt's own output: the `Err:<n>` items
  whose last line is still Err (apt reports an optional Translation-en 404 as Err and then gives up on it with
  `Ign:<n>`, seen on mineek's repo), never Translation-*; `E:`/`W: Failed to fetch <url>`; and
  `E: The repository '…' …`. Not counted: the unsigned, GPG, no Hash and invalid Date warnings (the helper's
  AllowInsecureRepositories reads those repos) and the closing "Some index files failed", which names nothing.
  `failureFor(source, failures)` maps by URI (host case and trailing slash ignored) and suite (Err lines) or
  URL-under-repo (and `dists/<dist>/` for a suite repo). `failedBanner(failed)` words the banner.
  Fixture: `core/fixtures/apt-update-525.*`, the iPhone 7's real `apt-get update` output of today.
- `backend-native.js`: `update()` returns `failures`. Exit 100 with failures it can name is no longer an error
  (other exits, or 100 naming nothing, such as a held lock, still throw as before). `refreshSources` gives each failed
  source apt's reason as `error` (its row says Not Responding, F19) and `aptError` (cleared when it comes back), and
  its answer carries `failed: [{ key, uri, name, message }]` for every source apt named, filtered or not.
- `failed` survives the wrappers: `core/altstore.js` withAltSources and `core/essential.js` withBuiltins (which names
  the built-in). Found on the phone: the first build showed no banner because withBuiltins' `out.map(mark)` dropped it.
- `screens/extras.js` addSourceAndInstall: the added source's own failure (`aptError`, or its entry in `failed`)
  stays the blocking alert; other sources' failures are a banner and the install goes on.
- `screens/sources.js`: `bannerFailed(rows)` after Refresh and Refresh on Launch. No alert for these any more.
- `nav/banner.js`: `onTap` option (tap hides it and runs onTap); the refresh banner opens Sources and goes by itself
  after 6 s (`FAILED_BANNER_MS`).
- `screens/browse.js`: a source's page shows `aptError` under its health line, unless the catalog's own error says it.
- `native/fake/cydian-helper`: `FAKE_DEAD="<uri> …"` fails those repos the way apt does (Err/E: lines, exit 100).
- Swift and the real helper: no change needed (helper.run already returns apt's stdout and stderr).

## Tests
- `core/aptupdate.test.js`: the real fixture names only cydian.dev; Err/E: mapping by URI and suite; banner words;
  withBuiltins keeps `failed`.
- `backend-native.test.js`: update exiting 100 because of Havoc still refreshes Procursus, marks Havoc, `failed`
  lists it even when filtered out; a source that comes back loses its apt error. The old "Could not get lock" test
  still rejects.
- `screens/search.test.js`: Add Source & Install with another source failed: queued, banner, **no alert**, tap
  opens Sources; with the added source failed: the alert, nothing queued. `bannerFailed` in Sources.

## On the iPhone 7 (build 0.9.1-1092, tools/ui-7.sh under the lock)
- `refresh-banner.png`: Sources → Refresh: "Source Failed to Refresh / iFizBox: tap to see Sources." over the reload
  bar; no alert. It was gone by itself within ~6 s.
- `sources-marked.png`: the iFizBox (cydian.dev) row says Not Responding in red.
- `source-page.png`: its page: "apt-get update couldn't fetch Packages (525)".
- `add-install-banner.png`, `add-install-confirm.png`: the user's case. Mineek's repo taken out of cydian.sources
  (backed up), Search "appsync" → Other Sources → Mineek's AppSync Unified → Add Source & Install: Reloading Data,
  the banner, then Confirm. I pressed Cancel; nothing was installed. cydian.sources was restored byte for byte from
  the backup afterwards.
- Before installing, dpkg on the phone was interrupted (com.ryha.cydian 0.9.1-1044 half-configured, a pending
  uikittools trigger, from before this session). `sudo dpkg --configure -a` finished it. My build 1092 stays installed.

## Follow-up
- The built-in source is locked, so the user can't remove the dead cydian.dev line: noted on F172 (the domain move).

## Not verified
- Tapping the banner on the phone: phonectl taps on the banner weren't tried (it's up for 6 s while the reload bar
  runs). The tap → Sources path is covered by the unit tests only.
- A failure case on the phone where the **added** source itself fails (needs a dead repo Canister still lists);
  covered by the unit test only.
- Older apt's `W: Failed to fetch` form is handled from the docs' format, not from a real device's output.
