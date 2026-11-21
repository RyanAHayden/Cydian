# F344a: Lite's Tweak Sources: only what works in the user's apps, trusted defaults

## What was built

1. **Hide Tweak Sources with nothing usable** (screens/sources.js, core/sources.js):
   - `core/sources.js`: `askTweakIndex(source)` asks the Tweak Index (`GET /api/tweaks`, every tweak, no `bundle=`)
     for an APT Tweak Source (never for a GitHub one: one tweak, no Packages to index); `tweakSourceVerdict(answer,
     appIds)` says true (a tweak works in one of the apps, or in any app), false (the index has read the source,
     nothing is pending, no error, and no tweak works), or null (not known). `shownTweakSources(list, hidden)`.
   - `screens/sources.js`: `judgeTweakSources` runs from `draw()` in the sideload app, at most once per ten minutes
     for the same sources. The user's apps are `screens/tweaks.js signableApps` (My IPAs and signed apps). A false
     verdict hides the source; null keeps whatever was known (a slow index doesn't flash a row back). Rows that go
     collapse (`nav/ui.js collapse`, the slide rule), their group header too when it was the last row; a source that
     comes back redraws. Hidden keys are kept in localStorage (`ifizbox.hiddenTweakSources`) so the next launch draws
     without them. Searching still lists hidden sources; Manage still lists them (delete, reorder).
   - Hidden, not dropped: deleting a source the user may have added on purpose is not reversible, hiding is.
   - Every-app tweaks count as usable: Add Tweaks lists them for every app (`liteTweaks`), so a source with one is
     useful. A paid tweak's guessed app (unverified) counts too, so a source selling a tweak for your app stays.
2. **Lite's defaults are app-tweak sources** (`web/app/tweak-sources.json`): BigBoss, Chariz and Havoc lose
   `"inject": true` (they stay jailbroken defaults). New entries `{ name, github: "<owner>/<repo>", inject: true }`
   become GitHub Tweak Source records (`githubDefaultsFrom`, the same key and shape Add Source's
   `githubTweakRecord` saves), so the catalog, refresh and Add Tweaks read them through core/github.js. Entries
   without `uri` are skipped by `tweakSourcesFrom` (jailbroken defaults), by the Worker's cron seeding
   (`indexSource` needs a uri) and by older apps reading the site's copy (an empty inject list falls back to their
   bundled copy).
   - Seeding happens once per store, so existing installs keep BigBoss/Havoc/Chariz; part 1 hides those when they
     have nothing for the user's apps.

## Research: which app-tweak sources

Criteria: the tweak's `.deb` is in the repo's GitHub releases (core/github.js reads it), a release in the last 12
months (since 2025-11-21), not archived, not DMCA-blocked, the target app a free App Store app, a visible maintainer
with years of history. Nothing on Canister's piracy list (core/piracy-list.js lists hosts; none is github.com or
these owners). Read with `gh api repos/<r>` and `repos/<r>/releases` on 2026-11-21.

| Repo | App | Stars | Since | Last release | Licence | Verdict |
|---|---|---|---|---|---|---|
| dayanch96/YTLite | YouTube | 5,681 | 2023-06 | v6.0, 2026-11-03 (arm, arm64, arm64e .deb) | none stated | **in** |
| dayanch96/YTMusicUltimate | YouTube Music | 2,701 | 2022-04 | v2.4.1, 2026-03-19 (.deb ×3) | GPL-3.0 | **in** |
| SoCuul/SCInsta | Instagram | 881 | 2024-01 | v1.1.1, 2026-03-01 (rootless .deb) | GPL-3.0 | **in** |
| whoeevee/EeveeSpotify | Spotify | – | – | HTTP 451: DMCA takedown 2025-08-14 | – | out |
| BandarHL/BHTwitter | X | 2,601 | – | 4.4, 2025-05-13 (also ships a decrypted X .ipa) | none | out: no release in 18 months |
| BandarHL/BHInstagram | Instagram | 566 | – | 1.2, 2025-05-14 | none | out: stale |
| BandarHL/BHTikTok | TikTok | 363 | – | 0.0.1, 2023-07 | none | out: stale |
| level3tjg/RedditFilter | Reddit | 370 | – | 1.1.8, 2025-09-26 | MIT | out: just past 12 months; a good candidate if it releases again |
| arichornlover/uYouEnhanced, qnblackcat/uYouPlus, YTLitePlus/YTLitePlus | YouTube | 3.4k–7.5k | – | releases carry no files (IPAs built by Actions) | – | out: no .deb to read (uYouPlus archived) |
| bunny-mod/BunnyTweak, revenge-mod/revenge-tweak, enmity-mod/tweak | Discord | 70–348 | – | – | – | out: archived |
| PoomSmart (YouPiP, YTUHD, Return-YouTube-Dislikes) | YouTube | – | – | no GitHub releases; his APT repo poomsmart.github.io/repo is mostly jailbreak system tweaks | MIT/GPL | out as a default (YTLite already bundles these) |

APT repos as Lite defaults: BigBoss, Chariz and Havoc are jailbreak repos whose tweaks mostly hook SpringBoard or
iOS itself; none was kept as a Lite default. A curated multi-repo "Tweaks" source (one record over many GitHub
repos) was considered; one GitHub Tweak Source per repo needs no new source kind, shows each project's own name and
avatar and can be deleted one by one, so that is what was done.

## Checks

- `node --test web/app/core/tweaksources-lite.test.js web/app/screens/sources-tweakhidden.test.js
  web/app/core/defaultsources.test.js web/app/backend-native-tweaksources.test.js web/app/screens/moresources.test.js
  web/app/backend-native.test.js`: 45 pass.
- The gate (`tools/check.sh`) through `run done`.

## Not verified

- **Community trust** (r/sideloaded, r/jailbreak, Feather/ESign/KSign communities): reddit.com answers this machine
  with HTTP 403 and there is no web search tool in this session, so the evidence above is GitHub's own (stars, age,
  release history, maintainers, DMCA status), not forum posts.
- **On the iPhone 15 Pro**: not run. The hiding needs the Tweak Index live, and `/api/tweaks` isn't deployed yet
  (F344's journal: today it answers the SPA's HTML), so on a phone every verdict is null and nothing is hidden until
  the Worker is deployed. The GitHub defaults only seed a new store (a fresh install); the installed build's store is
  already seeded.
- **The collapse animation** of a row that leaves: covered only by code reading (it is `collapse`, as row deletes);
  no run in a browser, since the site has no sideload mode.
- **Too-big .debs**: the Worker marks a .deb over 16 MB as done with no entry, so a source whose only app tweaks are
  that big could read as "nothing usable" and be hidden. Not seen; left as it is.
- **YTLite's licence**: the repo states none; it is listed as a source (its own releases), nothing is copied.
