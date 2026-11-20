# F295: bundle ElleKit for tweak injection

## What was done

- **Source found.** ElleKit's GitHub (now `tealbathingsuit/ellekit`, formerly `evelyneee/ellekit`; BSD-3-Clause)
  still has no release assets, and Procursus doesn't carry it (only `dhinakg-keyring`, "GnuPG key for ElleKit's
  repository"). ElleKit's own apt repository does: https://ellekit.space/Packages lists `ellekit` 1.2 for
  `iphoneos-arm64` (rootless; `iphoneos-arm` is the rootful build), `Filename: pool/ellekit_1.2_iphoneos-arm64.deb`,
  `Size: 331444`, `SHA256: e21dc91bdc1be193dc915daecfff45256239b4fe583a36861e662ab1f43906dc`. Downloaded it;
  `sha256sum` gives the same. It's the newest version listed. The repo is the one palera1n and Dopamine add by
  default (core/recommended.js).
- **What's in it**: `var/jb/usr/lib/libellekit.dylib` (fat arm64 + arm64e, ID `/usr/local/lib/libellekit.dylib`,
  links Foundation/libobjc/libSystem/CoreFoundation/libc++ and `@rpath/libswift*.dylib`, LC_RPATH `/usr/lib/swift`),
  the loader, pspawn, MobileSafety, libinjector, and symlinks (CydiaSubstrate.framework/CydiaSubstrate,
  libsubstrate, libhooker, libblackjack → libellekit). F288's `unpackDeb` already takes only `usr/lib/libellekit.dylib`
  (symlinks and `usr/lib/ellekit/*` stay out), so the whole .deb is vendored unchanged: its hash can be checked
  against the repository's index by anyone, which an extracted dylib couldn't.
- `web/app/vendor/ellekit/`: the .deb, its `LICENSE` (from the package's `usr/share/doc/ellekit/LICENSE`, BSD-3,
  binary redistribution allowed with the notice; GPL-compatible), `README.md` (source, hash, licence, update steps).
  `.gitignore` un-ignores that folder's .deb (`*.deb` is ignored; F288's fixtures were lost to that once).
- `core/sha256.js`: plain-JS SHA-256 (WebCrypto's `crypto.subtle` needs a secure context; the app's web view serves
  from its own scheme, and signing-client.js already guards `subtle` as possibly missing).
- `core/tweaks.js`: `ELLEKIT` (version, file, source, sha256, size, licence), `checkElleKit`, `needsElleKit`,
  `withElleKit(items, deb)` (prepare; when CydiaSubstrate is missing, prepare again with the bundled .deb first, so a
  user's file at the same path wins; `names` stay the user's, ElleKit's ignored paths dropped, `bundled:
  ["ElleKit 1.2"]`). `prepareTweaks` itself is unchanged.
- `screens/tweaks.js`: `loadElleKit` (fetch `../vendor/ellekit/…` relative to the module, size + SHA-256 check, kept
  once loaded, retried after a failure), `preparedItems` (async; loads ElleKit only when needed), `preparedFor` and
  the group's `prepared()` use it. The footer now says "ElleKit 1.2 goes in too, for CydiaSubstrate (bundled; BSD
  licence)" instead of the red refusal; the refusal stays for a failed or wrong bundled file ("Add ElleKit's .deb to
  the tweaks yourself").
- Docs: docs/signing.md "Tweak injection", docs/sideload.md's Feather comparison.

## Decisions (unattended)

- **Vendored, not fetched at sign time.** The website could fetch ellekit.space through `/api/fetch`, but the app
  would then depend on a third-party host being up and unchanged; a vendored file checked against a pinned hash
  works offline and the same in both signers. Cost: 331 KB in the site and the app.
- **ElleKit 1.2**, the newest listed. Older 0.x/1.1 builds offer nothing for injection into one app.
- **Only libellekit.dylib goes into the app**, not a CydiaSubstrate.framework: the package's framework is a symlink
  to libellekit, and F288 already points CydiaSubstrate/libsubstrate/libhooker load commands at
  `@rpath/libellekit.dylib` when that's what's there.
- **Credits screen / README credits** not touched (not this task's files); the licence travels with the binary in
  `vendor/ellekit/LICENSE` (shipped in the site and the app bundle), which is what BSD-3's binary clause asks.
  Follow-up filed to name ElleKit in Credits.

## Checks

- `node --test web/app/core/ellekit.test.js` (5): sha256Hex vs node for padding edges; the vendored file's size,
  SHA-256, source, LICENSE and README agree with `ELLEKIT`; `checkElleKit` refuses a flipped byte, a short file,
  null; `withElleKit` with the **real ElleKit 1.2** and the F288 fixture tweak: no missing, only
  `Frameworks/libellekit.dylib` added (ID rewritten to `@rpath/libellekit.dylib`, `/usr/lib/swift` rpath kept), the
  tweak's dylib links `@rpath/libellekit.dylib`, not injected itself; nothing added for a plain dylib or when the
  user's own ElleKit is there; without the file the old refusal.
- `node --test web/app/screens/tweaks-ellekit.test.js` (3): loadElleKit's URL, 404/throw/changed-file refusals,
  retry after failure, kept once loaded; preparedItems loads only when needed; preparedFor.
- F288's tweaks, websign-tweaks and signing-sheet tests still pass; native/test_brand.py passes.
- Timing in node: hash 8 ms, unpack (xz) + prepare 49 ms.

## Not verified

- **A person's check of the source and SHA-256** (the task asks for it): I took both from https://ellekit.space
  (its `Packages` index and the downloaded file agree), but nobody has confirmed that ellekit.space is the right
  upstream or compared the binary with a build from the tagged source. Asked for with CONFIRM on `run done`.
- **ElleKit in a sideloaded app on a phone.** No phone run: the sideload build isn't on the iPhone 7 and the task
  doesn't say to touch a phone. Whether ElleKit 1.2's hooks work inside a non-jailbroken app (no JIT, no
  `/var/jb`) under a normal signing certificate was not tested; Feather bundles ElleKit the same way, which is
  the reason to think it does. The Swift runtime it links via `/usr/lib/swift` exists on iOS 12.2+.
- **The fetch in the app's web view** of a `.deb` from the bundle (`AppScheme.mime` for an unknown extension) was not
  run; native/build.sh copies every web/app file except tests and `vendor/zsign`, so it is in the bundle.
- **Chromium shot** of the new footer: not taken (text-only change in an existing component).
