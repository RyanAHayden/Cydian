# R21: B46's Installed Delete, end to end on the iPhone 7

Result: **it works.** The helper's `uninstall-app` removed a user-installed app through installd, as root, with the
entitlements B46 added. No code change was needed. One small UI bug turned up and was filed as **B52**.

## Setup

- **AppSync Unified.** akemi's repo (cydia.akemi.ai) answered Cloudflare 522 for Packages and Release. I took AppSync
  Unified 116.0 from its upstream GitHub release instead (`ai.akemi.appsyncunified_116.0_iphoneos-arm64`, rootless,
  github.com/akemin-dayo/AppSync release 116.0) and installed it with `sudo -n apt-get install -y`.
  - Its postinst restarted installd and said a userspace reboot might be needed once. It wasn't: the install below
    worked without one.
  - **AppSync Unified stays installed on the phone**, because later IPA tests need it.
    `sudo apt-get remove ai.akemi.appsyncunified` takes it off.
- **The app.** I built the .deb from this branch (main at 438fa14, which has B50): `com.ryha.ifizbox 0.9.7-1378`.
  - Another task installed its own build (1376, without B50) at 18:36, while I was waiting for the screen lock. I put
    1378 back on before testing.
  - The phone is left on 1378.
- **The helper can't be run over ssh.** Its caller check wants iFizBox as the parent process, so every helper step
  here went through the app's UI.
- **Test IPA.** I made it with `native/testkit.py ipa("dev.ifizbox.r21test", "R21Test")` and served it from the
  desktop at 127.0.0.1:8721, through `ssh -N -R 8721:127.0.0.1:8721 7`.

## What happened (screenshots in the main checkout's `ref/7/screens/`, gitignored)

1. **Lock wait.** The UI lock was held by ROT, then F214, then F212, for about 55 minutes. I got it at 18:40.
2. **First install link, wrong build.** `ifizbox://install?url=…R21Test.ipa` showed "Can't Install Here"
   (`r21-install-result.png`). The phone was running 1376 at that point (above).
3. **Install link on 1378 (B50 checked on the device).** I opened the same link again.
   - Install opened the progress page: Downloading, Copying, Unpacking, Installing (AppSync Unified).
   - The server logged the GET, so B50's fix works on the phone.
   - installd then refused the app: "Application is missing the application-identifier entitlement"
     (`r21-install-result2.png`). The testkit binary has no signature at all, and AppSync doesn't cover that.
4. **Fakesigned install.**
   - On the phone, I signed the binary with `ldid -Sent.xml` (entitlements `application-identifier`
     `R21TEAM000.dev.ifizbox.r21test`, the team id, `get-task-allow`).
   - I zipped it back into a new IPA (`R21TestSigned.ipa`).
   - A second link while the first progress page was still open did nothing: the alert came up, but Install started no
     download. I closed the page with Done and opened the link again.
   - This time: "Installed dev.ifizbox.r21test" (`r21-install-result4.png`). The app landed in
     `/var/containers/Bundle/Application/9104CA15-…/R21Test.app`.
5. **Installed > Apps.** R21Test showed up next to "F212 Test" (`r21-apps.png`).
   - Swiping left showed **Delete**, not "Remove from List" (`r21-swipe.png`), so I4's `actual` was read.
   - Tapping it put up the action sheet "Delete R21Test" / Cancel, with no title. That is by design: `note: null`
     for the uninstall kind (`r21-confirm.png`).
6. **Delete R21Test.**
   - The first screenshot after the tap already shows the "Deleted" HUD with the row gone (`r21-hud1.png`), and then
     the list with only F212 Test (`r21-after.png`).
   - The phone afterwards:
     - the container directory is gone (`ls` "No such file or directory"), and no R21Test.app is left in any container;
     - `uicache -l` doesn't list `dev.ifizbox.r21test` any more, while it still lists `com.ryha.ifizbox.f212test`;
     - SpringBoard's `IconState.plist` (rewritten at 18:44, when I deleted) has `com.ryha.ifizbox.f212test` on page 2
       but no r21test. The Home Screen page 2 shows no R21Test icon (`r21-springboard.png`). **No uicache was
       needed.**
   - Opening Apps again still shows only F212 Test (`r21-apps-after.png`).
7. **Bug (B52, low).** Back on the Installed root, the Apps cell still says "2 apps installed from an app page"
   (`r21-installed-after2.png`).
   - Cause: `load()` reads `appCount` once, and `runDelete` only reloads the Apps page.
   - Filed rather than fixed: this task is research, with no product change.

## Answers to the brief

- **Do the `Uninstall`/`UninstallForLaunchServices` allowedSPI entitlements cover
  `LSApplicationWorkspace uninstallApplication:withOptions:` (nil options) as root?** Yes. The helper's call removed
  the app, and installd, LaunchServices and SpringBoard all dropped it.
- **HUD, row and record:** the "Deleted" HUD shows, and the row goes. The record goes too: the Apps page, reopened,
  doesn't list it.
- **B50's install link on the device:** it works (download, then helper install, then remembered in Installed > Apps).

## Also done

- `docs/iphone7.md`: new section, "Test IPAs: AppSync Unified and a fakesigned app". It covers AppSync being
  installed, the application-identifier requirement and the ldid recipe.
- Removed my temp files on the phone (`/tmp/r21sign/`, `/tmp/r21-iFizBox.deb`, `/tmp/appsync.deb`).

## Not verified

- **The live "Deleting R21Test" HUD and its pmstatus label ("Removing").** The uninstall finished before the first
  screenshot came back over ssh, which takes about a second. Only the final "Deleted" state was captured.
- **Delete from the hold sheet and from the app page's row.** I tested only the swipe's button. The other two use the
  same `confirmDelete`/`runDelete`.
- **The failure path on a device** ("Couldn't Delete <App>"). There was no safe way to make installd refuse.
- **Whether the root's stale app count fixes itself after an app relaunch.** I didn't kill the app, because there is
  no pid-safe way through ui-7.sh. B52 covers the count.
- **Stopping the HTTP server and the reverse tunnel.** I started them as background commands without their pids, so
  they stop at their own `timeout 1800` (by 19:11) rather than by a kill.
