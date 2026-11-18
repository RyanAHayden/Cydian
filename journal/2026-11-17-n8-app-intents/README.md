# N8: App Intents, widget and controls in the native shell

> 2026-11-18: a device exists now: the iPhone 7 (`ssh 7`, iOS 15.8.8, palera1n rootless). How to use it, drive its
> screen (`tools/ui-7.sh`) and install Cydian on it: `docs/iphone7.md`. The "no device" notes below are from before.

Brief: Shortcuts / Siri / Spotlight / Action button / Control Center get Cydian's actions with nothing built by hand.
Both modes: Check for Updates, Add Source (URL), the widget with the update count. Jailbreak: Install All Updates,
Respring and Userspace Reboot (also controls), Export / Restore My Packages (sideload restores sources only). The
share-sheet extension moved to N9.

## What N8 adds

- `native/intents/Core.swift`: what each intent does, Foundation only, behind an `IntentHost` (helper, files under
  the prefix, the sideload update fetch). Upgrades are computed in Swift: installed (dpkg status) vs the newest
  version in apt's `*_Packages` lists (`DebVersion` from I3's Updates.swift), `showhold` and dpkg holds left out.
  The helper had no "list upgrades" verb, and parsing lists keeps the check to `update` + reading files.
- `native/intents/App/Intents.swift`: 7 `AppIntent`s plus an `AppShortcutsProvider` (5 phrases). Add Source and
  Restore are `openAppWhenRun`: Add Source hands the page `cydian://add?url=…` (new `IncomingLink` host,
  `web/app/incoming.js` opens `addSource` filled in), and a restore runs apt for minutes, longer than a background
  intent may. Sideload restore makes a `cydian://import` link (transfer.js's own `{v:1, sources, holds}` gzip+base64url
  format) so the page's existing review alert adds the sources.
- `native/intents/metadata.py`: writes `Metadata.appintents` (what Xcode's macOS-only appintentsmetadataprocessor
  makes) from `swiftc -emit-const-values-path`. Checked against two real Xcode captures (below). The sideload IPA
  gets only the both-modes intents (`--only`), and `mkipa.py check` enforces that.
- `native/widget/`: `CydianWidget.appex` (iOS 17+): Updates widget (systemSmall, accessoryCircular, accessoryInline).
  Jailbreak build adds Respring / Userspace Reboot `ControlWidget`s (iOS 18) whose intents run in the extension,
  which carries the app's jailbreak entitlements and spawns the helper itself. Data: App Group defaults written by the
  app (intents and `app.badge`), plus N5's daemon state file in the jailbreak build.
- Helper verb `userspace-reboot` (`launchctl reboot userspace` from the prefix), in policy.c, the fake and README.
- AppIntents weak-linked (`-Wl,-weak_framework,AppIntents`); build.sh fails if objdump shows it linked strongly.
  Intents.swift and WidgetStore.swift are separate files so no `_AppIntents_UIKit` / `_AppIntents_SwiftUI`
  cross-import overlay gets linked into the iOS 15 app.
- App Group `group.com.ryha.cydian` in the app's entitlements (both builds; test_ipa's "get-task-allow only" test now
  allows it too: AltStore-style signers register groups from the app's entitlements).
- Docs: native/intents/README.md, native/widget/README.md, docs/shortcuts.md (recipes), native/README.md pointers.

## Decisions (no one to ask; written down here)

- Check for Updates returns `[String]` (one `Name 1.0 → 1.1` line each), not an AppEntity: entities need queries and
  much more metadata that can't be checked without a phone. The count is Shortcuts' Count action; the dialog says it.
- Install All Updates uses `apply <ids>` (apt install by name), not the helper's `upgrade` (`apt-get upgrade` keeps back
  upgrades that need a new package). At most 256 per run (the helper's limit).
- Export lists packages that aren't Auto-Installed in apt's extended_states (dependencies come back by themselves)
  plus holds and every source. Restore installs the newest versions, not the exported ones (after a re-jailbreak the
  old ones are often gone), skips what no source has and says which.
- Controls run in the widget extension with jailbreak entitlements rather than through `LiveActivityIntent` into the
  app: the latter's metadata (systemProtocols) isn't in any capture I could check.
- The sideload widget extension is built without controls (`-D CYDIAN_JAILBREAK` off) instead of hiding them at run
  time: the IPA then has no jailbreak-only intents anywhere.
- `metadata.py` writes `generator: xcode-tools 27B52` like Xcode, in case iOS checks it.

## References used

- llios (https://github.com/qyang-nj/llios, `articles/BuildAppIntents.md`, `building/app_intents/`): Xcode 17F113's
  build steps, a `.swiftconstvalues` and the `extract.actionsdata` made from it. No licence, so not copied into
  the repo; metadata.py reproduces it exactly (checked by hand, normalising only the generator and resolver order).
- sweetpad (https://github.com/sweetpad-dev/sweetpad, MIT, `sweetpad-cli/src/cli/appintents/`, fixtures from Xcode
  27B52): its fixture pair is in `native/intents/fixtures/` with its licence, and test_intents.py checks it.
  sweetpad's Rust writer has ProvidesDialog = 2 / ShowsSnippetView = 4, but llios' dialog-only capture shows 4 for
  ProvidesDialog, which also fits sweetpad's dialog+snippet capture (6). Cydian uses 4/2.

## Tried and changed

- `text.enumerateLines` in Core.swift: escaping closure on Linux Foundation, swapped for a split loop.
- build.sh's strong-link guard first grepped for `(weak`; objdump prints `, weak)`. Fixed on the first build.
- `ProvidesDialog` flag first 2 (from sweetpad's code); changed to 4 after the llios capture (above).

## Checks run

- `native/intents/test_intents.py` (14 tests): Swift core against the fake helper (check, holds, failed refresh,
  install all + finish:, respring/reboot, add-source links, export, restore jailbreak + sideload + refused files,
  widget snapshot), sideload import link decoded in Python like transfer.js, metadata vs Xcode capture, metadata for
  Cydian's shapes and refusals, the built .deb/IPA (intent sets, widget plist, entitlements), wiring.
- `web/app/incoming-add.test.js`: cydian://add opens Add Source, dist repos, bad URLs ignored.
- helper `test_userspace_reboot_plan`; `test_ipa.py` new `test_intents_checked`.
- Full `make -C native package`: both builds, `mkipa.py check` and `mkdeb.py check` pass; objdump: AppIntents weak,
  no `_AppIntents_*` overlay in the app; the extension has LC_MAIN, minos 17.0.

## Not verified

- **Nothing here has run on an iPhone.** The only device is the 4S (iOS 6), which can't run App Intents, widgets
  or Cydian itself (N6 is blocked on the same thing). So unverified on a device:
  - that iOS (linkd) accepts the hand-made `Metadata.appintents` and lists the intents in Shortcuts / Spotlight /
    Siri. The format matches two Xcode captures, but iOS 27 might want more (e.g. `nlu/`, which Xcode's training step
    writes and we don't: App Shortcuts phrases may match less well in Siri, or the shortcuts may not show).
  - that intents are indexed for an app installed by the jailbreak (in /var/jb/Applications, registered by uicache)
    the way they are for App Store apps.
  - that the widget extension loads (Info.plist keys, `-fapplication-extension` link, `@main WidgetBundle` with
    LC_MAIN and no `_NSExtensionMain`), that the App Group container works for an ad hoc jailbreak app with
    `no-container`, and for sideload signers (AltStore, SideStore, Feather) at all.
  - that the extension's jailbreak entitlements are honoured so the controls can spawn the helper, and that
    `launchctl` is at `/var/jb/usr/bin/launchctl` on Dopamine/palera1n (the verb fails cleanly with exit 126 if not).
  - time limits: Check for Updates and Install All Updates run in the background in the app's process; a slow
    `apt-get update` or a big install may outlast what iOS gives a background intent. The helper is its own root
    process and would finish, but the intent's result could be lost.
  - `IntentFile` as Restore's input from Files / iCloud, and Export's `.json` result saved by Shortcuts.
  - the iOS 15 launch with AppIntents weak-linked (checked only by objdump).
- Upgrade computation ignores apt pinning, architectures and multiple versions of one package from different
  origins: a pinned-down package would show as an update here. I didn't compare it with how web/app/core's Changes
  handles those.
- Check for Updates in sideload mode reads I3's remembered list from UserDefaults; not exercised by a test (needs
  URLSession against sources; the comparison itself is I3's tested `UpdateCheck`).
