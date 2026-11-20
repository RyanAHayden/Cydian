# F291: safety nets (concept K2, option B: trust labels)

Approved page: https://claude.ai/artifact/8BZsvsM6KmMkx3ei4E16cz (v3, option B), plus the user's three notes of
2026-11-20 (Add Source's second alert, the jailbreak patch prompt like Cydia's Essential upgrade, the seven Report as
Malicious reasons). All three steps are built in this task.

## What was built

### Step 1: exploitable iOS + the alert
- `web/app/core/ios-exposure.js`: `EXPLOITABLE_IOS`, shipped like the piracy list (nothing fetched). Four entries,
  each with a range, the first fixed version and the CVE's NVD page: multicast_bytecopy (CVE-2021-30937, 14.0 to
  15.1.1, fixed 15.2), kfd smith (CVE-2023-32434, 15.0 to 15.7.6 fixed 15.7.7, and 16.0 to 16.5 fixed 16.5.1), kfd
  landa (CVE-2023-41974, 16.0 to 16.6.1, fixed 16.7). Overlapping entries: the alert names the newest fix.
- "Check Before You Install" (`exposureAlert`): plain wording, once per iOS version (`ifizbox.exposureSeen`), only when
  an app in the run comes from a source that isn't Known Safe or Trusted (a My IPAs file counts as untrusted). In the
  app (bridge present) a Software Update button opens `App-prefs:General&path=SOFTWARE_UPDATE_LINK` through
  `app.openURL` and stops that install; the website names Settings > General > Software Update in the message instead.
  Never a block. Quiet in the jailbreak build.
- Where it runs: `screens/safety.js installSafety`, called from `screens/queue.js readyToInstall` (sideload Confirm's
  run, both runAppQueue and runAppQueueRun; ready now receives the jobs), `runJailbreakApps` (malware/reports only),
  and `signing-client.js signAndInstall` (the website's and direct Install paths; iFizBox's own IPA skipped).
- Jailbreak build: each entry may list `patches: [{ id, name, repo, link, version }]`. `lookForPatch` (app.js, 6 s after
  launch and on Home's Reload) shows "Security Patch Available" (Later / Install Patch) when a listed patch for this iOS
  isn't installed. Install Patch adds the repo and queues the package through Extras' `addSourceAndInstall` (Confirm
  opens; never auto-installs). Later snoozes in sessionStorage per id and version: back at the next launch or for a newer
  patch version. Changes gets the row too (`patchUpgrades`, through `essential-ui.js upgradesWithSelf` in the jailbreak
  build) once the patch's repo is in the catalog, so the row opens its package page. It waits for dpkg's status
  (an empty installed list means not read yet, ask later).
  The brief said "reuse core/essential.js and its alert": since F183 that file has no alert any more (the self-update is
  a Changes row and a banner), so the patch alert reuses the same pieces instead: showAlert at launch beside
  lookForUpdates, Extras' Add Source & Install for the queue, Changes' upgrades list for the row.

### Step 2: known-safe list + labels
- `core/safe-sources.js`: `KNOWN_SAFE` = every Recommended source (by construction, so they can't drift) plus
  `KNOWN_SAFE_EXTRA` (iFizBox's own repo, Procursus, BigBoss, and the two app-sources.json defaults Recommended
  doesn't list: iTorrent, AppTesters). Matched by place: GitHub user/repo, else exact host; never github.com or a
  parent domain.
- `core/trust.js`: Known Safe / Trusted / Unknown; the user's Trusted list in localStorage `ifizbox.trustedSources`
  by place.
- Add Source (`screens/manage.js addSource`): Enter APT URL as before, Source Warning for piracy hosts as before, then
  "Unknown Source" (Add & Trust / Add Source / Cancel) only for hosts not on the list. Add & Trust marks it after the add
  succeeds.
- Sources tab rows and Recommended rows: pill at the start of the subtitle (green Known Safe, grey Trusted, the plain
  word "Unknown ·"). Holding a row adds Trust Source / Stop Trusting (not on Known Safe rows).
- App pages (`screens/altstore.js renderApp`): "Where It Comes From" right above Install: Source (name + label), Source
  Code (Public on GitHub, opening the repo from core/previews.js appGithub, or Not Public), Reports (count).

### Step 3: Report as Malicious + malware list
- Reviews tab on app pages: Report as Malicious beside Write a Review (`reviewsTab` takes `malicious`). An action sheet
  with the user's seven reasons; Something Else… asks for a short text (200 max). The version always goes along and the
  IPA's SHA-256 when this device knows it (`ifizbox.ipaHashes`, see Not verified).
- Worker: `worker/src/reports.js` (`/reports/<bundle id>`), D1 table `malicious_reports` beside the reviews, same
  device token hash and rate limits (`allowReviewWrite`, new export in src/reviews.js). One report per device per
  version; GET gives the count and reasons per version. Tested by `worker/test-reports.mjs` through
  `worker/test_reports.py` (kept out of worker/test.mjs so the merge stays clean).
- From 10 devices (`REPORT_BANNER`) the app page shows the red "Reported as Malicious" card naming the top reason, and
  installing asks first (Cancel / Install Anyway; asked once a session per app version). A slow (2 s) or dead server says
  nothing.
- `core/malicious.js MALWARE_IPAS`: confirmed malware by bundle ID (+ versions) or SHA-256, refused before signing with
  "Known Malware" (Why It's Listed / OK, no Install Anyway). Starts empty: nothing confirmed yet.

## Research (from the K2 page, kept)
AltStore/SideStore/Feather ship their own built-in and recommended sources and no trust labels; Sileo and Zebra ship
default repos. No maintained public "safe AltStore sources" list exists; Canister's lists cover piracy only. So the
known-safe list is ours, curated in Recommended.

## Tried and dropped
- The Write tool turned ` ` escapes in a regex into the raw characters, which broke the module; reports.js now
  uses src/reviews.js `clean()` instead.

## Not verified
- **The exploit ranges are from memory of Apple's notes and NVD, not re-read today** (no web access was used). A person
  should check each entry's range and fix against its NVD page and Apple's security notes, and add newer public
  exploits (iOS 17/18) if any are confirmed. Filed as a follow-up.
- No security patch package is listed: none is known to me. The patch alert, Install Patch and the Changes row are
  tested with a fixture only, not on the iPhone 7 (the task doesn't say to use it).
- No screen tested on a phone or in a browser: the gate's node tests drive the logic with fake alerts; DOM pieces
  (pills, Where It Comes From, the red card, the Reviews button) were not rendered or checked at 3x. CSS in sources.css.
- The IPA SHA-256 in reports: nothing records it yet. The native signer doesn't return it and the website's signing
  worker doesn't hash the bytes, so reports go without it for now and MALWARE_IPAS matches by bundle ID in practice.
  Filed as a follow-up.
- The Worker route isn't deployed (publishing is the runner's job); D1 makes the table on first use.
- `App-prefs:` opening Software Update from the sideload app is not tried on a device.
