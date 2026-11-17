# Web ecosystem around iOS tweak repos and sideload sources (no device needed)

Researched 2026-11-17. Many sources are dated (2018-2024), and they are marked as such. Several key sites (canister.me,
docs.canister.me) render client-side and returned only a title to the fetcher, so their current feature set is
partly unverified.

## What exists, and what each one offers

### Takeaway
The live web tools today are: **iOS Repo Updates** (the biggest public APT index, ~347 repos and ~77k packages, with
pushes via Telegram, Twitter and Discord but no web push), **Canister** (a search engine plus a public v2 API used by
Sileo, Tweakio and a Reddit bot), **vendor storefronts** (Havoc, Chariz) that can be browsed in Safari, and a scatter of
small **AltStore-source viewers** (altsource-viewer, altsource.by.lao.sb, AltDirect, explore.alt.store). No single site
covers both APT repos and AltStore-style sources. That is the gap Cydian's site fills.

### Cited Findings
**APT / tweak side**
- iOS Repo Updates (ios-repo-updates.com) is live in 2026: footer "2026 ©", featured items include Solid Glass 27
  Rootless 27.1, Frida 17.26.4 and EZCompleteUI 7.2.11. It tracks 347 repositories, 311 sections and 77,175 packages.
  It has a search box and Search page, filters for repo, section and price (All/Free/Paid), popular repos with package
  counts, featured packages, "Latest news", and per-package pages whose URL holds the repo and package identifier. On
  the page there was **no RSS mention, no iOS-version compatibility filter, no repo-health info and no in-site alert
  sign-up**. Notifications go out through Twitter, a Telegram channel and a Discord bot — [ios-repo-updates.com](https://www.ios-repo-updates.com/)
- The iOS Repo Updates Telegram channel posts one message per update: "Updated: <name> <version> [<section>]" plus the
  source repo and architecture, at high volume (post IDs above 108,000) — [t.me/s/iOSRepoUpdates](https://t.me/s/iOSRepoUpdates/108175); [example](https://t.me/s/iOSRepoUpdates/99172)
- Canister is a jailbreak package search engine (API "made by Tale"). Its v2 API has a package-search endpoint: query of
  at least 2 characters, paging, up to 250 results per page — [search summary citing docs.canister.me](https://docs.canister.me/operation/operation-package-search) (that URL now returns 404, so the docs have moved or been restructured); [Tweakio README](https://github.com/SpartacusDev/Tweakio)
- Canister is built into clients: Sileo 2.2 added Canister support on its featured page — [iClarified](https://www.iclarified.com/82098/sileo-22-public-beta-released-with-support-for-all-jailbreaks). Zebra's release notes mention a download fix "due to Canister analytics" — [Zebra releases](https://github.com/wstyres/Zebra/releases). Tweakio (an in-package-manager search tab for Cydia, Installer, Sileo and Zebra) can use the Tweakio, Parcility or Canister APIs as backends. Its author says the Tweakio API is slow and recommends Parcility or Canister — [Tweakio](https://github.com/SpartacusDev/Tweakio). A Reddit bot (CanisterBot) runs on Canister's API (older, about 2.5 years) — [search summary](https://github.com/SpartacusDev/Tweakio)
- Parcility (parcility.co): a website and API for browsing jailbreak repos. A 2021 iDB article lists it next to iOS
  Repo Updates as the place to find repos online — [iDB tag: parcility](https://www.idownloadblog.com/tag/parcility/). **Current status unverified.** I found no 2025-2026 activity, and the only related GitHub project (KennelLive, depiction editor) was last pushed about 5 years ago — [ecosyste.ms parcility topic](https://repos.ecosyste.ms/hosts/GitHub/topics/parcility)
- Havoc's repo can be browsed in a web browser whether or not the device is jailbroken. Purchases get a .deb or .zip
  depending on the device (2021-era article) — [iDB](https://www.idownloadblog.com/?p=922317)
- hekatos/api (jailbreak-detection-bypass query API, `GET /app?search=`) is being archived. Its author points users to
  AppleDB — [hekatos/api](https://github.com/hekatos/api)

**Compatibility / jailbreak guides**
- TweakCompatible: a community crowd-sourced tweak-compatibility project (now a SourceForge mirror). Its iOS 16/17
  coverage is unconfirmed, and it is effectively legacy — [SourceForge mirror](https://sourceforge.net/projects/tweakcompatible.mirror/)
- Today's compatibility info is scattered: per-tweak ranges stated by developers (e.g. "iOS 15.0-17.4 rootless and
  rootful"), blog lists (e.g. iOS 16/16.2 list, Dec 2022), weekly iDB roundups and a community user page on The Apple
  Wiki — [search summary](https://allnewtechnologys.blogspot.com/2022/12/ios-16-162-jailbreak-tweaks.html); [The Apple Wiki user page](https://theapplewiki.com/wiki/User:IAdam1n)
- Jailbreak-tool compatibility (device × iOS → tool): ios.cfw.guide has per-device firmware-selection charts — [ios.cfw.guide iPhone 7](https://ios.cfw.guide/get-started/iPhone-7). AppleDB has per-jailbreak pages — [appledb.dev Odyssey](https://appledb.dev/jailbreak/Odyssey.html). iClarified keeps dated charts (Jul-Oct 2026). These say Dopamine reaches iOS 17.3.1 (A8-A17, M1-M2), there is no public jailbreak for iOS 18 or 26 on XS and newer, and none for A18/A19 — [iClarified](https://www.iclarified.com/jailbreak)
- I found no information on jailbreak.party in search.

**Sideload / AltStore-source side**
- altsource-viewer (therealFoxster): an MIT-licensed static web app. Paste a source URL and browse its apps, hosted on
  GitHub Pages (188 commits, 78 stars). Its known limitation: sources on hosts without CORS headers fail to load (GitHub
  Pages works) — [GitHub](https://github.com/therealFoxster/altsource-viewer)
- altsource.by.lao.sb/browse/ is another paste-a-URL source browser listed in awesome-altstore. Details unverified —
  [awesome-altstore](https://github.com/victordedomenico/awesome-altstore)
- AltStore PAL's official directory, explore.alt.store, is EU-focused — [awesome-altstore](https://github.com/victordedomenico/awesome-altstore)
- AltStore's "trusted sources" and source-format docs — [faq.altstore.io trusted sources](https://faq.altstore.io/how-to-use-altstore/trusted-sources); [Make a Source](https://faq.altstore.io/developers)
- **AltDirect** (moved from CelloSerenity to StikDebug/altdirect) is a static "open this source in…" page. With `?url=`
  it shows Open-in buttons plus Copy/View. `exclude=` hides apps by key, and `&r=<key>` auto-redirects. It trims the URL
  and adds `https://` when missing, and warns that `&` in URLs breaks some clients. The schemes it uses:
  - AltStore Classic `altstore-classic://source?url=<url>`
  - SideStore `sidestore://source?url=<url>`
  - Feather `feather://source/<url>`
  - LiveContainer `livecontainer://source?url=<url>`
  - StikStore `stikstore://add-source?url=<url>`
  - TrollApps `trollapps://add?url=<url>`
  - Notarized AltStore PAL sources should use the `api.altstore.io` endpoint instead.
  — [StikDebug/altdirect](https://github.com/StikDebug/altdirect); [old repo](https://github.com/CelloSerenity/altdirect)
- A third-party page says adding a source in SideStore is done by hand (paste into the source manager). Any
  `{name, identifier, sourceURL, apps[]}` JSON imports — [sidelink](https://gabrielvuksani.github.io/sidelink/official-source) (this contradicts AltDirect's `sidestore://source?url=`, so it is probably out of date)
- Feather has a closed issue #193, "feat: url scheme paths" — [ecosyste.ms issues](https://issues.ecosyste.ms/hosts/GitHub/repositories/khcrysalis%2Ffeather/issues)

**Piracy / malware warnings**
- Sileo shows a "Dangerous Repo" pop-up ("Take me back to safety" / "I accept the risks, continue") for flagged repos,
  mostly piracy and sometimes malware. Reports and appeals go through Sileo's FlaggedRepoAPI GitHub. Cydia showed a
  "Source Warning" (Cancel / Add Anyway). In iDB's test, Zebra showed no warning (June 2024) — [iDB](https://www.idownloadblog.com/2024/06/26/sileo-dangerous-repo/)
- FlaggedRepoAPI: `GET /info` returns `{version, updated, flagged_count}`, and `POST /flagged {"url": ...}` returns
  true/false after stripping the protocol and trailing slash. Production host: flagged-repo-api.getsileo.app. The list
  itself (`config/flagged-repos.json`) is **not published**. The repo was archived on 2022-12-30 — [GitHub](https://github.com/Sileo/FlaggedRepoAPI)

### Inferences
- Deep links are the cheapest high-value feature to copy. Cydian's source pages can show an AltDirect-style "Open in"
  row (the six schemes above), plus `sileo://source/<url>`, `zbra://sources/add/<url>` and `cydia://url/https://cydia.saurik.com/api/share#?source=<url>` for APT. The APT schemes come from memory and are not verified here, so check them.
- Cydian's server-side fetch proxy already solves the CORS failure that limits client-only viewers like altsource-viewer.
  This is a real advantage worth stating on the site.
- iOS Repo Updates owns "global index + firehose", but has no per-user tracking, no web push, no iOS-version filter
  and no AltStore sources. Cydian's "track my sources, notify me on upgrade" is a different and unoccupied niche.
- No public, queryable piracy/malware list exists (Sileo's is private and its API is archived). Cydian would have to
  either call the Sileo endpoint (undocumented on the live host, and it may be gone) or curate its own list.

### Gaps
- canister.me and docs.canister.me render client-side. I could not list the current endpoints (repositories, jailbreak
  info, piracy filtering, rate limits, terms). Check them in a real browser.
- Parcility's 2026 status: is it live or dead? Not confirmed.
- I did not research AppDB, Chariz's web store, IPA-library sites, SideStore/Feather community source lists or
  jailbreak.party (out of tool budget).
- Whether iOS Repo Updates offers RSS: not on its home page, and not confirmed either way.

## Dead/defunct tools and what users miss

### Takeaway
The pattern: crowd-sourced compatibility (TweakCompatible), in-manager search (Tweakio) and repo-safety APIs
(FlaggedRepoAPI) faded or were archived, and big hosts (ModMyi, MacCiti, Dynastic, Cydia Store) shut down. Users still
lack a trustworthy "will this tweak work on my iOS/jailbreak" answer.

### Cited Findings
- ModMyi and ZodTTD/MacCiti repos shut down in Nov 2017 — [MacRumors](https://www.macrumors.com/2017/11/23/modmyi-macciti-cydia-repos-shut-down/amp); [TechCrunch](https://techcrunch.com/2017/11/27/ios-jailbreak-repositories-close-as-user-interest-wanes)
- The Cydia Store stopped purchases in Dec 2018. The repo stayed up — [AppleInsider](https://appleinsider.com/articles/18/12/15/jailbreaking-takes-a-hit-as-cydia-app-store-shutters)
- Dynastic Repo announced its shutdown in 2021, and purchases were preserved — [iDB](https://www.idownloadblog.com/2021/09/01/dynastic-repo-announces-planned-shutdown-as-alternative-repositories-offer-homes-for-jailbreak-tweaks-add-ons/)
- Sileo FlaggedRepoAPI was archived in Dec 2022 — [GitHub](https://github.com/Sileo/FlaggedRepoAPI)
- The hekatos bypass API is being archived in favour of AppleDB — [GitHub](https://github.com/hekatos/api)
- TweakCompatible survives only as a SourceForge mirror — [SourceForge](https://sourceforge.net/projects/tweakcompatible.mirror/)

### Inferences
- An iOS-version and rootless/rootful filter, from each package's `Depends: firmware (>= x)` and `Architecture:
  iphoneos-arm64` vs `iphoneos-arm` fields, would answer the biggest unmet question without crowd data. A simple
  "worked for me" vote could come later.
- Dead repos and dead sources are common (shutdowns above). A repo-health badge (last reachable, last Release date,
  package count over time) is a cheap differentiator. None of the surviving sites shows one.

### Gaps
- I did not get direct Reddit threads with user complaints (Reddit is hard to search via these tools). The complaint
  list is inferred from shutdowns and missing features, not from quotes.

## PWA web push on iOS, and existing push services for tweak/app updates

### Takeaway
Web push works on iOS 16.4+ only for Home-Screen-installed web apps. Outside the EU it is workable, but subscriptions
are reported to vanish silently. In the EU, home-screen web apps lost standalone mode and push from iOS 17.4. No
existing service sends web push for tweak or AltStore-source updates. Today's options are Telegram, Discord and Twitter
(iOS Repo Updates) or IFTTT for App Store apps only.

### Cited Findings
- iOS 16.4+ (March 2023) is required, and the PWA must be on the Home Screen. There is no `beforeinstallprompt` and no
  automatic install prompt, so users add it by hand from the Share sheet. The Badging API (`navigator.setAppBadge`)
  works on 16.4+ — [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- EU, iOS 17.4+: PWAs open in Safari tabs, and push, badges and home-screen launch don't work (per MagicBell's matrix).
  Apple later reversed the full removal, so this claim needs checking against current behaviour — [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- iOS 26 opens Home Screen sites as web apps by default. A timeline says iOS 27 (Sep 2026) added no new Home Screen
  web app features — [webscraft 2026](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- Developers report push subscriptions disappearing without cause (including on iOS 18) and lost after long
  inactivity. This is anecdotal — [webscraft 2026](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en); [edana 2026](https://edana.ch/en/2026/03/19/push-notifications-on-web-applications-pwa-is-it-really-reliable-on-ios-and-android/)
- Existing update-notification channels: the iOS Repo Updates Telegram channel and Discord bot (firehose, not
  personalised) — [ios-repo-updates.com](https://www.ios-repo-updates.com/). An IFTTT applet sends App Store app
  updates to Telegram (App Store only) — [IFTTT](https://ifttt.com/applets/ieS4pGt5-send-update-alerts-when-an-app-store-app-releases-a-new-version)

### Inferences
- Design for subscription loss. Re-subscribe on every app open (compare the endpoint with the server's copy), show "last
  push delivered" in settings, and offer a fallback: the Shortcuts daily check, and optionally an RSS/Atom feed per
  tracked set (a "my sources" URL), which nobody offers today.
- Ask for permission only from a user tap after install (standard WebKit requirement; not verified in these sources). On
  iOS Safari, show an "Add to Home Screen first" explainer, since there is no install prompt.
- Use the app badge for the pending-upgrade count. It mirrors Cydia's Changes badge and works without a notification.
- Per-user, per-source push for both APT and AltStore sources appears to be unoccupied ground.

### Gaps
- No official Apple or WebKit 2026 numbers on delivery reliability. I did not confirm Declarative Web Push (Safari
  18.4+/iOS 18.4), payload limits, or the current EU status, all due to the tool budget. Check webkit.org release notes.
