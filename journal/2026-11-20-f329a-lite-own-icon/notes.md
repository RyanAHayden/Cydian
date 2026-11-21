# F329a: your own app icon, Lite half

## What was built

- **Source IPA of the running app** (`native/sign/SelfIPA.swift`): no copy of the installed IPA is kept, and none is
  needed. The running bundle is the app as installed, so `SelfIPA.make` zips `Bundle.main.bundleURL` as
  `Payload/<name>.app/` (files stored, not deflated; file modes and symlinks kept). IPASigner drops the old
  signature and profile itself.
- **Signer option** (`SignOptions.ownIconFiles`): file name → PNG, only `IconOwn<slot><pt>x<pt>@<2|3>x.png` names
  and real PNGs (anything else is dropped as it's set). IPASigner writes them over the bundle's files and leaves
  Info.plist alone, so `CFBundleAlternateIcons` stays (the old `icon` option drops it). Not stored in the record.
- **Re-sign + update** (`Sideload.swift` `signing.install {selfIcon}`): renders the picture at every own-set size,
  picks the slot as the jailbreak build does (`OwnIcons.pick`: the set not on screen, unless it holds the picture
  already), builds the source IPA and signs it through the usual `signAndOpen`, so it goes the same way as Lite's own
  update (hosted with `host: true`, or This iPhone). The record's url is `self:bundle`; Re-sign of that record makes
  the IPA from the bundle again (which still holds the picture).
- **Switching** (`AppIcon.swift`): `app.icon` with an own icon in Lite answers `resign_needed:` while the picture isn't
  in a set; once it is (after the update and a reopen), it switches to that set with the public call (iOS's alert).
  `lite_unsupported` is gone. New `app.icon.ready {name} -> {ready, canResign}` for the page.
- **Page** (`screens/appicon.js`): Add is offered in the sideload build too. `pickOwn` (a cell tap, or Choose in Move
  and Scale): jailbreak, or Lite with the picture in place, just sets the pick; otherwise Lite asks "Use This Icon?"
  (it re-signs itself, takes about as long as an update, closes, and switches once opened again) and on Install runs
  `installOnDevice({params: {selfIcon}, host: true})`, the same flow as its own update. Cancel changes nothing; a
  failed run puts the pick back. A new picture shows in Your Icons even when that question is cancelled.
- **LITE sash**: `tools/icons.sh` gained `sash_only` and writes `web/app/icons/sash-lite.png` (the sash and its
  shadow on a transparent 1024 square, from the same `sashed()` SVG). Move and Scale in Lite shows a "LITE Sash"
  switch (on by default) under the title and the sash over the square and the preview; `app.icon.add {sash}` makes
  the shell draw it into the kept picture, so Your Icons, Home's header and the Home Screen all show the same thing.
  I made the PNG by running just those functions of icons.sh (the whole script also rebuilds every other icon from a
  numpy/scipy background, which I left alone).

## Choices

- The brief says "switches to Icon-owna". It uses the a/b pick of the jailbreak build instead: the first picture goes
  in Icon-owna, the next one (while a is on screen) in Icon-ownb. F329 found SpringBoard keeps the picture it last
  drew for a set name, so rewriting the set on screen risks the old picture staying.
- The alert doesn't say the app reopens by itself: after its own update iFizBox doesn't (route.js's banner says "Open
  it again once the new icon appears"). It says it switches to your icon when you open it again.
- The Re-sign of a `self:bundle` record signs the running bundle, not the release IPA, so the picture survives it.

## Checks

- `tools/check.sh` passed (both native builds compile; the new Swift signer test, the page's pickOwn tests and the
  icon size test run in it). The built IPA holds `web/icons/sash-lite.png` where `OwnIcons.sashFile` reads it.
- Spec review: no wrong code found. Its points: the phone check (below); the alert's wording and the a/b slot (both
  deliberate, see Choices); `app.icon.ready`, the `self:bundle` Re-sign and the redraw after Add are what the flow
  needs, so kept; a pick left behind when iOS fails the install later is added to B240.

## Not verified

- **Nothing on a phone.** The whole flow (pick → alert → re-sign → hosted or This iPhone install → reopen → iOS's
  icon alert → Home Screen shows the picture with its sash) wasn't run on the iPhone 15 Pro: its UI lock was held by
  B238 the whole time I waited (over 15 minutes), so the task is blocked with a CONFIRM.
  Unknowns only the phone answers: whether installd accepts the bundle-made IPA (it is the signer's usual input
  shape, checked by the Linux signer test), whether the alternate icon name survives the update, and whether
  SpringBoard draws the new picture for a set after the update.
- `OwnIcons.sashed` and the Move and Scale sash switch's look were not seen rendered (UIKit drawing doesn't run on
  Linux; no Chromium shot of the crop screen was taken).
- A later update from the AltStore source puts the placeholders back in the own sets; the page then shows the pick
  but `app.icon` answers `resign_needed` until it is picked again. Not handled here: filed as B240.
