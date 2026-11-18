# B8: links out of the app

What I did:
- `native/Sources/App.swift`: `WebController` is now the `WKUIDelegate` too. `decidePolicyFor` allows
  `cydian:/about:/blob:/data:` and subframes; any other main-frame URL is cancelled and opened with
  `UIApplication.shared.open`. `createWebViewWith` (window.open) opens the URL the same way and returns nil.
  The rules live in a new `enum LinkOut` (inside/never scheme sets, `open`).
- `native/Sources/Bridge.swift`: `app.openURL` widened from https/itms-services to any scheme `LinkOut.canOpen`
  accepts (not cydian, about, blob, data, javascript, file), so feather:// and friends work through it too.
- `docs/native.md`: "Fixed in B8" paragraph under "Links out of the app".

Decisions (unattended run, nobody to ask):
- `data:` added to the inside list next to the brief's `cydian:/about:/blob:`: a data: main-frame load is the
  page's own content, and iOS has nothing to hand it to.
- Plain `http://` main-frame navigations also go to iOS (Safari), same as https.
- Subframes are always allowed, so any iframe the page uses keeps working as before.

Checked: `make -C native package` builds Cydian.deb and Cydian.ipa with the change (Swift compiles for both).

**Not verified**
- Nothing tapped on a phone: no iOS 15+ device reachable from the run (the 4S is iOS 6 and can't run the shell).
  Still to check per docs/native.md: Home > Source Code opens Safari; AltStore Get / Open in Feather opens Feather
  (or nothing if not installed); a signed Install link brings up iOS's install prompt; More Information opens
  Safari and Cydian stays where it was; location.href to https no longer replaces Cydian's UI.
- No unit test: the delegates are Swift-only UI code, with no Swift test harness in the gate.
