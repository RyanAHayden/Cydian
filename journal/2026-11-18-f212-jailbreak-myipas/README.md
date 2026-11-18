# F212: My IPAs in the jailbreak app

## What I did

- `web/app/core/myipas.js`: `libraryMode(mode)` ("site" | "sideload" | "jailbreak") and `nativeLibrary(mode)` beside
  the existing rules. `stateOf`/`libraryRows` take `jailbreak`: a readable IPA there is "Ready to install" (not "Not
  signed yet": that app doesn't sign). `holdActions` in jailbreak: Install, Delete. `deleteSheetTitle` in jailbreak:
  "The IPA is / n IPAs are deleted from this iPhone." (no signed copies).
- `web/app/screens/myipas.js`: `listMode()` = `libraryMode(detectMode())`; `site()` is now `listMode() === "site"`,
  so the jailbreak app uses the shell's library (library.list/pick/add/delete) instead of the website's
  IndexedDB/localStorage one. `localSigning()` is unchanged and still gates Sign Options (the page route) and the
  Browse footers' "signed with your certificate".
  - Empty list in jailbreak: "No IPAs yet. Tap Add to choose one in Files or download one, or put IPAs in
    /var/mobile/Documents." (no AltStore/SideStore/Feather, per the no-sideload-options rule).
  - Add: the app's Files / From URL sheet (library.pick / library.add), as the sideload app.
  - An IPA's page in jailbreak (`jailbreakIpaGroups`): Details (Version, Bundle ID, Size, Requires, Extensions, File)
    and Delete; no Status/Sign Options/Sign Now/Save Signed IPA.
  - Install in jailbreak (`jailbreakInstall`): Install IPA's console (screens/ipa-install.js `openIpaInstall`, the same
    one a URL or a shared file uses) with a stand-in bridge (`helperBridge`) that turns its `ipa.install` into
    `library.helperInstall {file, stream}`, as share.js does for share.ipaInstall.
- `native/Sources/MyIPAs.swift` (outside the task's file list, but the page can't work without it). **The brief's "the
  native library is registered in every build" was only half true**: the calls are registered, but on the phone the
  first build answered library.list with "jailbreak: the jailbreak app installs IPAs through its helper"
  (`SignBridge.run` refuses in jailbreak mode, and `add`/`pick` had their own refusals). Now list and delete go through
  `MyIPAs.anyMode` (SignBridge.run without that guard), add and pick lost their guards; options, sign, install and
  export still refuse in jailbreak mode (they sign). And a new `library.helperInstall`.
  The library's `library.install` signs with the user's certificate (Sideload.ready refuses in jailbreak mode), and
  `ipa.install` only takes http(s) URLs. The new call copies the library file into the helper's IPA directory
  (`ShareInbox.stage`, `SharedInbox.dirs`) and runs `ShareRun.installIPA` (ifizbox-helper install-ipa), the
  share.ipaInstall path; the staged copy is removed afterwards, the library keeps its file.
- Home: **decided yes, the jailbreak app gets the Install IPAs tile** (`home.js ipasTile` returns it in every build).
  It was null only because "the jailbreak app has no such page" (F79); since F209 + this task it has, and it is the
  only way into Browse-by-AltStore-app and My IPAs from Home there.
- Tests: `core/myipas-jailbreak.test.js`, `screens/myipas-jailbreak.test.js`; `home.test.js` updated for the tile.

## On the iPhone 7

Built the .deb from this worktree (0.9.7-1376) and installed it with apt (it went over 0.9.7-1378, another slot's
newer build; `--allow-downgrades`). Test IPAs: not the fixture `tiny-ifizbox.ipa`, whose bundle ID is
`com.ryha.ifizbox` (installing it would replace iFizBox itself), but a copy of its binary with an XML Info.plist for
`com.ryha.ifizbox.f212test` ("F212 Test"), as F212Test.ipa, F212Other.ipa and F212Third.ipa in /var/mobile/Documents.

Screenshots in `ref/7/screens/f212-*.png` (gitignored, main checkout's ref/).

- First build: the page showed "The jailbreak app installs IPAs through its helper" under My IPAs: library.list refused
  (above). Fixed natively, rebuilt (still 0.9.7-1376: same commit count), reinstalled.
- List: the three IPAs, "1.0 · 1.5 KB · Ready to install", footer "3 IPAs · 4.4 KB" (`f212-list`).
- Swipe left on a row: red Delete; its tap: sheet "The IPA is deleted from this iPhone." / Delete IPA; confirmed: the
  row went and the file was gone from /var/mobile/Documents (`f212-swipe*`).
- Hold on a row: sheet with Install and Delete only (`f212-hold`).
- Install of the plain test IPA: Install IPA's console ran Copying the IPA, Unpacking, Installing (AppSync Unified),
  then installd refused it: "Application is missing the application-identifier entitlement" (`f212-install`). That's
  my hand-made test binary (no entitlements), not the route: the file did reach the helper and installd. The library
  kept its file, as intended.
- Signed a copy of the binary on the phone with `ldid -S` and an `application-identifier` entitlement (F212Signed.ipa):
  Install from its page's nav bar: "Installed F212 Test (com.ryha.ifizbox.f212test)", Done, Reload Data
  (`f212-install2`).
- Edit: red minus on every row, taps ticked both, toolbar Deselect All / Delete (2); sheet "2 IPAs are deleted from
  this iPhone." / Delete 2 IPAs; both files gone (`f212-edit*`).
- An IPA's page: header, Details (Version, Bundle ID, Size, Requires, File), the /var/mobile/Documents footer, Delete;
  Delete there: same sheet, back to the list (`f212-page*`).
- Empty list: "No IPAs yet. Tap Add to choose one in Files or download one, or put IPAs in /var/mobile/Documents." and
  Edit hidden (`f212-empty`).
- Add: Files / From URL; Files opened the iOS document picker (cancelled) (`f212-add`, `f212-files`).
- Home: the Install IPAs tile under Browse, opens the page (`f212-home`).

- The install was recorded in Installed > Apps as "F212 Test · My IPAs"; I removed the test app there (swipe, Delete
  F212 Test): no F212Test.app left under /var/containers/Bundle/Application. `ifizbox-helper uninstall-app` over ssh
  refuses ("the calling process isn't the installed app"), so that's the way to clean up.
- Cleanup: /var/mobile/Documents holds no test IPAs, the helper's ipa directory is empty, /tmp's .deb removed. By the
  end another slot had installed its own build (0.9.7-1378) over mine; I left that.

Found on the way, not changed: the list doesn't re-read Documents when you come back to it (a file copied in over
ssh only showed after another list call). It's the same in the sideload build; not filed, the page reloads on any
change it makes itself.

## Not verified

- From URL (library.add) in the jailbreak app: the phone has no Wi-Fi route to a test server I could type quickly, and
  typing a URL means tapping keyboard keys one by one. The native call is the sideload build's, with only the mode
  guard removed.
- Picking a file in the Files picker and adding it: the picker opened, but /var/mobile/Documents isn't in Files and
  no IPA was in iCloud/On My iPhone to pick.
- Install's Cancel while the helper runs, and an IPA with app extensions.
- Real-world IPAs (decrypted App Store apps): only my test IPA, which needed an entitlement; installd's checks for
  others are the helper's business (as for ipa.install).
