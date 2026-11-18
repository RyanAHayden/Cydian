# native/share/: the share sheet and Open in iFizBox (N9)

What Safari, Files, AirDrop and Mail can hand iFizBox, and what each build does with it:

| shared | jailbreak build | sideload build |
|---|---|---|
| link to an APT repo (or any other http(s) page), `cydia://url/…`, `sileo://source/…`, `zbra://sources/add/…`, `installer://add/…` | Add Source's alert, filled in (N8's `ifizbox://add?url=…`) | same |
| link to an AltStore source (`….json`), `altstore://source?url=…`, `sidestore://…`, `feather://source/…` | Add Source's alert (it takes app sources too) | same |
| .ipa file or link | "Install?", then `ifizbox-helper install-ipa` in the Install IPA console (needs AppSync Unified, or ldid to sign ad hoc; without either iFizBox says so before copying anything) | into My IPAs, then "Install?": signed on the phone with the user's own .p12 + .mobileprovision and installed through the in-app server (Sideload.swift, I6/F14). No certificate yet: the IPA waits in My IPAs (F77) |
| .deb file or link | the Confirm sheet for that file (`ifizbox-helper simulate-deb`: `apt-get -s install ./file.deb`, dependencies from the sources), then the console (`install-deb`) | an alert: a .deb needs a jailbreak |
| anything else | an alert saying what iFizBox takes | same |

Installed IPAs are remembered with their version (core/installed.js `recordInstall`), so I3's updates find a newer
one when a source lists the same bundle ID. No server of ours anywhere (R5, docs/sideload.md).

- `Share.swift`: the classifier (a file's first bytes first: an ar archive is a .deb, a zip whose first entry is
  `Payload/` an IPA; then the extension; links by their path and repo managers' schemes), the router per mode, the
  `ifizbox://shared?route=…` link the page reads (web/app/core/share.js), staging into the helper's folders, and the
  helper runs. Foundation only: `test_share.py` builds it on Linux with `tests/main.swift` and runs it against
  `../fake/ifizbox-helper` and a fake signer.
- `App/ShareBridge.swift`: the phone's side. `SharedInbox.receive` (App.swift's `Incoming` calls it first) takes files
  iOS hands over (the document types in `../Info.plist` and `../Info-sideload.plist`) and `ifizbox://share?url=…` from
  the extension; `share.*` bridge calls for web/app/share.js and screens/sharedeb.js.
- `Extension/ShareViewController.swift`, `Info.plist`, `entitlements*.plist`, `build.sh`: `PlugIns/iFizBoxShare.appex`
  (`com.ryha.ifizbox.share`), the same in both builds. It takes one web link or text and opens
  `ifizbox://share?url=…|text=…` through the responder chain's UIApplication (an extension has no
  `UIApplication.shared`), then closes. Files don't go through it: the app's own document types put iFizBox in the
  share sheet's app row for .ipa and .deb.
- UTTypes: `com.apple.itunes.ipa` is the system's; `org.debian.deb-archive` is imported (as Sileo and Zebra do). The
  jailbreak build now declares the `ifizbox` URL scheme too, for the extension.

None of this has run on an iPhone yet (no jailbroken test phone): see journal/2026-11-17-n9-share-sheet/.
