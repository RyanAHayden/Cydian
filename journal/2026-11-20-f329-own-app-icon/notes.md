# F329: your own app icon

## What was built

- **Page** (`web/app/screens/appicon.js`, loaded on demand by `screens/settings.js`): Theme > App Icon > Light / Dark
  gets a "Your Icons" group with an Add tile. Add is a file input (`image/png,image/jpeg,image/heic,image/heif`); iOS
  offers Photo Library, Take Photo and Choose File. Then iOS 6's Move and Scale: picture behind black bars, the
  square with the icon's rounded corners (everything outside dimmed), "Move and Scale" on top, Cancel / Choose with a
  44 px Home Screen preview between them; one finger moves, two pinch; the picture always covers the square. Choose
  sends the picture's bytes and the square (picture px) to the shell. Cells pick like theme icons; a left swipe shows
  iOS 6's red Delete; deleting a picked one puts that mode back on its theme's icon. Labels come from the file name
  ("Sunset.jpg" → Sunset; iOS's "image.jpeg" → "Icon <n>").
- **Settings** (`core/settings.js`): lightIcon/darkIcon `accepts` own names (`isOwnIcon`: `own[a-z0-9]{1,16}`), and
  `iconFor` passes them through. Small `get`/`set` hook for a value outside a setting's option list.
- **Shell** (`native/Sources/AppIcon.swift` OwnIcons): `app.icon.list/add/remove/decode`. Pictures are kept as 1024 px
  PNGs in Application Support/<bundle id>/AppIcons with index.json; Bridge.swift serves `appicon/own….png` from there,
  so Home's header and the theme preview show them like any icon.
- **Applying (jailbreak build)**: Info.plist lists two loose-PNG alternate sets, Icon-owna and Icon-ownb
  (`icon/alternates.py OWN_SLOTS`, placeholders copied by build.sh). The app draws the picture at 120/180 px, the
  helper's new `own-icon a|b <dir>` (`native/helper/ownicon.h`) copies it over the set not on screen, and the app
  switches to that set quietly (no alert). If a set was written again, the app also asks for
  `own-icon-refresh` (a detached `uicache -p` of the app) once it goes to the background.
- **Lite**: not done here; split as **F329a** (needs a source IPA of the running app and a signer option that
  replaces the own-set files and keeps CFBundleAlternateIcons). The page doesn't offer Add in the sideload build and
  `app.icon` answers `lite_unsupported` there.

## Findings (iPhone 7, iOS 15.8.8)

- `uicache -p` on iFizBox closes the running app (tested by hand: rc 0, the process gone). So a design that changes
  Info.plist (new alternate names per picture) and registers again each time would close the app on every pick.
  Hence the two pre-listed sets.
- SpringBoard keeps the picture it last drew for a set name. Writing new PNGs into a set it already drew and
  switching back to that name shows the **old** picture (seen: slot A rewritten with "TWO", Home Screen kept
  "THREE"). The first use of a set since the app was registered shows the new picture at once. A `uicache -p`
  brings the new picture (checked by hand and through the helper). Even the .deb postinst's own `uicache -p` left a
  stale picture once, so the refresh isn't fully understood.
- Hence: a new picture always goes into the set **not** on screen (the switch is a real change of name), the slot is
  chosen by a byte compare with the bundle's files (a .deb upgrade puts the placeholders back; a saved "slot holds X"
  record went stale that way), and a rewrite schedules the background refresh. Full cycle checked: pick Night (slot B,
  which showed Dusk) → Home → the app is closed in the background → Home Screen shows Night.
- Canvas: drawing the shown `<img>` onto a canvas drew **nothing** for some pictures (a 1200×1200 JPEG), with no error,
  even onto a fresh canvas with no source rect; a 1600×1200 one worked. A probe with `createImageBitmap`/`decode()`
  crashed the web content process. So the page never rasterises: the shell crops (UIImage draw, which also handles
  EXIF orientation and HEIC), and the preview is a clipped, transformed copy of the `<img>`.
- Move and Scale measured the square while sliding in (translateY(100%)), which put the picture off screen: positions
  are now relative to the screen element. `outline` ignores border-radius on iOS 15: the mask edge is an inset shadow.
- The iOS file picker once failed with "Internal error / The requested app extension could not be found" right after a
  .deb reinstall; the file input then didn't open again until the app was relaunched. System behaviour, not ours.

## Tried and dropped

- Patching Info.plist in the helper + uicache per apply: closes the app every time.
- A UserDefaults record of which picture each slot holds: wrong after a .deb upgrade; replaced by the byte compare.
- Page-side 1024 px canvas render: blank pictures on iOS 15 (above).

## Checks

- `node --test web/app` (2605 pass), `screens/appicon.test.js` (crop maths: start, pan limits, zoom about a point,
  source rect inside the picture; stored list; labels; settings accept own names), `native/helper/test_ownicon.py`
  (copy, refusals, symlinks, other callers, refresh starts uicache detached), `native/test_icons.py` (Info.plist sets,
  loose own sets in the bundle check).
- iPhone 7: added Sunset from Files, Move and Scale (pan stops at the edge), Choose → Home Screen shows it
  (`ref/7/screens/f329-home2.png`), Home's header shows it; Delete by swipe; Night/Dusk/Sunset cycles above
  (`f329-home15.png`). Left the phone on Match Theme (Classic icon), F329's .deb installed.

## Not verified

- **Lite flow**: not built (F329a); needs the iPhone 15 Pro or the user.
- **Pinch zoom on the phone**: phonectl sends one finger only; the zoom maths are unit-tested, the two-finger path
  wasn't driven.
- **Photo Library and HEIC**: only Choose File with JPEGs was driven; the HEIC path (`app.icon.decode` when the web
  view can't draw it) wasn't exercised because no HEIC picture was on the phone.
- **iOS 18+ dark Home Screen**: own sets are loose PNGs without a dark look; with an own icon in either mode the app
  shows the icon of the tone on screen (as iOS 15-17). Not checked on an iOS 18 jailbroken phone (none here).
- **The one lost switch**: right after a .deb reinstall, a pick made 1 s after the launch-time apply showed the
  previous picture after the background refresh; it was right after the next switch. Not reproduced since.
