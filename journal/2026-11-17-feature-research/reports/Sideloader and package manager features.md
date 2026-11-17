# Answer compatibility, safety and sources across formats

Cydian already plans most of what users loudly ask jailbreak package managers for, because Cydia did it first: a Changes tab, a visible queue, Upgrade All, ignored (held) upgrades and Downgrade. The competition has also left gaps open. On jailbreak trackers the most repeated asks are "will this work on my iOS and jailbreak?", "why did this fail to install?", search across everything, and "back up my sources". None of the current managers answers the first two well. Sileo, still the default on Dopamine and palera1n, has had no release since October 2024. Zebra (revived August 2026) and Irisin (formerly Saily, weekly releases) are moving fast and set the bar: a version picker and hold, repo list export and import, author search, logs, self-update and paid-package sign-in. On the sideloading side, AltStore's source JSON is the one format nearly every tool reads. Its spec carries news with push flags, permission lists, `minOSVersion` and version histories that a viewer can show for free. In 2026 sideloader trackers are dominated by Apple sign-in and refresh breakage, which argues for staying clear of Apple-ID signing. Nobody offers per-user update tracking and push across both APT repos and AltStore sources. That niche belongs to Cydian's website. The must-haves Cydian lacks today: a compatibility badge and filter, human-readable dependency errors, sources export and import on the site, an "Open in" handoff row for every sideloader scheme, and honouring `minOSVersion`. The full prioritised list is at the end.

## Two active rivals and a dormant default set the bar

The jailbreak manager field in late 2026 is small. Dopamine 3.0, the first public iOS 26 jailbreak, shipped on 7 August 2026 and bundles Sileo and Zebra ([Dopamine releases](https://github.com/opa334/Dopamine/releases/tag/3.0); [Zebra v1.1.37](https://github.com/zbrateam/Zebra/releases/tag/v1.1.37)). **Sileo's last release is 2.5.1 from October 2024**, and its last commit on main only added two jailbreaks to the detection list ([Sileo/Sileo](https://github.com/Sileo/Sileo)). Even so, it is still "effectively the dominant package manager app" ([iDownloadBlog](https://www.idownloadblog.com/?p=1015248)). Sileo's lasting influence is on the repo side, and Cydian has to render what it defined: `SileoDepiction` native JSON depictions ([Sileo dev](https://developer.getsileo.app/native-depictions)), per-repo `sileo-featured.json` banners ([Sileo dev](https://developer.getsileo.app/sileo-featured)), and the Payment Provider API that Chariz and Havoc use for paid tweaks ([Sileo dev](https://developer.getsileo.app/payment-providers); [Irisin README](https://github.com/Lakr233/Irisin)).

The two active rivals point where the bar is moving. **Zebra 1.1.37** added a Liquid Glass UI, a modern queue sheet, Handoff of an open package to another device on the same iCloud account, partial `Provides:` support, more reliable userspace-reboot detection, and removal of malware that a defunct piracy repo had bundled ([Zebra v1.1.37](https://github.com/zbrateam/Zebra/releases/tag/v1.1.37)). It has also been committed to daily through November 2026 ([Zebra commits](https://github.com/zbrateam/Zebra/commits/v1)). **Irisin** released three versions in one week in November 2026. Its feature list is the most complete current one ([Irisin README](https://github.com/Lakr233/Irisin)):

- recommended repos for your jailbreak on first launch;
- repo list export and import;
- search across packages, repos and authors;
- install any version a repo offers, and block updates per package;
- vendor sign-in for paid packages;
- uicache and Home Screen reload;
- in-app self-update and a logs viewer;
- a "Bootstrap Install" mode for the bash and debianutils chicken-and-egg problem.

No mainstream rootless Cydia exists. The forks on GitHub are hobby projects, and no current jailbreak bundles one ([ios.cfw.guide](https://ios.cfw.guide/package-managers/)). Cydian would be the only Cydia-look manager with modern rootless support.

There is one caveat about what users prefer. Reddit could not be read in this research, and the common folk reasons are uncited in the notes: Sileo for native depictions and being the default, Zebra for speed and a Cydia-like layout, Cydia for familiarity. They are general knowledge, so treat them as unverified. The citable signal is that Zebra users explicitly asked for Cydia behaviours: queued indicators ("I believe Cydia does this"), opening `cydia://` URLs, and a Changes tab ([Zebra #1892](https://github.com/zbrateam/Zebra/issues/1892); [Zebra #919](https://github.com/zbrateam/Zebra/issues/919); [Zebra #25](https://github.com/zbrateam/Zebra/issues/25)).

## Jailbreak users ask "will it work, and why did it fail"

Jailbreak tracker reaction counts are tiny (single digits). Rankings there rest on duplicates and keyword counts, so read them as direction, not magnitude. Within that limit the themes are consistent.

**Compatibility.** Users want to filter by iOS version because "it's hard to find compatible tweaks" ([Sileo #249](https://github.com/Sileo/Sileo/issues/249)). There is a 17-comment thread asking for an iOS compatibility check in native depictions ([Sileo #222](https://github.com/Sileo/Sileo/issues/222)) and a request for a "Compatible" category ([Sileo #312](https://github.com/Sileo/Sileo/issues/312)). The crowd-sourced answer, TweakCompatible, survives only as a SourceForge mirror ([SourceForge](https://sourceforge.net/projects/tweakcompatible.mirror/)). iOS Repo Updates, the largest public index with **347 repos and 77,175 packages**, has no iOS-version filter ([ios-repo-updates.com](https://www.ios-repo-updates.com/)). Cydian can answer most of this without crowd data, from each package's `Depends: firmware (...)` and its `Architecture` (`iphoneos-arm64` rootless vs `iphoneos-arm` rootful). F4 already plans the architecture filter, but nothing plans the firmware check.

**Install failures.** After iOS 15 jailbreaks, r/jailbreak users hit the `firmware` meta-package error and "were unsure how to proceed due to ... the vagueness of the error Sileo provides" ([Sileo #255](https://github.com/Sileo/Sileo/issues/255)). Zebra has an open "silently fails to install certain packages" issue ([Zebra #2052](https://github.com/zbrateam/Zebra/issues/2052)) and 29 issues with "dependency" in the title ([Zebra issues](https://github.com/zbrateam/Zebra/issues)). N4's Confirm sheet runs `apt-get -s`. Turning apt's resolver output into "X needs Y, which no source you have provides; add repo Z or skip" would beat every current manager.

**Search, scale and dead repos.** Zebra has 56 issues with "search" in the title and asks to search the Sources tab ([Zebra #1940](https://github.com/zbrateam/Zebra/issues/1940)). Adding many repos breaks it: "it no longer downloads the content of repos and the links become red" ([Zebra #1965](https://github.com/zbrateam/Zebra/issues/1965)). Users want repos that are down shown as down ([Zebra #1764](https://github.com/zbrateam/Zebra/issues/1764)) and a configurable timeout ([Zebra #1266](https://github.com/zbrateam/Zebra/issues/1266)). Canister's v2 API gives remote cross-repo search, and it was live on 17 November 2026 with paged results that include `sileo_depiction` and `sha256_hash` ([api.canister.me](https://api.canister.me/v2/jailbreak/package/search?q=filza)). Its other endpoints and its terms of use are **unverified**: the docs site renders client-side and the old docs URL returns 404.

**Backup and persistence.** Keeping sources in a plain-text file that survives a reinstall is asked for in three separate apps: [Sileo #264](https://github.com/Sileo/Sileo/issues/264), [SideStore #1060](https://github.com/SideStore/SideStore/issues/1060) ("store sources in plain text in the user accessible folder"), and [Feather #183](https://github.com/claration/feather/issues/183), where a tweak wiped app data "with no easy way to restore". N8 plans Export/Restore My Packages in the app. The website has no equivalent yet, and it is the one place that survives a re-jailbreak or a phone change.

**Repo safety.** Sileo shows a "Dangerous Repo" pop-up for flagged repos, and Cydia showed a "Source Warning". Zebra showed none in iDB's June 2024 test ([iDB](https://www.idownloadblog.com/2024/06/26/sileo-dangerous-repo/)). Sileo's flagged list is not published, and its API repo was archived in December 2022 ([FlaggedRepoAPI](https://github.com/Sileo/FlaggedRepoAPI)), so whether the live endpoint still answers is **unverified**. AltStore Classic 2.0 blocks malicious sources remotely ([AltStore notes](https://faq.altstore.io/release-notes/altstore)). Canister's `cnstr/manifests` repo calls itself an "authoritative list of classified repositories" and was updated on 1 November 2026 ([github.com/cnstr](https://github.com/cnstr)). It is the most plausible open data source for a safety signal, but its schema is unread.

One gap sits in Cydian's own plan. Cydia lists "Ignored Upgrades" as **packages on hold** (docs/cydia.md, Changes), and F13 plans "Ignore upgrades per package". But N2's helper allowlist (`update|install|remove|upgrade`, `dpkg --configure -a`) has no `apt-mark hold`. An ignore that lives only in Cydian's settings would be overridden by N7's unattended upgrade or by any other manager's Upgrade All. The hold should be written to dpkg.

## AltStore's source format is the sideloading lingua franca

**Feather, SideStore, LiveContainer and KSign all read AltStore-style source JSON**, so supporting that format (F9) covers nearly the whole sideloading catalogue ([Feather](https://github.com/khcrysalis/Feather); [LiveContainer](https://github.com/LiveContainer/LiveContainer); [iDeviceCentral on KSign](https://idevicecentral.com/ios-guide/ksign-ipa-installer-for-ios-the-free-code-signing-app-you-should-try-in-2025/)). The spec carries more than F9 currently parses ([AltStore: Make a Source](https://faq.altstore.io/developers/make-a-source)):

| Field | What it gives Cydian |
|---|---|
| `news[]` with `notify: true` | A source news feed. A `notify` item is meant to be pushed, which fits Web Push and the IPA's local notifications. |
| `versions[]` with `localizedDescription`, `date`, `size`, `sha256` | Version history, a "what's new" changelog, size and integrity checks. The first entry is the latest. |
| `minOSVersion`, `maxOSVersion` | Hides updates the phone can't install. AltStore uses them that way. |
| `appPermissions` (entitlements plus privacy strings) | A permissions review before install. AltStore refuses installs that don't match. |
| `featuredApps`, `headerURL`, `tintColor`, `iconURL` | A themed source page, plus a preview before adding (AltStore 2.0 shows Featured Apps before you add a source). |
| `category`, `screenshots` (split by iPhone and iPad) | Sections and package-page screenshots, which map onto Cydia's Sections. |
| `patreon` | A price or "supporter" badge only. In-app pledging is out of scope. |

AltStore Classic 2.2 and PAL 2.2 added localized titles and descriptions ([AltStore notes](https://faq.altstore.io/release-notes/altstore)). Classic 2.3 sends an `ALT_CLASSIC_VER` header on every source fetch, so a source can tell clients apart.

**Discovery is fragmented, and no tool spans both formats.** AltStore has Trusted Sources ([FAQ](https://faq.altstore.io/altstore-classic/trusted-sources)). PAL 2.3 has Popular, Indie Gems and Fediverse Favorites collections and the explore.alt.store directory ([PAL notes](https://faq.altstore.io/release-notes/altstore-pal)). Community lists fill the rest ([awesome-altstore](https://github.com/victordedomenico/awesome-altstore)). Client-only source viewers such as altsource-viewer **fail on hosts without CORS headers** ([altsource-viewer](https://github.com/therealFoxster/altsource-viewer)). Cydian's SSRF-safe proxy removes that limit, and the site should say so.

**Deep links are the cheapest high-value feature.** AltDirect is a static "open this source in…" page. It documents the add-source schemes as `altstore-classic://source?url=`, `sidestore://source?url=`, `feather://source/<url>`, `livecontainer://source?url=`, `stikstore://add-source?url=` and `trollapps://add?url=`. It also warns that `&` in a URL breaks some clients ([StikDebug/altdirect](https://github.com/StikDebug/altdirect)). AltStore itself documents `altstore://source?url=` and a web form at `altstore.io/source/<URL>` ([Trusted Sources](https://faq.altstore.io/how-to-use-altstore/trusted-sources)). F8 and F9 plan the APT manager schemes and AltStore, SideStore and Feather. They should take the full set above. Two flags apply. The APT schemes F8 plans (`sileo://source/…`, `zbra://sources/add/…`, the `cydia://url/…api/share#?source=` form) were **not verified from primary docs** in this research. And one third-party page says SideStore adds sources only by hand, which contradicts AltDirect. That page is probably out of date.

## Sideloader pain is Apple breakage, editing and metadata

The 2026 sideloader trackers are dominated by Apple's side breaking sign-in and refresh:

- AltStore error -80045 (**111 reactions**) ([#1828](https://github.com/altstoreio/AltStore/issues/1828));
- iOS 27 "machineID" (84) ([#1751](https://github.com/altstoreio/AltStore/issues/1751));
- HTTP 503 after 2FA (41) ([#1842](https://github.com/altstoreio/AltStore/issues/1842));
- SideStore can't refresh on iOS 26.4 (34 reactions, 85 comments) ([#1174](https://github.com/SideStore/SideStore/issues/1174)).

Users report background refresh that "never worked for me" ([r/apolloapp snippet](https://reddit.birdcat.cafe/r/apolloapp/comments/1k8ej8d/psa_you_can_still_use_apollo/mp8c45e/?context=3), seen as a search snippet only). The free Apple ID limits still apply: 7-day signatures, 3 active apps, and Developer Mode on iOS 16+ ([Scarlet comparison, self-interested](https://scarletios.com/free-sideloading-tools-compared-2026-edition/)). For Cydian, this argues hard for R5's route: sign with the user's own .p12 on the phone, as Feather does, and never handle Apple ID sign-in or anisette servers. The valuable part Cydian can own is the *monitor*: warn before a signature expires (F13 plans a re-sign reminder) and warn when a certificate has been revoked. Revocation warnings are on Feather's own roadmap ([Feather #26](https://github.com/claration/feather/issues/26)).

The feature asks that remain once breakage is set aside cluster into two groups.

**Edit before install.** Users want to change the name, bundle ID and icon, and to strip extensions: [SideStore #780](https://github.com/SideStore/SideStore/issues/780) and [#218](https://github.com/SideStore/SideStore/issues/218), [AltStore #1625](https://github.com/altstoreio/AltStore/issues/1625), and TrollStore's top issue, [#662](https://github.com/opa334/TrollStore/issues/662). Users also ask for entitlement and keychain-group edits ([Feather #424](https://github.com/claration/feather/issues/424), [#271](https://github.com/claration/feather/issues/271)).

**Metadata and source support.** Users want size, date added and updated, which source an app came from, and real progress bars instead of spinners ([LiveContainer #827](https://github.com/LiveContainer/LiveContainer/issues/827), 13 reactions; [Feather #172](https://github.com/claration/feather/issues/172), [#495](https://github.com/claration/feather/issues/495), [#113](https://github.com/claration/feather/issues/113)). LiveContainer users ask for source support at all ([#122](https://github.com/LiveContainer/LiveContainer/issues/122), [#734](https://github.com/LiveContainer/LiveContainer/issues/734)). Cydia's package page already shows size, source and section, and Changes supplies dates. Cydian gets most of this group by keeping Cydia's layout.

Two more signals bear on design. SideStore has an open battery-drain issue about its background activity (14 reactions, September 2026) ([#1624](https://github.com/SideStore/SideStore/issues/1624)). That supports F13 and N7's "only when charging and locked" option and an infrequent default schedule. Shortcuts integration is asked for in both camps ([Zebra #1892](https://github.com/zbrateam/Zebra/issues/1892); [SideStore #905](https://github.com/SideStore/SideStore/issues/905); [LiveContainer #1367](https://github.com/LiveContainer/LiveContainer/issues/1367)), and N8's App Intents already cover it.

## Personal tracking with push is an empty niche

Today's update channels are a firehose: iOS Repo Updates posts every update to Telegram (over 108,000 posts), Discord and Twitter, with no per-user tracking and no web push ([t.me/s/iOSRepoUpdates](https://t.me/s/iOSRepoUpdates/108175); [ios-repo-updates.com](https://www.ios-repo-updates.com/)). The only IFTTT applets cover App Store apps ([IFTTT](https://ifttt.com/applets/ieS4pGt5-send-update-alerts-when-an-app-store-app-releases-a-new-version)). "Track my sources and installed packages, notify me on upgrade", across APT and AltStore together, is unoccupied, and F10 already aims at it. The delivery risks are real. Web push on iOS needs 16.4+ and a Home Screen install, with no install prompt ([MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)). Developers report subscriptions vanishing without cause ([webscraft](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)), but that report is **anecdotal**. The claim that EU users lose home-screen push from iOS 17.4 is **unverified against current behaviour**: Apple partly reversed the change. Building for subscription loss is cheap insurance:

- re-subscribe on each open;
- show "last push delivered" in Settings;
- offer a per-user RSS/Atom feed of "my sources" upgrades. Nobody offers one, and it doubles as a fallback for any feed reader.

Repo health is a second cheap differentiator. Big hosts died (ModMyi and MacCiti in 2017, Dynastic in 2021, Cydia Store purchasing in 2018) ([MacRumors](https://www.macrumors.com/2017/11/23/modmyi-macciti-cydia-repos-shut-down/amp); [iDB](https://www.idownloadblog.com/2021/09/01/dynastic-repo-announces-planned-shutdown-as-alternative-repositories-offer-homes-for-jailbreak-tweaks-add-ons/); [AppleInsider](https://appleinsider.com/articles/18/12/15/jailbreaking-takes-a-hit-as-cydia-app-store-shutters)), yet no surviving site shows when a repo was last reachable or last updated. Cydian's daily job and its proxy cache already see both facts. Conditional GETs (ETag, If-Modified-Since) and checking Release before Packages would likely make refreshes faster than Zebra's or Sileo's. That is an untested inference: no manager's refresh speed has been benchmarked, and no iOS manager is confirmed to use PDiff.

## Conclusion

The research changes Cydian's priorities in one important way. The Cydia behaviours the project treats as its look turn out to be the features users still request from Zebra and Sileo. So the differentiation work lies in two places Cydia never covered. The first is **trust and fit**: compatibility from control fields, plain-language dependency errors, repo health and safety signals, and permissions review. The second is **reach across formats**: one tracker and push channel for both APT repos and AltStore sources, with deep links out to every sideloader. Both are mostly shared `web/app/` core work, so the site and the jailbreak app gain together.

Just as important is what not to build. The biggest pile of sideloader complaints comes from Apple-ID signing breaking, so Cydian should stay with its own-certificate route and be the app that *reports* expiry and revocation, not one that fights Apple's sign-in. The evidence base has limits. Jailbreak tracker counts are in single digits, and Reddit, Discord and SideStore's 119 Discussions were never read. Check the must-have list against r/jailbreak before treating its order as settled.

## Prioritized feature list

Front doors: **Web** = public site (`web/app/` + Flask), **JB** = jailbreak app (native shell + root helper), **IPA** = sideload-mode build (I2-I4) and App Intents and Shortcuts (N8). Because `web/app/` is shared, "Web+JB" means one implementation. "Planned" cites the TODO task that already covers the item.

### Must-have

| Feature | Front door | Status | Evidence |
|---|---|---|---|
| Compatibility badge and filter: iOS version from `Depends: firmware`, rootless/rootful from `Architecture`, "works on my phone" filter in lists and search | Web+JB | Arch filter planned (F4); firmware check **new** | Sileo #249, #222, #312; no index offers it (iOS Repo Updates); TweakCompatible dead |
| Human-readable dependency and install errors with a "what to do" (missing provider, `firmware` meta-package, conflicts); never fail silently | JB (Web: show unmet depends on package page) | **New** (extend N4 Confirm sheet) | Sileo #255; Zebra #2052; 29 Zebra "dependency" issues |
| Cydia's Changes tab, queue indicators, Upgrade All, Downgrade sheet, tappable depends | Web+JB | Planned (F6, F7, N4; Downgrade is in Cydia's Modify sheet, so make sure N4 includes it) | Zebra #25, #1535, #1992, #1892, #1414 |
| Ignore/hold upgrades written to dpkg (`apt-mark hold`), so unattended and other managers respect it | JB (Web: settings-only ignore) | F13 planned; dpkg hold **new** (add to N2 allowlist) | Cydia "Ignored Upgrades = on hold" (docs/cydia.md); Irisin's update block |
| Sources export/import as plain text or URL, plus import of other managers' source lists | Web+JB | App planned (N8 Export/Restore); site text import/export **new** | Sileo #264; SideStore #1060; Feather #183; Zebra and Irisin one-tap import |
| "Open in" handoff row for every scheme: APT managers plus AltStore Classic, SideStore, Feather, LiveContainer, StikStore, TrollApps; a web `/add?url=` page | Web | Planned (F8, F9); extend scheme list | AltDirect scheme list; AltStore `altstore://source?url=`. APT schemes **unverified** |
| Native `SileoDepiction` rendering, HTML depiction fallback | Web+JB | Planned (F5) | Sileo native depiction spec; Zebra fixing depictions on iOS 16+ |
| Honour AltStore `minOSVersion`/`maxOSVersion`: hide and don't notify updates the phone can't install | Web+IPA | **New** (F9 detail) | AltStore Make a Source |
| Per-user upgrade push across APT and AltStore sources, with app badge | Web (JB: N5 daemon) | Planned (F10, N5, I3) | No one offers it; iOS Repo Updates is firehose-only |
| Global search over name, id, description and author, plus search in the Sources tab | Web+JB | Name/id/description planned (F5); author and Sources-tab search **new** | Zebra #1940, 56 "search" issues; Irisin author search |
| Signature expiry reminder for sideloaded IPAs | IPA | Planned (F13 re-sign reminder) | 7-day expiry complaints; Feather #26 |

### Should-have

| Feature | Front door | Status | Evidence |
|---|---|---|---|
| Repo health: last reachable, last Release date, "down" marker, per-repo timeout; tolerate hundreds of repos | Web+JB | **New** | Zebra #1965, #1764, #1266; shutdown history |
| Repo safety warning on add (Cydia-style "Source Warning"), from a curated list or Canister manifests | Web+JB | **New** | Sileo Dangerous Repo; AltStore remote block. Flagged-list sources **unverified** |
| Cross-repo discovery search via Canister through the proxy | Web (JB optional) | **New** | Canister v2 live; endpoints and terms **unverified** |
| Paid packages: Payment Provider API sign-in and purchase (Chariz, Havoc are F4 defaults); price badge on site | JB (Web: price + vendor link) | **New** (`cydia::commercial` noted in docs/cydia.md) | Sileo payment spec; Irisin supports it. Vendor docs not read, so assumed equal to Sileo's |
| `sileo-featured.json` banners on source pages and Home | Web+JB | **New** | Sileo featured spec; Zebra carousel fixes |
| AltStore source extras: news feed (push `notify` items), version history and what's new, screenshots, themed source page, preview before adding | Web+JB+IPA | **New** (beyond F9's parse) | AltStore spec; AltStore 2.0 source preview |
| Permissions and entitlements review before an IPA install | Web+IPA (JB for N9 IPAs) | **New** | AltStore `appPermissions` |
| Certificate revocation check for the user's signing cert | IPA | **New** | Feather #26 roadmap; revocation is the main cert-store pain |
| Edit before sign: name, bundle ID, icon, strip extensions | IPA (N9 sideload route) | **New**, depends on R5 | SideStore #780, #218; AltStore #1625; TrollStore #662 |
| Push resilience: re-subscribe on open, "last push delivered", per-user RSS/Atom feed | Web | **New** (F10 detail) | Anecdotal subscription loss; nobody offers a feed |
| Conditional GETs and Release-first refresh | Web (proxy) + JB | **New**, untested inference | Zebra and PurePKG refresh issues; no benchmarks exist |
| Respring, userspace reboot, uicache from the app and Control Center | JB | Respring and reboot planned (N8); uicache **new** | Zebra soft-reboot detection; Irisin rebuild icons |
| Logs viewer for failed installs and crashes | JB+IPA | Console planned (N4); persistent logs **new** | Irisin View Logs; Zebra's 154 crash issues |
| Recommended sources per jailbreak on first run | Web+JB | Defaults planned (F4); per-jailbreak **new** | Irisin welcome page; AltStore Trusted Sources |
| Open-in-app continuity: a site package URL opens the same page in the app | Web+JB | Partly (app scheme mirrors hash routes, docs/cydia.md) | Zebra Handoff |
| Battery-aware background work | JB+IPA | Planned (F13, N7 "charging and locked") | SideStore #1624 |

### Later

| Feature | Front door | Evidence |
|---|---|---|
| Self-update for the IPA build (JB updates itself through its own apt repo) | IPA | Irisin self-update |
| Malware scan of installed packages against a known-bad list | JB | Zebra 1.1.37 |
| Bootstrap Install mode (extract all, then configure) for broken bootstraps | JB | Irisin |
| iPad layout and keyboard shortcuts (⌘F, ⌘R) | JB | Zebra #1892; Irisin and Sileo iPad support |
| "Worked for me" compatibility votes per package and iOS version | Web | Sileo #249; Zebra #1309. Needs moderation |
| Block authors or packages from lists and updates | Web+JB | Zebra #1037, #998 |
| Tweak injection into the user's own IPAs | IPA | Feather, KSign, Sideloadly. Dual-use: offer it only for the user's own files, with no IPA library |
| Localisation | all | Irisin 19 languages; TrollStore #68; Feather #26 |

### Skip

| Feature | Why |
|---|---|
| Apple-ID signing, anisette, AltServer-style refresh | The top 2026 complaint pile is Apple breaking it (AltStore #1828, #1751; SideStore #1174). R5's own-cert route avoids it. |
| LiveContainer-style multi-app containers | Different product; workaround for free-account limits Cydian doesn't use. |
| IPA libraries, "modded app" catalogues, shared enterprise certs | Piracy-adjacent (Signulous, AppDB, Scarlet); revocation-prone. |
| Randomize bundle IDs to dodge "profile banned" | Only needed for free-Apple-ID evasion; out of Cydian's route. |
| Patreon pledging and fediverse sign-in and likes | AltStore-specific business features. Show a badge or link only. |
| Ads in depictions | Sileo removed AdMob in 2.1. |

### Claims flagged as unverified in the notes

- The APT add-source schemes (`sileo://source/…`, `zbra://sources/add/…`, `cydia://url/…api/share#?source=`). Sileo and Zebra wishlist and news features.
- Canister's non-search endpoints, terms and rate limits. Whether Sileo's flagged-repo endpoint is still live.
- That Chariz and Havoc implement exactly Sileo's Payment API.
- The EU PWA push status after iOS 17.4, and how reliable push subscriptions are.
- That any manager uses PDiff or conditional GETs. All refresh-speed claims.
- SideStore 0.6.x versions (secondary sites). Whether AltStore 2.x still ships widgets. Whether palera1n and nathanlr still bundle Sileo and Zebra.
- All user-preference ("why people pick Sileo, Zebra or Cydia") and Reddit sentiment. Reddit was unreadable in this research.
