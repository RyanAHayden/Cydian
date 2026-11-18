# F83: the sideload app takes other sideloaders' links

## What I did

- `web/app/core/otherlinks.js` (new, pure): `OTHER_SCHEMES` / `OTHER_APPS`, `parseOtherLink(link)` ->
  `{ app, scheme, action: "source" | "install" | "other", url }`, and the switch (`otherLinksOn` / `setOtherLinks`,
  localStorage `cydian.otherLinks`, absent = on).
- `native/Info-sideload.plist`: a second CFBundleURLTypes entry (`com.ryha.cydian.other`) claiming altstore,
  altstore-classic, sidestore, feather, ksign, esign, scarlet, gbox, trollapps, stikstore. Sideload build only.
- `native/Sources/App.swift`: `OtherLink.accepts` (those schemes, 8 KB cap) beside `IncomingLink.accepts` in
  `Incoming.receive`, so the shell hands them to the page the same way as cydian:// links. I kept it in App.swift
  rather than `native/sign/Handoff.swift` (IncomingLink's home) because Handoff.swift wasn't on the task's file line.
- `web/app/incoming.js`: after Cydian's own links, `parseOtherLink`. On: source -> `#/sources/manage/sources` then
  `manage.addSource` filled in; install -> `#/installed/myipas` (Install IPAs), an "Install IPA" alert naming the app
  and file, Install -> `signAndInstall` (the same path as an AltStore app's Install row). Off, or an "other" link
  (Feather's import-certificate, SideStore pairing, AltStore backup callbacks): `handBack` calls `app.openURL` with
  the original link; when it isn't opened, or the same link comes straight back within 10 s (iOS picked Cydian, so
  opening it again lands here: loop guard), an alert "<App> Link" says it was for that app and why Cydian can't
  pass it on.
- `web/app/screens/settings.js`: `sideloadingSection()` (sideload mode only), header Sideloading, switch "Open Other
  Apps' Links", footer saying the limit (iOS picks one app per scheme; off can't give links back, Cydian re-opens and
  otherwise says it was for another app). Placed after Signing. I drew it here rather than as a `core/settings.js`
  SETTINGS row because core/settings.js wasn't on the file line.

## Link shapes (sources fetched 2026-11-17)

- AltStore `AltStore/SceneDelegate.swift`: host `source` / `install`, query item `url` (names lowercased).
  Info.plist registers `altstore` and `altstore-com.rileytestut.AltStore`.
- SideStore `SideStore/DeepLinks/URLHandler.swift`: the same two hosts; scheme `sidestore`.
- Feather `Feather/FeatherApp.swift`: `validatedScheme(after: "/source/")` and `"/install/"` (raw https URL after it).
- Ksign (Nyasami/Ksign, a Feather fork) `Ksign/FeatherApp.swift`: the same, scheme `ksign`.
- TrollApps, StikStore, altstore-classic, ESign add, Scarlet repo, GBox AddSource: as F8/F50 found them
  (core/handoff.js comments).
- ESign install (`esign://install?url=`) and Scarlet install (`scarlet://install=`): closed source; handled by the
  generic rule (first word install/download, or an .ipa URL).
- Not claimed, on purpose: `livecontainer` (LiveContainer launches its apps through its scheme; claiming it could
  break that), `apple-magnifier` (the system Magnifier, which TrollStore borrows), `altstore-pal`.

## Checked

- `node --test web/app/core/otherlinks.test.js` (9 tests: every shape above, bad URLs, credentials, other
  schemes, plist/App.swift/JS scheme lists equal, the switch default) and `web/app/incoming-other.test.js` (8 tests:
  source, install, cancel, off + opened, off + not opened, the loop guard, an "other" link while on, not ours).
- Headless Chromium with a stub `cydianNative` (mode sideload): Settings shows the Sideloading group with the switch
  on and the footer, after Signing.
- The gate (`tools/check.sh`) via `agent-runner done`.

## Not verified

- No link opened on an iPhone: no sideload build on a device here. The user is to try AltStore / SideStore / Feather
  source links on the iPhone (as the brief says).
- Which app iOS picks when Cydian and AltStore/Feather both claim a scheme: undocumented by Apple, so not checked.
  The loop guard assumes iOS hands Cydian's own re-open back to Cydian; if iOS instead fails it, the
  "opened: false" path gives the same alert.
- The Swift change wasn't compiled here unless the gate's native build ran (it needs the iOS toolchain); it's a
  small enum mirroring IncomingLink.
- ESign/Scarlet install link forms: those apps are closed source.
