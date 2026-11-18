# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs both the public
site and the jailbreak app, a native shell around a WKWebView that installs `.deb`s (docs/native.md). It has to
feel native: 120 Hz, real swipe-back. Then (maybe) an IPA with notifications, and Shortcuts for auto-updating.
Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F167** Tapping the status bar scrolls the page to the top in the app, as native iOS apps do (user 2026-11-18: "tapping the top status bar in app should scroll to the top like native ios apps do"). iOS sends that tap to the WKWebView's own scroll view (scrollsToTop), but every page scrolls in its own .page-body, so nothing moves. In the native shell (jailbreak app and sideload IPA), keep webView.scrollView.scrollsToTop = true, implement UIScrollViewDelegate scrollViewShouldScrollToTop to return false and instead call into the page, e.g. evaluateJavaScript("cydianScrollToTop()"); in app.js expose globalThis.cydianScrollToTop = () => scrollToTop(stacks.top()?.page.body) (nav/tabbar.js scrollToTop already does the smooth scroll, the tab re-tap uses it). Make sure no other scroll view in the hierarchy also has scrollsToTop (iOS ignores the tap when more than one does). Also: a sheet or the Search results scroller on top should scroll its own list. Safari (the website) can't get the tap; leave it. Check on the iPhone 7 (ssh 7, tools/ui-7.sh): scroll a long list down, tap the status bar, it glides to the top. | files: native/**, web/app/app.js | test: node test that cydianScrollToTop scrolls the top page's body; a note in journal/ with before/after screenshots from the iPhone 7

### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **F164** (follow-up, low; was a second F155) Open button on the install progress page for sideload/website IPA installs (F151 left them on Return to Cydian): a shell call to launch an installed app by bundle ID (LSApplicationWorkspace openApplicationWithBundleID) and nav/progress.js progressHUD finishing with Open <app> once iOS reports it installed (signing-sheet.js followInstall) | files: web/app/nav/progress.js, web/app/signing-client.js, web/app/signing-sheet.js, native/Sources/** | after: F151
- [ ] **F169** (follow-up, low) Plain Install in the sideload build (signing-client.js installOnDeviceOnce without after, signAndInstall) follows iOS's install too (signing-sheet.js followInstall when signing.install answers a bundleId, not for host/Cydian itself), so it also ends on F155's Open <app> instead of Done + Return to Cydian | files: web/app/signing-client.js, web/app/signing-client-device.test.js | after: F155
- [ ] **R18** (follow-up, low) Check that progress.css's blinking cursor (progress-blink, steps(1, end) on opacity) blinks on iOS 15 in the app: F166 found WebKit on iOS 15 leaves a steps() transform animation standing still once Core Animation runs it; if opacity does the same, hold keyframes with linear timing as ios6.css @keyframes hud-spin does | files: web/app/progress.css
### Parked
- [ ] **F21** (later) Ideas from feature research, journal/2026-11-17-feature-research, not scheduled: iPad layout and keyboard shortcuts (⌘F search, ⌘R refresh; Zebra #1892); block authors/packages from lists and upgrades (Zebra #1037, #998); 'worked for me' compatibility votes per package and iOS version (Sileo #249; needs moderation); malware check of installed packages against the F19 list; Bootstrap Install mode for broken bootstraps (Irisin); uicache from the app; localisation; self-update for the IPA build. See `journal/2026-11-17-feature-research/reports/Sideloader and package manager features.md`.
- [ ] **F15** (follow-up, later) idevice install route (R5, docs/sideload.md): IDeviceKit + idevice (MIT, xcframework built from source) behind an Advanced switch: import a pairing file, LocalDevVPN loopback, AFC upload + installation_proxy with progress. The one route with no internet and no TLS, and it can update Cydian itself. | files: native/sideload/idevice/**
- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F120** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **R15** (follow-up, later) On the iPhone 7 (ssh 7, Cydian installed), with the user present: sign in to Chariz (or Havoc) in Cydian and check the sheet closes on sileo://authentication_success and keychain.set stores the token; then Download & Install the free betterAlarm (com.noisyflake.betteralarm, Chariz, no purchase) and check cydian-helper install-paid installs it (dpkg -l ii) and the .deb is gone from Library/Caches/com.ryha.cydian/paid and /var/tmp; optionally set a passcode and check keychain.get prompts. The parts of R10 that need the user's own vendor login; everything else is in journal/2026-11-18-r10-*. | files: journal/**
