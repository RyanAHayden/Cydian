# iOS sideloaders, late 2026: feature inventory

Researched 2026-11-17. Many web results are SEO blogs or vendor pages (certificate sellers, Scarlet's own site).
These are flagged where used. Primary sources are the AltStore FAQ and release notes, and GitHub READMEs.

## Which sideloaders are popular and maintained, and which are dead or declining?

### Takeaway
There are four active families. (1) Free Apple-ID signers on a 7-day cycle: AltStore Classic, SideStore,
Sideloadly. (2) The notarized EU/Japan alt-marketplace: AltStore PAL. (3) On-device P12 signers: Feather, KSign,
ESign; plus enterprise-cert stores (Scarlet, GBox) and paid signing services (Signulous, AppDB).
(4) LiveContainer, which runs many IPAs inside one signed app. TrollStore is frozen: it only works on old iOS
(up to 16.6.1 and 17.0), so it doesn't matter for iOS 17.1+ or 26.

### Cited Findings
- 2026 roundups agree that no tool is best for everyone. On-device signers (Feather, KSign, ESign) are the
  no-computer options but need a P12. AltStore and Sideloadly expire after 7 days on a free Apple ID. SideStore +
  LiveContainer is suggested for no-computer use with more than 3 apps. — [lemoncert (cert vendor, updated Sep 17 2026)](https://lemoncert.com/guides/best-ios-sideloading-apps); [builds.io ranking](https://builds.io/blog/technologies/ios-technologies/free-sideloading-tools-iphone-ranked/)
- TrollStore is permanent and needs no certificate, but only on iOS 14.0–16.6.1 and 17.0. Apple fixed the
  CoreTrust bug in 16.7 and 17.0.1, so no 17.1+ or iOS 26 support. — [Scarlet iOS comparison, updated Nov 1 2026 (self-interested)](https://scarletios.com/free-sideloading-tools-compared-2026-edition/); [lemoncert](https://lemoncert.com/guides/best-ios-sideloading-apps)
- The limits of a free Apple ID (AltStore, SideStore, Sideloadly): 7-day signatures, 3 active apps, a weekly cap
  on new App ID registrations, and Developer Mode required on iOS 16+. — [Scarlet iOS](https://scarletios.com/free-sideloading-tools-compared-2026-edition/)
- Scarlet uses a shared enterprise certificate, needs no computer, and lasts until revoked. One revocation kills
  every app at once. Confirmed up to iOS 26; iOS 27 is unconfirmed. — [Scarlet iOS (own site)](https://scarletios.com/free-sideloading-tools-compared-2026-edition/)
- Declining: the free tiers of TutuApp and AppValley (enterprise-signed stores) "have changed many times", and
  their iOS 26 support is unconfirmed. — [Scarlet iOS](https://scarletios.com/free-sideloading-tools-compared-2026-edition/)
- AltStore Classic is actively developed: 2.2 (Apr 16 2026), 2.3 (Sep 14 2026), 2.3.1 (Oct 21 2026, latest). — [AltStore release notes](https://faq.altstore.io/release-notes/altstore)
- AltStore PAL is active: 2.3 (Mar 11 2026), 2.3.1 (Mar 17), 2.3.2 (Jun 15 2026). In Oct 2025, Riley Testut
  announced expansion to Japan, Brazil and Australia, with the UK in 2026, and $6M from Pace Capital for 15%. PAL
  2.2.2 (Dec 2025) added Japan, and 2.3.2 added pt-BR with a Brazil icon. — [PAL release notes](https://faq.altstore.io/release-notes/altstore-pal); [mjtsai, Evolving AltStore PAL](https://mjtsai.com/blog/2025/10/08/evolving-altstore-pal/)
- AltServer 1.7.4 (Windows, Mar 24 2026) fixed launch crashes on iOS 26.4. — [AltServer release notes (search snippet)](https://faq.altstore.io/release-notes/altserver)
- Feather describes itself as "actively maintained". It has about 5.1k stars on GitHub. — [Feather GitHub](https://github.com/khcrysalis/Feather)
- LiveContainer is actively maintained, AGPL-3.0, with about 14.4k stars and 892 commits. — [LiveContainer GitHub](https://github.com/LiveContainer/LiveContainer)
- SideStore: 0.6.1 added StosVPN. The docs now recommend LocalDevVPN (an App Store app) over the old WireGuard
  method. 0.6.3 is reported as the newest stable release (third-party IPA site). On iOS 26, JIT broke again, and
  the fixes ship in nightlies and StikDebug. — [newreleases 0.6.1](https://newreleases.io/project/github/SideStore/SideStore/release/0.6.1); [SideStore docs PR](https://gh.r-mj.com/SideStore/SideStore-Docs/pull/191/files); [fr0stb1rd blog](https://fr0stb1rd.is-a.dev/posts/ios-26-unlimited-sideload-sidestore-livecontainer/)
- The SideStore site footer reads "© 2026 SideStore, LLC". — [docs.sidestore.io](https://docs.sidestore.io/)
- Sideloadly v0.71.0 claims iOS 7 to 27+ and also targets tvOS and Apple Silicon Macs. — [sideloadly.io](https://sideloadly.io/)
- Signulous is a web-based paid signing service, about $19.99/year per device, with a built-in library of modded
  apps. AppDB is an independent marketplace and signing platform with free and paid tiers. Free shared
  certificates get revoked often. — [Wondershare review](https://drfone.wondershare.com/manage/signulous-app.html); [UnKeySign alternatives (competitor)](https://unkeysign.com/alternatives)
- GBox is described as an installer with limited signing that uses shared certificates. — [UnKeySign (competitor, biased)](https://unkeysign.com/alternatives)

### Inferences
- The free-Apple-ID tools are converging on "no computer after setup". SideStore got there first (VPN loopback).
  AltStore Classic 2.3 followed with Remote AltServer using an anisette server. So "refresh from the phone"
  is now the expected baseline.
- Revocation is the main pain point for cert-based stores (Scarlet, GBox, Signulous, AppDB, ESign with shared
  certs). That makes cert-status and revocation checks a valued feature.
- For Cydian's jailbreak app (rootless iOS 15+), TrollStore matters little. Its iOS range barely overlaps
  rootless jailbreaks on 15–16.x. Installing IPAs through the root helper replaces it.

### Gaps
- No reliable 2026 data on user numbers or market share for any sideloader.
- I couldn't confirm current ESign or GBox versions or maintainers (search returned only unrelated PDF e-sign apps).
- AppDB's current 2026 feature set wasn't checked first-hand.
- No official SideStore 0.6.x changelog was read; versions come from secondary sites.

## Feature-by-feature inventory per app

### Takeaway
AltStore defines the source format everyone else reads (Feather, SideStore, LiveContainer, KSign all take
AltStore-style JSON). Its client has the richest store UX: news, featured apps, permissions review, Patreon
gating, trusted sources, and PAL's fediverse explore. The on-device signers add what AltStore lacks: tweak
injection, bundle-ID and name changes, cert management, and an IPA library.

### Cited Findings

**AltStore source JSON spec (the de facto format)**
- Source fields: `name` (required), `subtitle`, `description`, `iconURL`, `headerURL` (3:2), `website`,
  `fediUsername`, `patreonURL`, `tintColor`, `nsfw`, `featuredApps` (bundle IDs, first 5 shown), `apps`, `news`.
  `fediUsername` is needed for discovery via the REST API and can't be changed. `nsfw` must be accurate if the
  source opts into discovery. — [AltStore: Make a Source](https://faq.altstore.io/developers/make-a-source)
- App fields:
  - `name`, `bundleIdentifier` (case-sensitive, unique in the source), `marketplaceID` (notarized PAL apps only),
    `developerName`, `subtitle`, `localizedDescription`, `iconURL`, `tintColor`.
  - `category`: one of developer, entertainment, games, lifestyle, other, photo-video, social, utilities.
  - `screenshots`: plain URLs, or objects with `imageURL`/`width`/`height`, optionally split into `iphone`/`ipad`.
  - `versions`: the first entry is the latest.
  - `appPermissions`: `entitlements` plus `privacy` usage descriptions. AltStore refuses to install if they
    don't match.
  - `patreon`: `pledge`, `currency`, `benefit`, `tiers`.

  — [Make a Source](https://faq.altstore.io/developers/make-a-source)
- Version fields: `version`, `buildVersion`, `marketingVersion`, `date` (ISO 8601), `localizedDescription`
  (what's new), `downloadURL`, `size`, `assetURLs` (PAL ADP), `minOSVersion` (hides incompatible updates),
  `maxOSVersion`. 2.0 added `sha256`. — [Make a Source](https://faq.altstore.io/developers/make-a-source); [AltStore release notes](https://faq.altstore.io/release-notes/altstore)
- News fields: `title`, `identifier`, `caption`, `date`, `tintColor`, `imageURL` (3:2), `url` (opens in-app
  browser), `appID` (shows an app banner), and `notify`. With `notify: true`, the item is sent as a push
  notification on the next background check. — [Make a Source](https://faq.altstore.io/developers/make-a-source)
- Localized titles, subtitles and descriptions: Classic 2.2 (Apr 2026) and PAL 2.2 (May 2025). — [Classic notes](https://faq.altstore.io/release-notes/altstore); [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- Classic 2.3 sends an `ALT_CLASSIC_VER` header on source fetches. — [Classic notes](https://faq.altstore.io/release-notes/altstore)

**AltStore Classic** (worldwide, free Apple ID)
- 2.0 (Sep 2024):
  - Sources tab with a preview before adding (shows Featured Apps).
  - Remote blocking of malicious sources.
  - Patreon-exclusive apps, with in-app pledging and custom amounts.
  - `altstore://search` and `altstore://viewApp` deep links.
  - News redesigned at 3:2.

  — [Classic notes](https://faq.altstore.io/release-notes/altstore)
- 2.0.1: dark and tinted icons, Home Screen quick actions. — [Classic notes](https://faq.altstore.io/release-notes/altstore)
- 2.2 (Apr 2026): the `altstore-classic://` scheme, Increased Memory Limit entitlement support, a Bluesky
  button. — [Classic notes](https://faq.altstore.io/release-notes/altstore)
- 2.3 (Sep 14 2026):
  - Remote AltServer: sideload, install, refresh and activate/deactivate apps anywhere over Wi-Fi, no computer.
  - Liquid Glass UI. Minimum iOS 17.4.
  - The beta (May 2026) was Patron-only and needed a manually entered anisette server URL. Beta 2 added
    automatic anisette server selection and built-in pairing file generation.

  — [Classic notes](https://faq.altstore.io/release-notes/altstore); [AlternativeTo, May 23 2026](https://alternativeto.net/news/2026/5/altstore-launches-on-device-app-sideloading-without-a-computer-or-altserver/)
- 2.3.1 (Oct 21 2026): experimental "Randomize Bundle IDs" against "provisioning profile is banned" errors,
  and a background refresh fix. — [Classic notes](https://faq.altstore.io/release-notes/altstore)
- App-ID limits: activate/deactivate apps to stay within 3 active apps (now possible remotely). — [AlternativeTo](https://alternativeto.net/news/2026/5/altstore-launches-on-device-app-sideloading-without-a-computer-or-altserver/)
- Add-source deep links:
  - `altstore://source?url=<source URL>`, used on developer websites for one-tap add.
  - Web form `https://altstore.io/source/<URL>` (the docs say to update to PAL 2.2+ for the alert).
  - The "Download on AltStore" badge is documented.

  — [Trusted Sources](https://faq.altstore.io/how-to-use-altstore/trusted-sources); [Download badge docs](https://faq.altstore.io/developers/download-on-altstore-badge)
- Trusted Sources: reviewed sources that can be added easily from inside AltStore. The list: OatmealDome
  (DolphiniOS), UTM, Flycast, Provenance, PojavLauncher. — [AltStore Classic Trusted Sources](https://faq.altstore.io/altstore-classic/trusted-sources)
- Widgets appear only in the 1.6/1.7 notes (older), not in 2.x notes. — [Classic notes](https://faq.altstore.io/release-notes/altstore)

**AltStore PAL** (EU DMA alt-marketplace, now also Japan; Apple-notarized apps)
- 2.1 (Jul 2024): Recommended Sources, the `altstore-pal://` scheme. 2.1.1: search and view-app deep links.
  2.1.2: `marketingVersion` support. — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- 2.1.6 (Jan 2025): apps are auto-removed when deleted from the Home Screen (iOS 18+). A "Discover More Apps"
  button links to featured apps on altstore.io. — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- 2.2 (May 2025): installs from developers registered via the REST API, Patreon ADP downloads, `assetURLs`. — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- 2.3 (Mar 2026):
  - Fediverse explore page at explore.alt.store, with opt-in federation of sources.
  - Sign in with Mastodon/Bluesky to like items and share links.
  - Redesigned Add Source screen with three collections: Popular, Indie Gems, Fediverse Favorites.
  - Subscription management removed.

  — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- Plan: every source gets a followable ActivityPub account, and apps, updates and news alerts are federated,
  with likes, boosts and replies shown natively. — [mjtsai](https://mjtsai.com/blog/2025/10/08/evolving-altstore-pal/)
- Pricing history: a €1,50 "Day One" install promo (2.1.3, Oct 2024). The annual subscription option was removed
  in 2.3. — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)

**SideStore** (AltStore fork, no AltServer)
- Sideloads with an Apple ID and re-signs with a personal dev cert. Refreshes apps in the background before the
  7-day expiry.
- Installs on-device through a VPN loopback: EM Proxy, LocalDevVPN, and minimuxer, an in-sandbox lockdown muxer.
- The repo ships `trustedapps.json` and an `AltWidget` folder (inherited widget).

— [SideStore GitHub](https://github.com/SideStore/SideStore)
- A computer is needed once, for setup. Limit: 3 active apps. — [Scarlet iOS](https://scarletios.com/free-sideloading-tools-compared-2026-edition/)
- Weekly user routine: open LocalDevVPN, Connect, then SideStore "Refresh All". — [fr0stb1rd](https://fr0stb1rd.is-a.dev/posts/ios-26-unlimited-sideload-sidestore-livecontainer/)

**LiveContainer**
- Runs many IPAs inside one signed app with one App ID, getting around the free account limits (3 apps,
  10 App IDs).
- Multiple versions of the same app, each with its own data container, and 128 keychain groups for separate
  accounts.
- TweakLoader loads CydiaSubstrate and tweaks from a folder.
- Optional JIT bypasses codesigning (below iOS 26).
- Built-in SideStore variant. Opens URLs and files in guest apps.
- iOS 15+ (multitasking needs 16+).
- Limits: no remote push, no app extensions, no sandbox between guest apps.

— [LiveContainer GitHub](https://github.com/LiveContainer/LiveContainer)

**Feather** (on-device signer, open source)
- On-device sign and install with Apple Developer Program certs. Shows cert and app details.
- Signing options: appearance, Files app support, compatibility patches, Liquid Glass patch.
- .deb/.dylib injection via ElleKit.
- Supports AltStore repositories and has an "Add AltSource" button. Talks to installd via idevice.

— [Feather GitHub](https://github.com/khcrysalis/Feather)

**KSign** (on-device signer; "hybrid of ESign and Feather")
- Built-in repos ("like adding repos in Cydia"). A Files tab for imported IPAs; a Library tab for signed and
  installed apps with version and bundle ID.
- Before signing: change bundle ID, name, version and icon, inject frameworks and dylibs (Substrate, YTPlus),
  apply iOS-compat patches.
- Toggles: PPQ protection (randomised identifiers), File Sharing, Game Mode.

— [iDeviceCentral (dated inconsistently, 2025/2026)](https://idevicecentral.com/ios-guide/ksign-ipa-installer-for-ios-the-free-code-signing-app-you-should-try-in-2025/)
- ESign is described as "feature-rich, but a bit more cluttered". Feather is "lightweight" and the author's
  favourite. — [iDeviceCentral](https://idevicecentral.com/ios-guide/ksign-ipa-installer-for-ios-the-free-code-signing-app-you-should-try-in-2025/)

**Sideloadly** (desktop, Windows/macOS)
- Auto-refresh daemon, Wi-Fi sideloading.
- Injects .dylib/.deb/.framework/.bundle, with Substrate or Substitute.
- Bundle ID change (duplicate installs), name and icon change, remove device restrictions, file sharing,
  extension removal.
- JIT up to iOS 16, URI scheme, logs.

— [sideloadly.io](https://sideloadly.io/)
- Recommended for tweaked or modded apps. — [builds.io](https://builds.io/blog/technologies/ios-technologies/free-sideloading-tools-iphone-ranked/)

### Inferences
- Since Feather, KSign, SideStore and LiveContainer all read AltStore sources, Cydian's support for
  AltStore-format sources covers nearly the whole sideloading ecosystem's catalogue.
- The source spec carries data Cydian can show for free: `news` (with `notify` meaning "push this"),
  `featuredApps`, `screenshots`, `appPermissions` (an entitlements/privacy review before install), `versions`
  (version history and a "what's new" changelog), `minOSVersion` (hide incompatible updates), `category`,
  `tintColor`/`headerURL` (themed source page), and `patreon` (a price badge).
- The on-device signers' library model (imported IPAs vs signed and installed apps) maps naturally onto Cydian's
  Installed/Changes views in the jailbreak app.

### Gaps
- I didn't confirm whether Feather, KSign or SideStore have their own add-source URL schemes (e.g.
  `feather://source/…`, `sidestore://source?url=`). None of the fetched pages mention them.
- No first-hand ESign feature list was found.
- Whether 2.x AltStore Classic still ships home-screen widgets showing refresh countdowns is unconfirmed (only
  mentioned in 1.6/1.7 notes; SideStore's repo has `AltWidget`).

## What is unique or most praised in each?

### Takeaway
- AltStore: trust, polish, and a store-like UX (news, Patreon, trusted sources, PAL's legal notarized
  distribution and fediverse discovery).
- SideStore: no computer after setup.
- LiveContainer: unlimited apps and multiple copies of one app under one App ID.
- Feather/KSign: on-device signing with tweak injection and full control over app metadata.
- Sideloadly: the most complete injection and duplication toolkit on desktop.
- Scarlet: zero setup (at the cost of revocations).

### Cited Findings
- AltStore is called "the most reliable choice for Wi-Fi refresh" when a computer is on the same network.
  Sideloadly is recommended for tweaked apps. — [builds.io](https://builds.io/blog/technologies/ios-technologies/free-sideloading-tools-iphone-ranked/)
- SideStore + LiveContainer is the no-computer, more-than-3-apps choice, with the caveat that "you may need to
  fight the setup". — [builds.io](https://builds.io/blog/technologies/ios-technologies/free-sideloading-tools-iphone-ranked/)
- On-device signers are praised as "convenient, no computer, no app cap". The con is that they need a paid
  certificate. — [lemoncert](https://lemoncert.com/guides/best-ios-sideloading-apps)
- More countries was Riley Testut's top user request for PAL. — [mjtsai](https://mjtsai.com/blog/2025/10/08/evolving-altstore-pal/)
- KSign is praised for combining ESign's features with Feather's minimal UI. — [iDeviceCentral](https://idevicecentral.com/ios-guide/ksign-ipa-installer-for-ios-the-free-code-signing-app-you-should-try-in-2025/)
- LiveContainer: install the same app many times with separate data and keychains. — [LiveContainer GitHub](https://github.com/LiveContainer/LiveContainer)

### Inferences
- Features Cydian could adopt:
  1. One-tap add-source deep links, plus a web `/source/<url>` page that hands off to the native app or to
     AltStore/Feather.
  2. A curated "trusted/featured sources" shelf with collections, like PAL's Popular, Indie Gems and
     Fediverse Favorites.
  3. Source news feeds with push for `notify` items.
  4. A per-source About page (header, tint, featured apps).
  5. A permissions/entitlements review before install.
  6. Version history with what's new, and hiding updates for an incompatible iOS.
  7. Update badges and notifications (PWA/IPA).
  8. In the jailbreak app: IPA install plus dylib/deb injection (Feather/KSign-style). This is a natural fit,
     since Cydian already handles debs.
  9. Expiry and revocation status for sideloaded apps, if the IPA app manages them.
- Cydia-style source management fits these users: KSign's own pitch is "add repos like in Cydia".

### Gaps
- I found no Reddit (r/sideloaded, r/AltStore) threads with quantified user praise in the time available. The
  praise above comes from roundup sites, some commercially biased.

## Source aggregators and discovery features

### Takeaway
Discovery is fragmented. AltStore offers Trusted Sources (Classic), Recommended Sources and three curated
collections (PAL), plus the fediverse explore.alt.store with an opt-in REST API. Community lists (awesome-altstore,
SEO "repo list" pages) fill the rest. No neutral cross-format aggregator (APT + AltStore) appeared, which is an
opening for Cydian.

### Cited Findings
- AltStore Classic Trusted Sources: a reviewed list that can be added in-app. — [AltStore FAQ](https://faq.altstore.io/altstore-classic/trusted-sources)
- PAL: Recommended Sources (2.1), "Discover More Apps" linking to altstore.io featured apps (2.1.6), and the
  explore page with opt-in federation and Popular / Indie Gems / Fediverse Favorites collections (2.3). — [PAL notes](https://faq.altstore.io/release-notes/altstore-pal)
- Sources opt into discovery with `fediUsername` (via the REST API) and must flag `nsfw` accurately. — [Make a Source](https://faq.altstore.io/developers/make-a-source)
- Classic 2.0 can block malicious sources remotely. — [Classic notes](https://faq.altstore.io/release-notes/altstore)
- AltStore runs a source preview service at api.altstore.io/source/<host>/source.json, which renders an
  "AltStore Preview" of any source. — [example](https://api.altstore.io/source/altstore.anneferret.eu/source.json)
- Community aggregators: the awesome-altstore GitHub list, and "AltStore, SideStore & LiveContainer Repos 2026"
  lists. — [awesome-altstore](https://github.com/victordedomenico/awesome-altstore); [senumy repo list](https://senumy.com/altstore-and-sidestore-sources)
- SideStore ships a `trustedapps.json` in its repo. — [SideStore GitHub](https://github.com/SideStore/SideStore)

### Inferences
- Cydian could reuse the explore.alt.store / REST API listing as a discovery feed, if its terms allow. It could
  also offer a shared "default sources" list for both APT repos and AltSources, plus a malicious-source
  blocklist like AltStore's remote block.

### Gaps
- I didn't check the explore.alt.store REST API's terms or public endpoints.
- I didn't verify whether Feather or KSign ship built-in default source lists, or which sources they include.
