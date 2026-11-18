# B46: Installed's Delete uninstalls where it can, and says so where it can't

User 2026-11-18: "I swiped and deleted an app in Installed and it just got rid of the icon, I had to remove it again."
Delete only dropped iFizBox's record (removeInstall / signing.forget) while the app stayed on the phone.

## What changed

- **Helper verb `uninstall-app <bundle id>`** (`native/helper/policy.c`, `ipa.c`, `main.c`, README):
  - The id must pass `helper_ipa_bundle_id_ok`.
  - `helper_app_find` reads installd's containers the way `app-versions` does (real directories only, `lstat`,
    `O_NOFOLLOW`). The app has to be there, so a system app, or anything in `/var/jb/Applications` (iFizBox itself),
    is refused with exit 64.
  - Then it calls `LSApplicationWorkspace uninstallApplication:withOptions:`. Progress goes to fd 3
    (`pmstatus:<id>:10:Removing`, `:100:Removed`) and `Uninstalled <id>` to stdout. installd saying no is exit 1.
  - Off iOS a stand-in prints `uninstall <id>`, and an id ending in `.refused` fails.
  - `entitlements.plist` gained `Uninstall` and `UninstallForLaunchServices` in the allowedSPI list.
- **`backend-native.js` `uninstallApp(id, onEvent)`**: jailbreak build only (inside `queueCalls`). It runs the verb.
  A non-zero exit becomes `BackendError("helper")`, with the helper's reason turned into a sentence
  (`uninstallError`).
- **`native/Sources/Sideload.swift` `signing.isInstalled {bundleIds}`**: returns `{installed: {id: bool|null}}` from
  `Workspace.isInstalled` (applicationIsInstalled:). This is how the sideload app learns what iOS reports as installed.
- **`screens/installed.js`**:
  - `deleteAction(r, {mode})` picks the label and action for each mode:
    - The jailbreak app, when I4's `actual` says the app is installed: **Delete**, kind `uninstall`, confirm button
      `Delete <App>`.
    - The jailbreak app, `actual === null` (the app is already gone): **Remove from List**, with the line
      "<App> is no longer on your iPhone."
    - The sideload app, when the shell reports the app installed: **Remove from List**, kind `installed`. It only
      shows a "Still Installed" alert and drops nothing, so a row for an installed app is never hidden.
    - Everything else (the site, the sideload app otherwise, the jailbreak app when versions can't be read):
      **Remove from List**, with "Deleting the app itself is done from the Home Screen."
    - iFizBox's own row: null.
  - `confirmDelete` puts the iOS 6 action sheet up first: the note as its title, then the red button and Cancel.
    It is used by the swipe's button (now labelled from `deleteAction`), the hold sheet, and the app page's row,
    whose footer now comes from the same note.
  - `runDelete` shows `liveHUD("Deleting <App>")`, with the helper's pmstatus text as the label. It ends on
    `done("Deleted")`, then drops the record and reloads the list. On failure it hides the HUD, alerts
    "Couldn't Delete <App>", and keeps the record.
  - `REMOVE` is now the string "Remove from List". `DELETE` ("Delete") is new.
- **Tests**:
  - `native/helper/test_uninstall.py`: the plan, refusals, the whole chain on Linux, and that a symlinked container
    doesn't count.
  - `web/app/screens/installed.test.js`: four B46 tests (label and action per mode, the confirm sheet and Cancel,
    `withInstalled`/`statusText`/`uninstallError`, and the native backend's `uninstallApp`). One B36 footer
    assertion was updated to the new wording.

## Decisions (unattended, no one to ask)

- In the jailbreak app, Delete only uninstalls when I4's `actual` is a version string. With no `actual` (the helper's
  `app-versions` failed), iFizBox can't tell whether the app is there, so it offers Remove from List rather than
  pretend.
- In the sideload app, "whatever the shell reports as installed wins": an app iOS still has can't be removed from the
  list. Removing the record would hide the row of an installed app, which the brief forbids. The alert tells the user
  to delete it from the Home Screen, after which Remove from List works.
- The uninstall check lives in the helper (installd's containers), not only in the UI, so a bad caller can't uninstall
  system apps.

## Tried, failed

- First gate run: `test_helper.py test_entitlements` pins the allowedSPI list. I updated it to include the two new
  values (one line, outside the brief's files but required by the gate).

- **On-phone test (iPhone 7).**
  - Built the .deb (`native/build.sh deb`, 0.9.6-1335) and installed it: OK.
  - Made a tiny test IPA (`native/testkit.py ipa()`, `dev.ifizbox.b46test`) and served it through a reverse tunnel.
  - Opened `ifizbox://install?url=…` and tapped Install. iFizBox went to the Home Screen and never requested the
    IPA (the server only logged my own HEAD). Filed as **B50**.
  - The phone has no AppSync Unified, so a stub ad hoc app probably wouldn't install anyway.
  - The only apps in `/var/containers/Bundle/Application` are Apple's removable apps. I didn't uninstall one of those
    on the shared test phone, because it couldn't be restored without an Apple ID.
  - The on-phone check is filed as **R21** (after B50).
  - Screenshots: `ref/7/screens/b46-install-alert.png`, `b46-install-result.png`, `b46-reopen.png` (in the main
    checkout's `ref/`, gitignored).

## Not verified

- **The real uninstall on iOS**:
  - whether `uninstallApplication:withOptions:` with a nil options dictionary works when called as root by the helper;
  - whether the `Uninstall`/`UninstallForLaunchServices` allowedSPI entitlements are enough (installd may want
    others);
  - whether SpringBoard drops the icon without a `uicache`.
  - Why: no user-installed test app could be put on the iPhone 7 (above). R21 covers it.
- **The Delete UI on a phone**: the swipe label, the confirm sheet, the HUD, and the record dropping after the
  uninstall, all on screen. No remembered app was on the phone to show the Apps page. Node tests cover the logic only.
- **`signing.isInstalled` in the sideload build**: it compiled as part of `build.sh deb` (same Sources), but no
  sideload phone ran it.
- I left the HTTP server and SSH tunnel to stop at their own 30-minute `timeout`. I didn't keep their pids, so I
  couldn't kill them by pid, and I don't kill by pattern.
