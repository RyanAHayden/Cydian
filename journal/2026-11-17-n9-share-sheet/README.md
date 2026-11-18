# N9: share sheet and Open in Cydian (2026-11-17)

## What was done

- **Document types and UTTypes** (`native/Info.plist`, `native/Info-sideload.plist`): `.ipa` (`com.apple.itunes.ipa`) and
  `.deb` (`org.debian.deb-archive`, imported, as Sileo/Zebra declare it) in both builds, so Files, Mail, AirDrop and
  Safari's downloads offer Cydian. mkipa.py's overlay replaces a key whole, so the sideload overlay repeats the .deb
  type beside F77's (.ipa, .p12, .mobileprovision). The jailbreak build had **no `cydian` URL scheme**; it has one now
  (the share extension needs it), plus `LSSupportsOpeningDocumentsInPlace` false (iOS copies into Documents/Inbox).
- **Share extension** `PlugIns/CydianShare.appex` (`com.ryha.cydian.share`, `native/share/Extension/`, `share/build.sh`,
  called from `build.sh` beside the widget): one web link or text → `cydian://share?url=…|text=…`, opened through the
  responder chain's UIApplication with `openURL:options:completionHandler:` (extensions have no `UIApplication.shared`;
  iOS 18 dropped `openURL:`). Linked with `-e _NSExtensionMain` as Xcode does. Files don't go through it.
- **Classifier and router** (`native/share/Share.swift`, Foundation only): files by their first bytes (ar → deb, zip
  whose first entry is `Payload/` → ipa), then extension; links by path (.ipa/.tipa, .deb, .json) and repo managers'
  schemes (cydia/sileo/zbra/installer → APT repo; altstore/sidestore/feather → app source); any other http(s) link is
  offered as an APT repo (Cydia's Add Source takes any URL; Verifying URL says when it isn't one). Routes:
  sources → N8's `cydian://add?url=…` in both modes; ipa → jailbreak helper (refused up front when neither AppSync
  Unified nor ldid is there) / sideload My IPAs + sign (refused with what's missing when no certificate);
  deb → jailbreak Confirm sheet / sideload "Needs a Jailbreak"; unknown → an alert saying why.
- **Helper verbs** `simulate-deb <path>` / `install-deb <path>` (`native/helper/policy.c`, `paid.c`, `main.c`): only from
  `HELPER_DEB_DIR`, copied root-side exactly as install-paid's (I factored paid.c's copy+run into `run_on_copy`, now
  shared by both), no control check (any .deb, like `selfupdate`), then `apt-get -s` / `apt-get -y … install <copy>`
  with `--reinstall --allow-downgrades`, so dependencies resolve from the sources. Tests: `test_helper.py` LocalDeb
  (plan, chain, refusals). The fake helper has both verbs (text-stanza "debs", `Depends:` resolved against the lists).
- **Shell glue** (`native/share/App/ShareBridge.swift`): `SharedInbox.receive` first in `Incoming.receive`; bridge
  calls `share.ipaInstall`, `share.debFetch`, `share.debSimulate`, `share.debInstall`, `share.discard`; staged files
  older than a day are swept at launch. `sign/Handoff.swift` accepts `cydian://shared`.
- **Page** (`web/app/share.js`, `core/share.js`, `screens/sharedeb.js`): `incoming.js` hands `cydian://shared` over.
  helper-ipa: "Install?" then the existing Install IPA console (openIpaInstall got a `native` stand-in so a staged file
  goes through `share.ipaInstall`); sign-ipa: My IPAs page, then "Install?" → myipas.js's own Install
  (`installLibraryFile`, exported), which signs on the phone, installs through the in-app server and records the
  version; deb: a Confirm sheet for that file (parseSimulation, F18's sentences on refusal, apt's raw output), then
  `runPaidInstall`'s console over `share.debInstall`. Jailbreak IPA installs are recorded with `recordInstall`
  (sourceName "Shared") for I3's updates.

## Decisions (unattended, written down)

- Sideload IPA install is My IPAs' existing route (I6/F14/F77: on-phone signer in `native/sign/`, in-app server),
  not a second signer: the brief's zsign/backloop wording was overruled by I6 (docs/signing.md). The share route adds
  the readiness check (fake-signer tested) and the "Install?" prompt.
- A sideload IPA arriving with no certificate imported falls through to F77's My IPAs (kept there), instead of an
  alert that would lose the file.
- `.deb` package name for the console title comes from apt's plan (`Note, selecting '<pkg>' instead of …`, or an
  `Inst … local-deb` line); the shell doesn't parse .deb control itself (control.tar may be zstd).
- Files named `Share.swift`, not `Core.swift`: swiftc refuses two files of the same name in one module
  (`intents/Core.swift`), in the tests and in the app build alike.

## Tried and failed

- First test build: "filename Core.swift used twice" (above). Renamed.
- The fake helper's dependency lookup used awk paragraph mode; the fixture's Packages files part some stanzas with
  a line of spaces, so `bash` was merged into the next stanza. Rewrote it line by line. Then `exit` in awk ran END,
  printing the version twice; guarded.

## Tests

- `native/share/test_share.py`: 13 Swift tests (classify links/text/files; each mode's route against a fake signer;
  staging; install-ipa, simulate-deb and install-deb against the fake helper; apt plan parsing), plus the declared
  plists, the built .deb/IPA carrying the appex, and the wiring.
- `native/helper/test_helper.py` LocalDeb; `web/app/core/share.test.js`, `web/app/share.test.js`.
- `native/build.sh all` built both the .deb and the IPA here with the appex; `mkdeb.py`/`mkipa.py check` passed.

## Not verified

- **Nothing ran on an iPhone** (no jailbroken test phone; the 4S is iOS 6 and can't run this app). Unchecked there:
  that Cydian shows in the share sheet for .ipa/.deb and for Safari links; that the extension's runtime
  `openURL:options:completionHandler:` call actually opens Cydian on iOS 15–18+ (widely used trick, but Apple may
  refuse it from an extension); that NSExtensionMain finds `CydianShare.ShareViewController`; that a jailbreak
  (no-container) app gets its "Open in" copy in `/var/mobile/Documents/Inbox` as assumed; that real `apt-get -s
  install /path.deb` prints `Note, selecting …` as parsed; that installd accepts the staged IPA (same path as F59).
- The sideload "Install?" after a shared link runs `installFromLibrary` before the My IPAs page has listed the file;
  covered only by reading the code (`install()` falls back to the file's name), not by a DOM test.
- The .deb Confirm sheet and the share prompts were not rendered or checked at 3x (no DOM tests for them; node tests
  cover the alerts, Cancel paths and failed downloads).
- The console title for a .deb whose package apt didn't name ends in a stray space (`runPaidInstall` appends the
  version); cosmetic.
