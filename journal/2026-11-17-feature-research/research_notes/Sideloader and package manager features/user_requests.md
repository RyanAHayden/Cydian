# User requests and pain points: jailbreak package managers and sideloading apps

Method (2026-11-17): GitHub issue search via the `gh` API, sorted by total reactions, per repo, plus title-keyword
searches for feature requests. Reaction counts are "total reactions" (mostly 👍) as of 2026-11-17; "c" = comments.
Reddit could not be read directly: old.reddit.com is blocked for the fetch tool, the redlib mirrors tried were
behind Anubis bot challenges or down, and the Arctic Shift archive API timed out on every query. Web search returned
almost no opinion threads (mostly directory sites). So the Reddit and "Cydia vs Sileo vs Zebra" sections are thin and
say so. Treat GitHub reaction counts as a small-sample signal: jailbreak package manager trackers get very few
reactions (single digits), sideloader trackers get tens to ~110.

Note on repos: Feather moved from `khcrysalis/Feather` to `claration/feather` (5.1k stars). TrollStore is
`opa334/TrollStore`.

## Ranked list (summary across all questions)

Ranking weighs reaction counts, number of duplicate issues, and recency (2023-2026 weighted most).

1. **Sign-in / refresh breaks after Apple changes (sideloaders).** By far the biggest pile of reactions in 2026: AltStore -80045 (111r), iOS 27 "machineID" (84r), HTTP 503 after 2FA (41r); SideStore iOS 26.4 refresh (34r), UDID/pairing (21r), -80045 duplicates (#1709 19r, #1652 18r, #1688 10r, #1685 11r). Users want an app that tells them clearly what broke and keeps working. Relevance to Cydian: an update/expiry *monitor* that alerts when sideloaded apps are about to expire or a source's signing broke.
2. **7-day expiry, 3-app limit, and refresh that silently fails** (SideStore/AltStore, Reddit). Background refresh "never worked for me"; workaround is LiveContainer (one slot, many apps).
3. **Backup/restore of sources and package lists, and persistence across reinstall/rejailbreak.** Sileo #264, SideStore #1060, Feather #183 (app data export, 8r/16c), Feather #222 reorder repos.
4. **Clear compatibility info: filter/search by iOS version, "is this compatible with my device", rootless/rootful.** Sileo #249, #222 (17c), #312, #255 (dependency errors users don't understand).
5. **Better dependency error messages / "silently fails to install".** Sileo #255, Zebra #2052 (2r, open), Zebra has 29 issues with "dependency" in the title.
6. **Search: across sources, within Sources tab, filters.** Zebra #1940, #868 (filter), 56 Zebra issues with "search" in title.
7. **Changes/updates view, Upgrade All, queue clarity.** Zebra #25 (changes tab), #1535 (Upgrade All missing), #1992 and #1892 (queued indicators, a Cydia-like behaviour).
8. **Scale and reliability with many repos / dead repos.** Zebra #1965 (adding many repos breaks it), #1764 (show repos that are down), #1266 (request timeout setting).
9. **Edit app before install (name, bundle id, icon, extensions, entitlements) and source support in sideloaders.** SideStore #780, #218, #322; TrollStore #662 (top TrollStore issue, 10r), #66; Feather #424, #271; LiveContainer #122, #734 (source support).
10. **Per-app metadata: size, date added/updated, which source an app came from, real progress bars.** LiveContainer #827 (13r), Feather #172, #209, #495, #113.
11. **Platform reach: AltServer on Linux, Docker, M1 Mac, multiple devices, Apple TV, EU/PAL.** AltStore #6 (93r), #712 (37r), #42 (28r), #558 (45r), #26 (40r), #23 (35r); SideStore #986 (56r, notarize for AltStore PAL) and #1052 (19r).
12. **Shortcuts / automation and keyboard shortcuts.** Zebra #1892 (Shortcuts integration), SideStore #905 (Shortcuts "no wifi or VPN" error), AltStore #919 (auto-refresh), LiveContainer #1367 (launch shortcuts).
13. **Community layer: reviews/comments on packages, community depictions, blocking authors.** Sileo #249, Zebra #1309 (28c design discussion), #1037, #998.
14. **Battery drain / background activity** of sideload helpers: SideStore #1624 (14r, 2026-09).

## Most requested features on GitHub per app

### Takeaway
Jailbreak package manager trackers (Sileo, Zebra) are nearly dormant since 2023 with tiny reaction counts; their recurring asks are compatibility filtering, clearer dependency errors, search, changes/upgrade-all, and backup of sources. Sideloader trackers are dominated in 2026 by Apple sign-in breakage; their feature asks are source support, app editing before install, backups, multi-platform servers, and EU/PAL distribution.

### Cited Findings

Sileo (Sileo/Sileo), all low counts:
- Top-reacted open issue is "there is no ipa download" (6 reactions, 2024-08) — [Sileo #347](https://github.com/Sileo/Sileo/issues/347)
- Suggestion (2022-12, 3r, open): "filter in search to sort by iOS version, it's hard to find compatible tweaks" and "a review or comment section so we can ... inform others of issues / other compatible iOS versions" — [Sileo #249](https://github.com/Sileo/Sileo/issues/249)
- Request for a native-depiction way to check iOS compatibility (17 comments, 2022) — [Sileo #222](https://github.com/Sileo/Sileo/issues/222); "Compatible category" (2023, open) — [Sileo #312](https://github.com/Sileo/Sileo/issues/312)
- Better dependency error message: after iOS 15 jailbreaks, r/jailbreak users hit the `firmware` meta-package error and "were unsure how to proceed due to ... the vagueness of the error Sileo provides" (2022-12, open) — [Sileo #255](https://github.com/Sileo/Sileo/issues/255)
- Persistent packages & sources: keep a list of sources and packages in a Files-app/Finder-accessible folder, surviving reboot (2023-02, open) — [Sileo #264](https://github.com/Sileo/Sileo/issues/264)
- Hide tabs in native depictions (3r, 9c) — [Sileo #225](https://github.com/Sileo/Sileo/issues/225); package view gestures — [Sileo #112](https://github.com/Sileo/Sileo/issues/112)
- Crash on search before initial refresh finishes (2020) — [Sileo #59](https://github.com/Sileo/Sileo/issues/59); tweaks disappearing from New section — [Sileo #60](https://github.com/Sileo/Sileo/issues/60)
- Keyword counts in issue titles (all time): crash 17, search 3, depiction 3, slow 2 — via GitHub search on [Sileo issues](https://github.com/Sileo/Sileo/issues)

Zebra (zbrateam/Zebra), all low counts:
- 1.2 design discussion on community depictions (5r, 28c, 2020) — [Zebra #1309](https://github.com/zbrateam/Zebra/issues/1309); redesign of Packages view (5r) — [Zebra #1203](https://github.com/zbrateam/Zebra/issues/1203)
- Filter for viewing packages (4r) — [Zebra #868](https://github.com/zbrateam/Zebra/issues/868); search the Sources tab (2r, open since 2021) — [Zebra #1940](https://github.com/zbrateam/Zebra/issues/1940)
- Adding too many repos breaks the app: "it no longer downloads the content of repos and the links become red" (3r, 2022) — [Zebra #1965](https://github.com/zbrateam/Zebra/issues/1965); show repos that are down — [Zebra #1764](https://github.com/zbrateam/Zebra/issues/1764); configurable HTTP timeout — [Zebra #1266](https://github.com/zbrateam/Zebra/issues/1266)
- Beta prompting to update already up-to-date packages (3r, 7c) — [Zebra #1310](https://github.com/zbrateam/Zebra/issues/1310); queue doesn't show queued packages right away (3r) — [Zebra #1992](https://github.com/zbrateam/Zebra/issues/1992)
- Missing Upgrade All button (2r) — [Zebra #1535](https://github.com/zbrateam/Zebra/issues/1535); a tab showing all changes/updates (2019) — [Zebra #25](https://github.com/zbrateam/Zebra/issues/25)
- Tap a dependency to open it — [Zebra #1414](https://github.com/zbrateam/Zebra/issues/1414); make package info section more useful — [Zebra #1343](https://github.com/zbrateam/Zebra/issues/1343)
- Block packages/authors from depictions; filtered authors still appear in updates — [Zebra #1037](https://github.com/zbrateam/Zebra/issues/1037), [Zebra #998](https://github.com/zbrateam/Zebra/issues/998)
- Multi-ask (2021, open): keyboard shortcuts (⌘F search, ⌘R refresh), indicators for queued items "I believe Cydia does this", filter installed packages, user-friendly changelog, Shortcuts integration — [Zebra #1892](https://github.com/zbrateam/Zebra/issues/1892)
- "Silently fails to install certain packages" (2r, open, 2023-06) — [Zebra #2052](https://github.com/zbrateam/Zebra/issues/2052)
- Import Sileo sources; open `cydia://` URLs; local repo; delete multiple repos at once — [#35](https://github.com/zbrateam/Zebra/issues/35), [#919](https://github.com/zbrateam/Zebra/issues/919), [#1904](https://github.com/zbrateam/Zebra/issues/1904), [#349](https://github.com/zbrateam/Zebra/issues/349)
- Keyword counts in issue titles (all time): crash 154, search 56, dependency 29, refresh 27, depiction 16, slow 6 — via GitHub search on [Zebra issues](https://github.com/zbrateam/Zebra/issues)

SideStore (SideStore/SideStore):
- Top feature request: notarize SideStore for AltStore PAL (EU) (56r, 25c, open, 2025-05) — [SideStore #986](https://github.com/SideStore/SideStore/issues/986); EU SideStore PAL (19r, open) — [SideStore #1052](https://github.com/SideStore/SideStore/issues/1052)
- 2026 bugs with most reactions: iOS 26.4 can't refresh (34r, 85c) — [#1174](https://github.com/SideStore/SideStore/issues/1174); UDID/pairing file (21r) — [#1262](https://github.com/SideStore/SideStore/issues/1262); -80045 sign-in (19r, 18r, 10r) — [#1709](https://github.com/SideStore/SideStore/issues/1709), [#1652](https://github.com/SideStore/SideStore/issues/1652), [#1688](https://github.com/SideStore/SideStore/issues/1688); high battery drain and background activity (14r, 2026-09, open) — [#1624](https://github.com/SideStore/SideStore/issues/1624)
- Crashes after self-refresh / manual refresh of expired apps (13r each, 2024) — [#711](https://github.com/SideStore/SideStore/issues/711), [#757](https://github.com/SideStore/SideStore/issues/757)
- Feature asks: modify app name/id/icon when installing (8r) — [#780](https://github.com/SideStore/SideStore/issues/780); remove extensions from source-installed apps (8r) — [#218](https://github.com/SideStore/SideStore/issues/218); choose extensions (4r) — [#322](https://github.com/SideStore/SideStore/issues/322); custom signing server IP (8r) — [#475](https://github.com/SideStore/SideStore/issues/475); backup and restore Sources, "or store sources in plain text in the user accessible folder" (5r, open, 2025-09) — [#1060](https://github.com/SideStore/SideStore/issues/1060); refresh on cellular (4r) — [#1058](https://github.com/SideStore/SideStore/issues/1058); Shortcuts "no wifi or VPN" workaround (4r) — [#905](https://github.com/SideStore/SideStore/issues/905); proxy support (3r, open, 2026-02) — [#1178](https://github.com/SideStore/SideStore/issues/1178)
- The repo has 119 GitHub Discussions (not mined) — [SideStore discussions](https://github.com/SideStore/SideStore/discussions)

AltStore (altstoreio/AltStore):
- -80045 can't refresh/install (111r, 93c, open, 2026-10) — [#1828](https://github.com/altstoreio/AltStore/issues/1828); iOS 27 "machineID" (84r, 2026-06) — [#1751](https://github.com/altstoreio/AltStore/issues/1751); HTTP 503 after 2FA (41r, 2026-10) — [#1842](https://github.com/altstoreio/AltStore/issues/1842); HTTP 415 on SMS code (18r) — [#1844](https://github.com/altstoreio/AltStore/issues/1844); sign-in 3840/503 (23r) — [#1782](https://github.com/altstoreio/AltStore/issues/1782)
- Long-standing feature asks: AltServer on Linux (93r, 107c, open since 2019) — [#6](https://github.com/altstoreio/AltStore/issues/6), plus [#712](https://github.com/altstoreio/AltStore/issues/712) (37r) and [#20](https://github.com/altstoreio/AltStore/issues/20) (22r); IPA install on M1 Mac (45r) — [#558](https://github.com/altstoreio/AltStore/issues/558); multiple device support (40r) — [#26](https://github.com/altstoreio/AltStore/issues/26); Apple TV (35r) — [#23](https://github.com/altstoreio/AltStore/issues/23); Docker image (28r) — [#42](https://github.com/altstoreio/AltStore/issues/42); enterprise accounts as paid (25r, 91c) — [#199](https://github.com/altstoreio/AltStore/issues/199); remember Apple ID password (15r) — [#1167](https://github.com/altstoreio/AltStore/issues/1167); auto-open Mail to auto-refresh (7r) — [#919](https://github.com/altstoreio/AltStore/issues/919); discard extensions when installing from a repository (2025) — [#1625](https://github.com/altstoreio/AltStore/issues/1625)

Feather (claration/feather):
- Roadmap issue (21r, 31c, 2024-08) lists: localizations, warn if certificate expired or revoked, a webpage to install on other devices — [Feather #26](https://github.com/claration/feather/issues/26)
- Keychain group modification (12r) — [#424](https://github.com/claration/feather/issues/424); export/import app data (8r, 16c, open; a tweak dev wiped user defaults "with no easy way to restore") — [#183](https://github.com/claration/feather/issues/183); entitlements modification — [#271](https://github.com/claration/feather/issues/271); reorder repos (5r) — [#222](https://github.com/claration/feather/issues/222); install right after sign "like in V1" (5r) — [#355](https://github.com/claration/feather/issues/355); feature parity with 1.x — [#400](https://github.com/claration/feather/issues/400)
- Metadata asks: date and size in description, date updated/added, show the Source on the app info screen, replace spinner with a progress view — [#172](https://github.com/claration/feather/issues/172), [#209](https://github.com/claration/feather/issues/209), [#495](https://github.com/claration/feather/issues/495), [#113](https://github.com/claration/feather/issues/113)
- Resign all apps in one go (open, 2025-12) — [#543](https://github.com/claration/feather/issues/543); Apple TV (open, 2026-01) — [#562](https://github.com/claration/feather/issues/562); import IPA from URL — [#72](https://github.com/claration/feather/issues/72)

LiveContainer (LiveContainer/LiveContainer):
- Dark-mode icons for Add to Home Screen (19r) — [#190](https://github.com/LiveContainer/LiveContainer/issues/190); a source for LiveContainer+SideStore (16r) — [#734](https://github.com/LiveContainer/LiveContainer/issues/734); show app size (13r) — [#827](https://github.com/LiveContainer/LiveContainer/issues/827); source support (12r) — [#122](https://github.com/LiveContainer/LiveContainer/issues/122); an update GUI (9r, open) — [#336](https://github.com/LiveContainer/LiveContainer/issues/336); import IPA via share sheet (8r) — [#1357](https://github.com/LiveContainer/LiveContainer/issues/1357); launch shortcuts and app order (7r) — [#1367](https://github.com/LiveContainer/LiveContainer/issues/1367)
- iOS updates break it: iOS 27 (22r, 64c) — [#1394](https://github.com/LiveContainer/LiveContainer/issues/1394); iOS 26.4 refresh (14r, 64c) — [#1152](https://github.com/LiveContainer/LiveContainer/issues/1152)
- Scam warning: a third party ("FlekStore") using LiveContainer to scam people (5r, 2025-10) — [#926](https://github.com/LiveContainer/LiveContainer/issues/926)

TrollStore (opa334/TrollStore):
- Top issue: update IPA settings before install (10r, open, 2023-12) — [#662](https://github.com/opa334/TrollStore/issues/662); change bundle ID / version — [#66](https://github.com/opa334/TrollStore/issues/66); installed app info (5r) — [#16](https://github.com/opa334/TrollStore/issues/16); one-click switch app type for all apps — [#670](https://github.com/opa334/TrollStore/issues/670); localisation — [#68](https://github.com/opa334/TrollStore/issues/68)

### Inferences
- The single most common feature theme in sideloaders is "let me manage apps from sources, edited the way I want, with metadata (size, date, source)". In jailbreak managers it is "tell me if this works on my device, and why install failed".
- Several asks are things Cydia already did well: Changes tab, queue indicators, Upgrade All, tap a dependency. Cydian keeping Cydia's behaviour covers them for free.
- Backup/export of sources as plain text is asked for in three different apps. A Cydian feature: export/import sources (and installed package list) as a text file or URL, and on the website a "paste your sources" import.
- Reaction counts on Sileo/Zebra are too low to rank finely; the ranking within that group is based on duplicates and keyword counts more than reactions.

### Gaps
- GitHub Discussions (SideStore has 119) and Discord feedback were not mined.
- Sileo's tracker may not be where users report (Discord/Twitter); low counts there may understate demand.

## What users complain about on Reddit and forums

### Takeaway
Direct Reddit reading failed (blocked), so this section rests on search snippets: the dominant sideloading complaint is the 7-day expiry, the 3-app limit, and refresh that fails silently; LiveContainer is the common workaround. For jailbreak package managers I could not retrieve 2023-2026 Reddit complaint threads.

### Cited Findings
- Free-Apple-ID apps expire after 7 days and won't open until refreshed; only three sideloaded apps can be active at once — [r/AltStore and r/sideloaded results via search, e.g. "Thinking about switching to SideStore" (2025-01)](https://axebps-redlib.hf.space/r/AltStore/comments/1i1bwav/thinking_about_switching_to_sidestore); [WhistleOut sideloading guide](https://www.whistleout.com/CellPhones/Guides/how-to-sideload-apps-on-ios-with-altstore-sideloadly)
- A 2025 thread said "SideStore promoted that it didn't have a three app limit, which was false"; commenters said the workaround broke around iOS 18.1/18.2 — [r/AltStore 2025-01](https://redlib.hackliberty.org/r/AltStore/comments/1i1bwav/thinking_about_switching_to_sidestore/m751ees/?context=3) (seen as a search snippet only; page could not be fetched)
- A user found it "a pain to keep up to date with the 7 day resigning window" and said background refresh "never worked for me" — [r/apolloapp 2025-04](https://reddit.birdcat.cafe/r/apolloapp/comments/1k8ej8d/psa_you_can_still_use_apollo/mp8c45e/?context=3) (search snippet only)
- A thread titled "Common SideStore annoyances and how to fix them" exists (2024-04) but could not be fetched — [r/sideloaded](https://lr.eu.psf.lt/r/sideloaded/comments/1bxywa5/common_sidestore_annoyances_and_how_to_fix_them)
- Sileo is described as "effectively the dominant package manager app" on Dopamine and palera1n, closely followed by Zebra; PurePKG is "essentially a new wrapper" for Sileo — [iDownloadBlog, Sileo 2.5.1](https://www.idownloadblog.com/?p=1015248), [iDownloadBlog, PurePKG 2.0.2](https://www.idownloadblog.com/?p=1006176)
- Past Sileo bug classes fixed in updates: dpkg lock errors, local installs, "cannot find archive", purchases and downgrades — [iDownloadBlog, Sileo 2.2.6](https://www.idownloadblog.com/?p=879709); "Unable to fetch some archives" when installing openssh — [Sileo #151](https://github.com/Sileo/Sileo/issues/151)
- Users get confused by firmware/dependency errors on new jailbreaks and post on r/jailbreak for help (linked from the issue) — [Sileo #255](https://github.com/Sileo/Sileo/issues/255)
- Purchasing problems: Sileo crashes on purchase and on signing out of Chariz (2020) — [Sileo #69](https://github.com/Sileo/Sileo/issues/69), [Sileo #57](https://github.com/Sileo/Sileo/issues/57); Cydia Store purchasing shut down in Dec 2018 — [TechCrunch](https://techcrunch.com/2018/12/15/cydia-shuts-down-purchasing-mechanism-for-its-jailbreak-app-store/amp/)

### Inferences
- From the GitHub evidence, the complaints listed in the brief that have direct support are: crashes (Zebra 154 crash issues), dependency confusion, slow or broken refresh with many repos, refresh/expiry limits (sideloaders), and losing setup on reinstall (backup asks). "Ads" and "piracy repos" had no evidence in what I could reach; the LiveContainer scam issue (#926) is the nearest sign of trust problems with third-party stores.

### Gaps
- No readable r/jailbreak, r/LegacyJailbreak or r/sideloaded threads with scores. Reddit blocks the fetch tool; redlib mirrors returned bot challenges; Arctic Shift timed out. A person with a browser should check: r/jailbreak search "Sileo vs Zebra", r/LegacyJailbreak "miss Cydia", r/sideloaded "SideStore annoyances".
- No App Store-style reviews exist for these apps (not on the App Store); none found on third-party review sites.

## "Cydia vs Sileo vs Zebra": what makes people prefer one

### Takeaway
I found no reliable, citable 2023-2026 opinion threads; web search returned directory pages only. What can be cited is market position (Sileo default and dominant, Zebra second) and the Cydia behaviours users asked Zebra to copy.

### Cited Findings
- Sileo is the preferred manager on Dopamine and palera1n, "closely followed by Zebra" — [iDownloadBlog](https://www.idownloadblog.com/?p=1015248)
- Zebra users asked for Cydia-like queue indicators ("I believe Cydia does this"), opening `cydia://` URLs, and a changes tab — [Zebra #1892](https://github.com/zbrateam/Zebra/issues/1892), [Zebra #919](https://github.com/zbrateam/Zebra/issues/919), [Zebra #25](https://github.com/zbrateam/Zebra/issues/25)
- Directory sites recommend Zebra or Cydia for speed on older devices and broad legacy compatibility (generic listing claims, low quality) — [AlternativeTo: Sileo](https://alternativeto.net/software/sileo), [sileo2.com (vendor-ish, not neutral)](https://sileo2.com/best-sileo-alternatives/)
- Cydia ran on 22.8 million devices in a two-month window around the iOS 6 evasi0n jailbreak (2013) — [TechCrunch](https://techcrunch.com/?p=750106)

### Inferences
- (Uncited, from general knowledge of the scene, verify before relying on it) Common folk reasons: Sileo for native depictions and being the default; Zebra for speed and a lighter, more Cydia-like layout; Cydia for familiarity and its Changes/Sections/Manage tabs. Cydia complaints were slowness of "Reloading Data" and the loading of web depictions.

### Gaps
- No vote-counted comparison threads retrieved; see Reddit gap above.

## Wishlists ("what I want in a package manager")

### Takeaway
No standalone wishlist posts were reachable; the closest are multi-item GitHub requests (Zebra #1892, Sileo #249, Feather roadmap #26).

### Cited Findings
- Zebra wishlist: keyboard shortcuts, queued indicators, filter installed packages, user-friendly changelog, Shortcuts integration — [Zebra #1892](https://github.com/zbrateam/Zebra/issues/1892)
- Sileo wishlist: iOS-version filter in search, reviews/comments per package — [Sileo #249](https://github.com/Sileo/Sileo/issues/249)
- Feather roadmap: warn on expired/revoked certificate, web page to install onto other devices, localisation — [Feather #26](https://github.com/claration/feather/issues/26)

### Inferences
- A Cydian wishlist built from the evidence: (1) iOS/arch compatibility badge and filter on every package; (2) human-readable dependency errors with "what to do"; (3) global search plus Sources search and filters; (4) Cydia Changes tab, Upgrade All, visible queue; (5) export/import sources and installed list as text; (6) tolerate hundreds of repos and mark dead ones; (7) expiry/refresh alerts for sideloaded apps (web push, Shortcuts) since sign-in breakage dominates 2026 sideloader trackers; (8) per-app size, date updated, source shown; (9) Shortcuts actions.

### Gaps
- No Twitter/X or Mastodon posts were checked.
