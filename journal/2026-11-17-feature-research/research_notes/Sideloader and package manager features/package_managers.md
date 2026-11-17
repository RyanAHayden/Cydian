# Jailbreak package managers, late 2026: who is current and what they do

Researched 2026-11-17. GitHub activity and release data were pulled live with `gh api` on that date. Links to the repos are given as sources. Anything older than 2025 is marked **(older)**.

## Which managers are current, and which jailbreaks bundle them?

### Takeaway
Two managers are active in late 2026. **Zebra** (v1 line) got its first release in three years, built for Dopamine 3.0 and iOS 26, and is being committed to daily. **Saily, now renamed Irisin** (Lakr233), ships releases weekly. **Sileo** is still the default almost everywhere, but it has had no release since 2.5.1 (Oct 2024) and no commit since Dec 2025, so it is effectively dormant. **Zebra 2** is dead: its branch stopped in July 2021. PurePKG has been idle since 2024. "Cydia rootless" survives only as hobby forks. Dopamine 3.0, the first public iOS 26 jailbreak (7 Aug 2026), bundles Sileo and Zebra.

### Cited Findings
**Jailbreaks (context)**
- Dopamine 3.0 was released 2026-08-07. It adds:
  - the Titan PPL/SPTM bypass, which supports all devices on 16.5.1–17.3.1;
  - the momentarius bypass, which supports A12/A13 on 16.6–18.7.1 and 26.0–26.0.1;
  - "support for SPTM devices up to 27.0 betas in general", though in practice only up to 17.3.1 on real devices, because there is no SPTM bypass for 17.4 and later.
  
  The latest release is 3.0.13 (2026-11-03). Releases 3.0–3.0.6 had a kernel panic bug that could corrupt `/var/jb/basebin/gen/dyld.old`, so 3.0.7 or later is recommended. — [opa334/Dopamine releases](https://github.com/opa334/Dopamine/releases/tag/3.0)
- The Apple Wiki lists Dopamine support as A12/A13 devices on 15.0–18.7.1 and 26.0–26.0.1. — [The Apple Wiki: Dopamine](https://theapplewiki.com/wiki/Dopamine)
- There is no jailbreak for iOS 26.1 or later as of Aug 2026 (third-party guide). — [appshunter (via search snippet)](https://appshunter.io/blog/ios-26-jailbreak-dopamine-3)
- palera1n: v2.4 (2026-07-27) adds tvOS 18.2+ rootful. v3.0.0-beta.3 (2026-10-18) adds a Linux AppImage GUI. — [palera1n releases](https://github.com/palera1n/palera1n/releases)

**Which managers are bundled**
- The palera1n homepage lists both Sileo and Zebra as its package managers. — [palera.in](https://palera.in/) (via search summary)
- Dopamine bundles Sileo and Zebra, and has done so since v1.1.6 **(older, 2023)**. A third-party page says Dopamine 3.0 still ships with both. — [iDB: Dopamine 1.1.6](https://www.idownloadblog.com/?p=965743); [The Apple Wiki](https://www.theapplewiki.com/wiki/Dopamine)
- Zebra v1.1.37 was "initially being released exclusively with Dopamine 3.0. It will be more broadly released for other jailbreaks soon." — [Zebra v1.1.37 release](https://github.com/zbrateam/Zebra/releases/tag/v1.1.37)
- ios.cfw.guide says Sileo is installed by default on Dopamine, Electra, Chimera, Odyssey, Taurine, Odysseyra1n, palera1n and **nathanlr**. — [ios.cfw.guide package managers](https://ios.cfw.guide/package-managers/)

**State of each manager**
- **Sileo**:
  - Last release 2.5.1 (2024-10-08). Last push 2025-12-08.
  - The last commit on main (2024-10-08) only added the Apex and Amethyst jailbreaks.
  - The README footer reads "Sileo Team 2018 - 2023". It has 1.47k stars.
  
  — [Sileo/Sileo](https://github.com/Sileo/Sileo) (gh api)
- **Zebra v1**:
  - v1.1.37 (2026-08-07) followed v1.1.36 (2023-09-10).
  - It has dozens of commits from 1–15 Nov 2026: db fixes for lowercase depends/conflicts and `Provides`, serial console queue, URL scheme handling, Wi-Fi fixes for China-model devices, iOS 9 sqlite compatibility.
  - The README still says "iOS 9 up to iOS 14", which is stale.
  
  — [zbrateam/Zebra commits](https://github.com/zbrateam/Zebra/commits/v1)
- **Zebra 2**: the last commit on the `2.0` branch was 2021-07-02. The only builds were 2.0 alphas. iDB once reported a ground-up redesign with an iPad sidebar **(older)**. Other branches (`epic-redesign`, `new-relaunch`, `tale/apt-json-parser`) exist, but the new work is landing on v1. — [Zebra branches](https://github.com/zbrateam/Zebra/branches); [iDB on Zebra 2](https://www.idownloadblog.com/?p=932323)
- **Saily is now Irisin**: `Lakr233/Saily` redirects to `Lakr233/Irisin`. It released v5.1.6, 5.1.7 and 5.1.8 between 3 and 10 Nov 2026, and its README describes it as a manager for iOS/iPadOS 15+ on rootless (Dopamine) and roothide. — [Lakr233/Irisin](https://github.com/Lakr233/Irisin)
- **PurePKG** (lrdsnow):
  - v1.0 shipped 2024-04-03. The last release was 2.0.2 (2024-07-24), and the last push was 2024-09.
  - It is SwiftUI on top of Sileo's APT wrapper and runs on iOS, tvOS, macOS, watchOS and visionOS.
  - iDB found .deb install failures, repo loading problems and refresh errors at 1.0.
  - It is used mainly on tvOS under palera1n, "due to no other proper package managers existing for rootless".
  
  — [iDB: PurePKG 1.0](https://www.idownloadblog.com/?p=992183); [ios.cfw.guide](https://ios.cfw.guide/package-managers/); gh api
- **Cydia**: ios.cfw.guide says it was revived for modern iOS by Sam Bingner and that saurik stopped maintaining it. On GitHub, rootless forks are hobby-level: espero-dev/cydia-rootless (2023), MWRevamped/Cydia (2024), TequilaDash/Cydia_rootless-fork (pushed 2026-08). None is bundled by a current jailbreak. — [ios.cfw.guide](https://ios.cfw.guide/package-managers/); GitHub search via gh
- **Installer 5** (AppTapp Team) was publicly released in 2019 with "dozens of customization options" **(older)**. — [ios.cfw.guide](https://ios.cfw.guide/package-managers/)

### Inferences
- The real competition on Dopamine 3 / iOS 15–26 is **Zebra 1.1.37+ and Sileo 2.5.1**, which are bundled, plus **Irisin**, the most actively developed. Sileo being dormant leaves an opening for a well-maintained manager.
- The Zebra and Irisin commit messages show agent co-authorship ("Co-Authored-By: Claude Opus 5.5"). Both are moving fast, so expect their feature sets to keep changing.
- No rootless Cydia is mainstream. Cydian would be the only Cydia-look manager with modern rootless support.

### Gaps
- Whether palera1n's loader app still offers Sileo/Zebra as install choices in 2026. I could not fetch palera.in directly.
- What nathanlr bundles as of 2026. The only source is ios.cfw.guide, which is undated.
- Installer 5's status in 2025–2026: I found no source for rootless or iOS 26 support.
- I found no new manager launched in 2025–2026 other than the Saily-to-Irisin rename. The GitHub search for "package manager jailbreak rootless" returned nothing recent.

## Feature-by-feature inventory

### Takeaway
Sileo sets the repo-side standards: native JSON depictions, `sileo-featured.json` banners, and the Payment Provider API. Every modern manager has to render these. Zebra 1.1.37 adds a Liquid Glass UI, Handoff, partial `Provides:` support, a userspace-reboot check and malware removal. Irisin's distinctive features are repo list export/import, install-any-version, update blocking, author search, a bootstrap-install mode and in-app self-update. Canister (api.canister.me v2) is live and gives remote, cross-repo package search.

### Cited Findings
**Repo-side standards that Sileo defines** (Cydian must render these):
- **Native depictions**:
  - The repo adds a `SileoDepiction` field to the Packages entry, and it takes priority over `Depiction`.
  - The root is a `DepictionTabView` with `minVersion` `0.4`, `tabs`, and optional `headerImage`, `tintColor` and `backgroundColor`.
  - Each tab is a `DepictionStackView`. There are also `DepictionAutoStackView` and `DepictionLayerView`.
  - Views: Header, Subheader, Label, Markdown, Image, Video (autoplay only on whitelisted repos), Screenshots, TableText, TableButton (a `depiction-` URL prefix opens another native depiction), Button, Separator, Spacer, Rating, Review.
  - AdMob was removed in Sileo 2.1.
  
  — [Sileo dev: Native Depictions](https://developer.getsileo.app/native-depictions)
- **Featured banners**:
  - `sileo-featured.json` sits at the repo root and holds a `FeaturedBannersView` with `itemSize` (recommended `{263, 148}`), `itemCornerRadius` (recommended 10), and `banners[]` entries of `{url, title, package, hideShadow}`.
  - Images are 16:9 (1920×1080). Banners with text in them can't be featured on Sileo's main page.
  - Each repo shows its banner in the Sources tab.
  
  — [Sileo dev: Featured](https://developer.getsileo.app/sileo-featured)
- **Payment Provider API** (the spec says it is "under heavy development"):
  - Discovery: `GET <repo>/payment_endpoint` returns the vendor's HTTPS base URL.
  - Endpoints: `GET /info` (name, icon, `authentication_banner`) and `GET /authenticate?udid&model`. The latter runs in a Safari auth session and calls back to `sileo://authentication_success?token&payment_secret`.
  - The `payment_secret` is kept in the Keychain behind passcode, Touch ID or Face ID.
  - More endpoints: `POST /user_info` (returns owned item IDs and the user), `POST /sign_out`, and `POST /package/:id/info` (price, purchased, available). That last one is sent only for packages tagged `cydia::commercial`.
  - `POST /package/:id/purchase` returns status 0 (success), 1 (open the returned URL, finishing at `sileo://payment_completed`) or -1 (failure).
  - `POST /package/:id/authorize_download` returns a one-time HTTPS URL that expires in about 1–2 minutes.
  - Error responses use `error`, `recovery_url` and `invalidate`.
  
  — [Sileo dev: Payment Providers](https://developer.getsileo.app/payment-providers)
- Irisin also supports "Buy paid packages and sign in to your vendor accounts", so it implements the same vendor API. Chariz and Havoc are the vendors that use it. — [Irisin README](https://github.com/Lakr233/Irisin)

**Remote search (Canister)**:
- `https://api.canister.me/v2/jailbreak/package/search?q=…&limit=…` was live on 2026-11-17 and returned paged JSON (`refs.nextPage`).
- Each result has these fields: `package_id`, `latest_version`, `visible`, `quality`, `repository_id`, `price`, `version`, `architecture`, `package_filename`, `package_size`, `sha256_hash`, `name`, `description`, `author`, `maintainer`, `depiction`, `native_depiction`, `sileo_depiction`, and more.
  
  — live curl of [api.canister.me](https://api.canister.me/v2/jailbreak/package/search?q=filza)
- Canister's GitHub org: `cnstr/api` (v2, pushed 2025-03) and `cnstr/manifests`, an "Authoritative list of classified repositories" (pushed 2026-11-01). The old indexer `abby` was decommissioned and archived. — [github.com/cnstr](https://github.com/cnstr)
- Sileo 2.2 added Canister support on the featured page **(older)**. Sileo credits Aarnav as "Canister Developer/Maintainer". — [iClarified: Sileo 2.2 beta](https://www.iclarified.com/82098/sileo-22-public-beta-released-with-support-for-all-jailbreaks); [Sileo README](https://github.com/Sileo/Sileo)

**Sileo** (app):
- Swift. "fast performance, and general QOL improvements", proper iPad support. — [ios.cfw.guide](https://ios.cfw.guide/package-managers/)
- Supports iOS 11+ (repo About). Only jailbreak-support patches since 2023. — [Sileo/Sileo](https://github.com/Sileo/Sileo)

**Zebra 1.1.37** (Aug 2026) and Zebra in general:
- Supports Liquid Glass on iOS 26 and uses inset boxes on iOS 13+. On iOS 15+ the **queue is a modern popup sheet**. Icons are shown at the highest Retina resolution.
- Detects new jailbreaks: Amethyst, Apex, EverPwnage, EverUntether, Iocaste. Detects more reliably whether a **"soft" (userspace) reboot** is supported.
- **Handoff**: a package open on one jailbroken device can be opened on another device on the same iCloud account. On a non-jailbroken device it opens the package in Safari.
- **Partial `Provides:` support**.
- **Detects and removes malware** that a defunct piracy repo bundled in packages.
- The ModMyi repo now points to saurik's archive.
- Fixes the **featured packages carousel** when set to "Random", fixes depictions not loading on iOS 16+, and fixes a crash at startup on iOS 18.
  
  — [Zebra v1.1.37](https://github.com/zbrateam/Zebra/releases/tag/v1.1.37)
- Imports repositories from Cydia, Sileo and Installer with one tap. The UI is familiar to Cydia users. It is open source. — [onejailbreak (search summary)](https://onejailbreak.com/blog/zebra/); [ios.cfw.guide](https://ios.cfw.guide/package-managers/)
- Recent commits show Zebra has a **console** (command resolution, serial queue), honours a **"0" price** given as a string, has its own Packages parser ("parsel") on **SQLite**, and is hardening its **URL scheme** handling. — [Zebra commits](https://github.com/zbrateam/Zebra/commits/v1)

**Irisin (formerly Saily)**, v5.1.8 (Nov 2026):
- iPhone and iPad layouts. A welcome page on first launch with **recommended repos for your jailbreak**.
- Add a repo from a link, and **export/import the repo list** to move it between devices.
- **Search across packages, repos and authors**, and every package list has its own search bar.
- Package pages follow light and dark mode.
- **Install any version a repo offers** (a downgrade/version picker) and **block updates** per package (hold).
- Paid packages with vendor sign-in.
- Settings can **rebuild icons** (uicache) and **reload the Home Screen**.
- **Self-update** from inside the app. 19 languages. MIT license.
- Checks the architecture at launch (roothide `iphoneos-arm64e` vs rootless `iphoneos-arm64`) and refuses to run the wrong build.
- **Bootstrap Install**: long-press Execute to extract every package first and then run the configure sequence, which solves the bash/debianutils chicken-and-egg problem. It warns if dpkg is missing.
- **View Logs** in Settings for crash and failure reports.
- Repacks packages to zstd (5.1.7).
  
  — [Irisin README](https://github.com/Lakr233/Irisin); [commits](https://github.com/Lakr233/Irisin/commits)

**Installer 5**: "updated modern design with dozens of customization options" **(older)**. — [ios.cfw.guide](https://ios.cfw.guide/package-managers/)

**PurePKG**: "customization-focused", SwiftUI, multi-platform including tvOS. TrollStore `.tipa` build. Built on Sileo's APT wrapper. — [iDB](https://www.idownloadblog.com/?p=992183)

### Inferences
- Minimum compatibility bar for Cydian:
  - render `SileoDepiction` JSON natively and fall back to the web `Depiction`;
  - show `sileo-featured.json` banners per repo;
  - implement the Payment Provider API, which needs a `sileo://`-style callback, so the native app needs its own URL scheme and the website needs a web redirect equivalent;
  - honour `cydia::commercial`;
  - query Canister for global search on the public site, which can proxy it through the SSRF-safe fetch.
- Competitive features to match: a queue sheet, version picker plus hold (Irisin), repo export/import and one-tap import from other managers (Zebra/Irisin), author search, a userspace-reboot vs respring choice (Zebra), self-update, logs, and recommended repos per jailbreak.
- Features to beat: Handoff (Zebra) points to a cross-device opportunity that fits Cydian's website and app pairing. A web page URL can open the same package in the app.
- Malware detection (Zebra) and Canister's `manifests` repo classification suggest a "repo safety" signal is now expected. Cydian could show Canister's classification when a user adds a repo.

### Gaps
- I could not cite sources for these items on the list: wishlist, installed-list backup/restore, iCloud settings sync, news tab, and author pages in Sileo or Zebra. I believe Sileo has a wishlist and a news/featured page, and Zebra has a wishlist, but I did not verify this in this session.
- I did not verify the URL schemes `sileo://source/…`, `zbra://sources/add/…` or `cydia://url/https://cydia.saurik.com/api/share#?source=…` from a primary doc. Only `sileo://authentication_success` and `sileo://payment_completed` are confirmed above.
- I found no confirmed per-manager docs on dependency resolution or conflict-handling UI.
- I did not open the Chariz and Havoc vendor docs. Their APIs are assumed to equal the Sileo Payment Provider API, based on Sileo's spec.
- I found no source for Canister repo-search or safety endpoints beyond package search. The `cnstr/api` source would list them.

## Performance tricks (refresh speed, partial updates, diffs)

### Takeaway
I found little public documentation. Zebra parses Packages files into SQLite with its own parser and is still fixing that path in Nov 2026. Irisin repacks packages to zstd. APT's standard PDiff (`Packages.diff/Index`) and conditional HTTP requests are the known techniques, but I found no source confirming that any iOS manager uses PDiff.

### Cited Findings
- Zebra commits from Nov 2026: "fix(parsel): Fix iOS 9 sqlite incompatible syntax", "feat(package): Unify logic between parsel and -[ZBPackage initFromDeb:]", "fix(db): Fix potential double queueing", "fix(db): Always normalise package ids to lowercase". — [Zebra commits](https://github.com/zbrateam/Zebra/commits/v1)
- The Zebra repo has a `tale/apt-json-parser` branch, which suggests a JSON/APT parser rework was tried. — [Zebra branches](https://github.com/zbrateam/Zebra/branches)
- Irisin: "Repack to zstd" (2026-11-07). — [Irisin commits](https://github.com/Lakr233/Irisin/commits)
- PurePKG 1.0 had refresh errors and repo loading problems. — [iDB](https://www.idownloadblog.com/?p=992183)

### Inferences
- Cydian already parses in a Web Worker and virtualises long lists. Two more steps would help: send conditional GETs (`If-Modified-Since`/ETag) per repo, and prefer Release-hash checks before downloading Packages. Either would likely beat Zebra and Sileo for perceived refresh speed. These are unverified suggestions, not observed practice.

### Gaps
- I found no benchmarks comparing refresh times between Sileo, Zebra and Irisin.
- I found no evidence of PDiff support in any iOS manager.
- **User sentiment** (what users praise or hate): I could not find usable r/jailbreak threads in this session, because the searches returned off-topic results. Two cited points:
  - PurePKG's early reliability problems ([iDB](https://www.idownloadblog.com/?p=992183)).
  - Sileo's long gap between releases (gh data), which is an inference that users would feel it, not a cited complaint.
  
  A follow-up should search Reddit directly, for example `site:reddit.com/r/jailbreak sileo zebra 2026`.
