# R24: iPhone 7 check of the Sources async refresh (one row per source)

Date: 2026-11-19. Device: iPhone 7, iOS 15.8.8, palera1n rootless. Build: main at a5e544d (includes F233 and
F233a), `native/build.sh deb` → `com.ryha.ifizbox 0.9.8-1599`, installed over 0.9.8-1579 with
`sudo -n apt-get install -y --allow-downgrades`. The new .deb stays installed.

Screenshots: `ref/7/screens/r24-*.png` (ref/ is gitignored, main checkout only).

## Setup

- The test sources: `https://r24-dead.invalid/` (dead host: `.invalid` never resolves) and `https://example.com/`
  (answers 404 for `Release` and `Packages`; checked with curl from the phone).
- **Adding them in the app doesn't work, on purpose:** `ifizbox://add?url=https://r24-dead.invalid/` opens Enter APT
  URL, filled in; Add Source answers "Verification Error: A server with the specified hostname could not be
  found." with only OK (Cydia's behaviour). So I backed up `/var/jb/etc/apt/sources.list.d/ifizbox.sources` and
  installed a copy with the two flat stanzas (`Suites: ./`) added, root:wheel 644.

## Results

| Check | Result |
|---|---|
| The two test sources go red with apt's reason | **Pass.** example.com: "apt-get update couldn't fetch Packages (40…" (404, cut off by the row width); r24-dead.invalid: "apt-get update couldn't fetch InRelease (Co…" (Could not resolve…). Red badge with "!" on the right. |
| The rest show Waiting, spin, then their counts | **Partly.** Every apt row spins from the first screenshot (~1 s after the tap) and then shows its count; AltStore rows keep their counts. **Waiting was never seen**: refreshrows.js shows Waiting until apt prints its first line for a source, and apt-get update starts every source at once, so it lasts well under the ~1 s a tap + screenshot takes (tried once more with tap and `phonectl shot` in one ssh call; still too slow). |
| Strip "Refreshing n of m…" then "k refreshed, 2 failed" | **Pass.** "Refreshing 18 of 26…" / "Refreshing 19 of 28…", then "25 refreshed, 3 failed". The third failure is palera1n's own repo (repo.palera.in answers 521, Cloudflare origin down), which also failed before the test sources were added ("25 refreshed, 1 failed"). So it's "2 failed" plus that real one. |
| Sources badge shows the failures | **Pass.** It spins during the run (as the code intends, Cydia-style), then shows 3 (1 before and after the test). |
| Leaving the tab mid-run | **Pass.** Changes during the run: the "Sources Failed to Refresh: r24-dead.invalid, example.com and palera1n: tap to see Sources." banner came up, the badge went to 3; back on Sources the rows and strip were right. |
| Tapping a red row refreshes only it, with update-source | **Pass.** r24-dead.invalid: only that row spins, the strip says "Refreshing 1 of 1…", then red again with the same reason, and the strip goes back to "25 refreshed, 3 failed". palera1n row: `sudo ps` during the retry showed `ifizbox-helper update-source https://repo.palera.in/ ./` running `apt-get -o Acquire::AllowInsecureRepositories=true -o Dir::Etc::SourceList=/var/jb/etc/apt/ifizbox-update-source.z1kxab -o Dir::Etc::SourceParts=/dev/null -o APT::Get::List-Cleanup=0 -o APT::Status-Fd=3 update`. Afterwards there was no temp file left in `/var/jb/etc/apt/`. |
| Remove the two test sources | **Done.** Put the backup back. The next Refresh still counted 28 (27 refreshed, 1 failed), with the test rows already gone from the list. The one after that counted "25 refreshed, 1 failed", the same as before the test. Backup, /tmp/iFizBox.deb and /tmp/r24.sources removed from the phone. |

## Small things seen (not filed; judge if worth it)

- While a failed row is retried (or a full refresh runs), its subtitle reads "Not Responding · <url>" in grey
  until the result comes in. It reads as if the source were already known dead. Small, and maybe on purpose.
- The first run after the out-of-band file edit counted 26 sources ("of 26"), so the list was the one from before
  the edit, while the two new rows did show up and fail in that same run. After removing them, the first run still
  counted 28. The run's total comes from the source list as it stood before apt ran. That's harmless because a
  person changes sources in the app, which reloads the list. Not a bug for real use.
- The failure reasons are cut off with an ellipsis on a 375 pt screen ("(40…", "(Co…"); the full text wasn't checked
  anywhere else (no detail view was opened).

## Not verified

- **Waiting state on the phone:** never on screen. apt starts every source in parallel, so rows go to the spinner
  in well under a second, faster than ui-7.sh can take a screenshot. The node tests cover the state mapping.
- **Adding the failing sources through the app's UI:** verification refuses a dead host, so they went into the
  sources file directly. Adding a reachable source and then making it fail wasn't tried.
- **The whole-update fallback** (helper without update-source, exit 64): not checked here because the installed
  helper has the verb. backend-native-live.test.js covers it.
- **A source's packages reaching Changes/Search as soon as it is done:** outside this task's checklist, not looked at.
