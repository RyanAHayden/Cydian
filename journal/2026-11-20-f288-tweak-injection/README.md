# F288: tweak injection when signing

## What was built

One unpacker and planner in plain JS, used by both signers; the Mach-O load command insertion twice (JS for the
website's zsign path, Swift for the app's IPASigner), on the same rules.

- `web/app/core/unpack.js`: DEFLATE (raw, gzip, zip), an LZMA decoder (after the LZMA SDK's reference decoder) with
  the xz container (LZMA2 chunks) and LZMA-alone files, ar, tar (ustar/GNU/pax), zip. Plain JS so the iOS 15 web view
  (no `DecompressionStream`) runs it too. `.zst` and `.bz2` data.tars are refused with "add its .dylib instead".
- `web/app/core/tweaks.js`: `unpackDeb` (rootless `var/jb/` stripped; MobileSubstrate/TweakInject dylibs injected,
  Library/Frameworks and usr/lib dylibs copied as dependencies, Application Support bundles to the app's top folder),
  zipped `.framework`s, `prepareTweaks` (every bundled Mach-O's dylib commands pointed at `@rpath/…`, IDs set,
  CydiaSubstrate/libsubstrate/ElleKit names to the bundled CydiaSubstrate.framework or libellekit.dylib), Mach-O
  `editCommands`/`rewriteDylibs`/`injectInto` (fat and thin, room checked against the first section, 16 bytes kept
  for an unsigned binary's LC_CODE_SIGNATURE), `tweakParams` for the bridge.
- `native/sign/Tweaks.swift`: `TweakSet` (bridge JSON, Codable for the stored options; paths must be under
  `Frameworks/` or a top-level `.bundle`, inject paths must name a file) and `MachOEdit.inject`. `IPASigner` puts the
  files in (frameworks with an Info.plist become bundles to sign), injects into the main executable before signing it
  and reports `injected`. `SignOptions.tweaks`, `StoredOptions.tweaks` (Re-sign All and My IPAs keep them),
  `library.options` keeps saved tweaks when a page doesn't send the key, `signing.prepare {library}` takes the
  library's saved tweaks, `library.list` options carry the names.
- Website: `websign-job.js putTweaks` (files into the MEMFS app, `injectInto` on the executable) before zsign;
  `signInBrowser` passes the tweaks kept for the app's bundle ID.
- UI: `web/app/screens/tweaks.js` "Inject Tweaks" group (rows with Remove via action sheet, Add Tweak… file input
  taking `.dylib,.deb,.zip,.framework`, footer turning red with the problem), kept per bundle ID in IndexedDB
  (`ifizbox-tweaks`, core/myipas.js `openIpaStore` with another name). In the Custom Install sheet
  (signing-sheet.js), My IPAs' Sign Options (sent on Save only when changed) and the website's stored-IPA page (saved
  on each change). `web/app/tweaks.css`.
- Docs: docs/signing.md "Tweak injection", docs/sideload.md's Feather comparison.

## Decisions (unattended, written down)

- **ElleKit is not bundled.** ElleKit's GitHub has no release assets (the API answered an empty list), and committing
  a third-party binary or fetching one at sign time needs a pinned source someone has checked. So a tweak that links
  CydiaSubstrate with no CydiaSubstrate.framework / libellekit.dylib among the added files is refused before signing,
  with words saying to add ElleKit's .deb; the group's footer says it in red as soon as it's the case. Follow-up filed.
- **Unpacking on the page, not in Swift.** One implementation for both signers, testable with `node --test`; the app
  gets prepared files (base64) like the icon. Swift only copies files and inserts load commands.
- **Website remembers by bundle ID**, so only installs whose bundle ID is known up front (My IPAs files, source apps
  with an ID) get tweaks; iFizBox's own IPA never does.
- Debs' filter plists are ignored (Feather injects every dylib too): the tweak loads in the one app it's injected into.

## Checks

- `node --test web/app/core/tweaks.test.js` (13): inflate/gunzip against zlib (stored, fast, best, members, bomb limit),
  ar+tar of the fixture debs, xz/lzma round trips and damage, zip, unpackDeb, substrate missing/present, libellekit
  standing in, zipped framework, tweakParams, injectInto (weak dylibs + rpath, sizes, ncmds/sizeofcmds, code untouched,
  idempotent, existing rpath), fat slices, no room, long rewrite.
- `node --test web/app/websign-tweaks.test.js`: putTweaks on a fake FS, and the **real zsign WebAssembly** signing
  `tiny-ifizbox.ipa` (node only, never a phone) with Plain.dylib: the signed executable lists LC_LOAD_WEAK_DYLIB
  `@rpath/Plain.dylib` and the rpath, the dylib carries an embedded signature, CodeResources seals it.
- `native/test_sign.py`: the Swift test "F288: tweak injection" (bridge JSON parsing and refusals, stored options round
  trip, MachOEdit on thin/fat/twice, a signed rich fixture IPA with a dylib, a framework bundle and a .bundle: all
  verified signed and sealed) and `test_tweaked_ipa`, Python's own otool -l style reading of that IPA's executable.
- Fixtures: `web/app/core/fixtures/tweaks/make.py` (stdlib: tarfile, lzma, gzip, zipfile) writes the .debs and
  Mach-Os; `--check` compares (not in the gate: xz output can differ between liblzma versions).
- Chromium shots (`capture.mjs`, B164's with a `signing.inspect` fake; `script.json`, `--mode sideload`, 390x844@3x):
  `sheet-tweaks.png` (Custom Install sheet with a .deb, ElleKit and a .dylib), `options-problem.png` (My IPAs' Sign
  Options with only the tweak .deb: the red CydiaSubstrate footer).
- Full `node --test web/app`: 2246 pass.

## Failed first

- The fixture dylibs had no `__LINKEDIT`: zsign answered "Signed Failed!". Added a `__LINKEDIT` segment in make.py.
- `readTar` kept GNU tar's trailing slash on folder names; now stripped.
- `unlzma` refused unknown-size files as "too big" (Infinity > limit).

## Not verified

- **A real tweak on a phone.** No phone test: the sideload build isn't on the iPhone 7 (jailbreak build), and the task
  only asks for fixtures. A real tweak .deb (Theos output, arm64/arm64e fat) and real ElleKit were not run through
  either signer; the fixtures imitate their layout (rootless paths, fat slices, the CydiaSubstrate re-export).
- **ElleKit's real CydiaSubstrate.framework**: assumed to re-export `/var/jb/usr/lib/libellekit.dylib` (rewritten to
  `@rpath/libellekit.dylib`); not checked against a real ElleKit .deb.
- **The file picker** in Chromium (Add Tweak…): headless Chromium shows no picker; the shots seed IndexedDB instead.
- **Website UI shot** of the stored-IPA page's group: not taken (same component as the two shots).
- **zstd and bzip2 debs**: refused, not unpacked (no decoder written).
- **Large tweaks over the bridge**: base64 of up to 64 MB in one signing.install call was not measured on a phone.
