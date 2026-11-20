# B185: libraries like Comet offered as tweaks in the sideload build

## What the user hit

Sideload IPA, Chariz's Comet: the add failed with "Nothing to inject: no .dylib in Library/MobileSubstrate/DynamicLibraries"
(core/tweaks.js inspectTweakDeb).

## Findings

- Chariz's Packages (2026-11-20) lists Comet (`com.ginsu.comet`, 2.0.1, iphoneos-arm and -arm64) as **Section: Tweaks**,
  Description "A SwiftUI Prefs Framework", **Depends: dev.theos.orion14, firmware (>= 14.0)**. A Tweak Source already
  left it out (injectableFromFields: "needs dev.theos.orion14"), so the user got there through **Canister**: Search's
  Other Sources · Canister and Search All Repos check only `injectableWith` (core/canister.js), which passed package,
  arch, section and tag, and Canister's row for Comet is Section Tweaks with no Depends. So it was listed, and Add Source
  & Add to App then downloaded the .deb and failed.
- Comet really has nothing to inject: its Makefile (github.com/ginsudev/Comet) is a Theos `FRAMEWORK_NAME = Comet`,
  `Comet_INSTALL_PATH = /Library/Frameworks`, so the .deb carries `Library/Frameworks/Comet.framework/…` (rootless:
  under `var/jb/`) and no DynamicLibraries entry. The scan doesn't miss anything for it.
- Scanned every free stanza that passes the Canister-field check: Havoc 60 of 315 (all downloaded), Chariz 33 of 86 (the rest
  rate-limited, below). Every real tweak used `Library/MobileSubstrate/DynamicLibraries/` (rootful or `var/jb/`), plain
  files: no symlinks, no hard links, no case differences, no other prefix or folder (Library/TweakInject,
  usr/lib/substitute). The only "Nothing to inject" in that set was Havoc's `com.muirey03.powermodule`, a Control Center
  module (`Library/ControlCenter/Bundles/PowerModule.bundle`, a PreferenceBundles page, `usr/bin/mobileldrestart`).
  Everything else that failed was SpringBoard-only, CLI tools or an app, all with right reasons.
- Description check over both repos' full Packages (Chariz 1308 stanzas, Havoc 3740) flags 23 packages, all libraries
  or frameworks (Alderis, Cephei's ws.hbang.common, libimagepicker, Foxfort's libs, Inky, Lottie, Comet, …) plus
  CatScript ("An automation framework designed for the iOS platform", Section Tweaks): borderline. It's an automation
  tool, not an app tweak, so leaving it out is right, but the reason shown says "library". No false positives from
  "app library" (Vinculum 2), "free developer accounts" (nofreeapplimit) or a name starting "lib" (Libellum, a real tweak).

## What changed

- core/tweaks.js: `isLibraryStanza` (Section Libraries/Frameworks, `purpose::library`, a Description whose opening noun
  phrase is a library/framework, or "for developers"). `injectableFromFields` answers it first with `library: true` and
  `LIBRARY_WHY` = "This is a library for other tweaks, not something to add to an app." inspectTweakDeb with nothing to
  inject now says why in plain words: a library (frameworks or loose .dylibs), a Control Center module, a Settings page only, or
  "There's nothing in it that can go into an app." Also the missing-filter reason lost its jargon. The paths the scan reads
  were not widened: the injector (sortFiles) reads the same two folders, and a wider check would offer an add that then
  fails.
- core/canister.js `injectableWith`: passes the Canister row's description too (one line; outside the task's file list,
  but it's the route that offered Comet).
- screens/tweaks.js: `tweakInfo` answers a library stanza without downloading; the package group's row says "A Library for
  Other Tweaks", Add to App's alert "Not a Tweak for Apps". A refusal cached by an older build (no `v`) is checked
  again so the old jargon goes away; cached good answers stay.
- Tests: core/tweaks-apt.test.js (real stanzas and descriptions, Comet's and PowerModule's file lists),
  screens/tweaks-library.test.js (no download for Comet, Add to App's message, stale cache, the fixture tweak still
  injects).

## Tried, didn't work

- The first Chariz scan pass fetched too fast and got HTTP 429 for most debs. The second, with a pause and retries, got 33
  then stuck on 429 again; `chariz.com/download/…` (where repo.chariz.com 302s to) kept answering 429 for this machine,
  Comet included. Comet's file list in the test comes from its Makefile, not the downloaded .deb.
- Widened the scan first (case-insensitive, hard links, Library/TweakInject, usr/lib/substitute, private/var/jb), then
  undid it: no real package needed it, and the injector would have disagreed.

## Not verified

- **On the IPA**: Comet no longer offering an add, and a real app tweak still injecting on a phone. Only checked in node
  (Canister's real row for Comet through `injectableWith`, and the fixture tweak through `prepareTweaks`). No sideload-IPA
  test phone is driven from these sessions (the iPhone 7 runs the jailbreak build).
- **Comet's actual .deb**: Chariz's download host rate-limited this machine (429). The path list is from its Makefile.
- **Chariz's other 53 free tweaks** past the rate limit weren't downloaded. Havoc's first 60 and Chariz's first 33 were.
- A Comet page opened from an already-added Chariz Tweak Source can't happen (the fields check already rejected it there).
  An old cached Canister listing could still show it until the next search.
