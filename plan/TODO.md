# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs both the public
site and the jailbreak app, a native shell around a WKWebView that installs `.deb`s (docs/native.md). It has to
feel native: 120 Hz, real swipe-back. Then (maybe) an IPA with notifications, and Shortcuts for auto-updating.
Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)


- [ ] **F170** iFizBox rename 1/3: one source for the name, every visible name, the new icon (user 2026-11-18: "Cydia" is a registered trademark of SaurikIT, US reg. 3768836, covering exactly this kind of software, and "Cydian" is one letter off; the user renamed the project iFizBox: "get rid of all cydian references and replace them with iFizBox and update the site and pages to use ifizbox.com"; "should those references not all be hardcoded but have a ref to the name so a future change would be easier"; IDs: "Change to com.ryha.ifizbox"; GitHub repo: rename it). Add one brand source the code reads instead of literals: web/app/brand.js (NAME "iFizBox", DOMAIN "ifizbox.com", SIGN_HOST, BUNDLE_ID "com.ryha.ifizbox", PACKAGE, GITHUB_REPO) imported by the frontend and worker/; native/brand.env (the same values) that native/build.sh and the plist/entitlement templates substitute ($(BRAND_NAME), $(BUNDLE_ID)...); Python tools read brand.env. Then replace every user-visible Cydian with iFizBox (app/display names, titles, alerts, Home welcome, About, Credits, docs/*.md, README.md, AGENTS.md, runner.toml rules text, Shortcuts docs, release notes templates), keeping the About credit "Inspired by Cydia by Jay Freeman (saurik), not affiliated". Merge branch origin/ifizbox-icon (the approved globe icon + docs/concepts/icon; then delete the branch locally and on the remote). Leave IDs, storage keys, file paths, CYDIAN_* env names and the domain for 2/3 and 3/3. Commit message and journal say what was renamed. | files: web/app/**, docs/**, README.md, AGENTS.md, native/**, tools/**, worker/** | test: tools/check.sh; a grep test that no user-visible string in web/app (excluding storage keys and IDs) says Cydian; brand.js is the only place the name is spelled in code
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [ ] **F164** (follow-up, low; was a second F155) Open button on the install progress page for sideload/website IPA installs (F151 left them on Return to Cydian): a shell call to launch an installed app by bundle ID (LSApplicationWorkspace openApplicationWithBundleID) and nav/progress.js progressHUD finishing with Open <app> once iOS reports it installed (signing-sheet.js followInstall) | files: web/app/nav/progress.js, web/app/signing-client.js, web/app/signing-sheet.js, native/Sources/** | after: F151
- [ ] **R18** (follow-up, low) Check that progress.css's blinking cursor (progress-blink, steps(1, end) on opacity) blinks on iOS 15 in the app: F166 found WebKit on iOS 15 leaves a steps() transform animation standing still once Core Animation runs it; if opacity does the same, hold keyframes with linear timing as ios6.css @keyframes hud-spin does | files: web/app/progress.css
### Parked
- [ ] **F21** (later) Ideas from feature research, journal/2026-11-17-feature-research, not scheduled: iPad layout and keyboard shortcuts (⌘F search, ⌘R refresh; Zebra #1892); block authors/packages from lists and upgrades (Zebra #1037, #998); 'worked for me' compatibility votes per package and iOS version (Sileo #249; needs moderation); malware check of installed packages against the F19 list; Bootstrap Install mode for broken bootstraps (Irisin); uicache from the app; localisation; self-update for the IPA build. See `journal/2026-11-17-feature-research/reports/Sideloader and package manager features.md`.
- [ ] **F15** (follow-up, later) idevice install route (R5, docs/sideload.md): IDeviceKit + idevice (MIT, xcframework built from source) behind an Advanced switch: import a pairing file, LocalDevVPN loopback, AFC upload + installation_proxy with progress. The one route with no internet and no TLS, and it can update Cydian itself. | files: native/sideload/idevice/**
- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F120** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **R15** (follow-up, later) On the iPhone 7 (ssh 7, Cydian installed), with the user present: sign in to Chariz (or Havoc) in Cydian and check the sheet closes on sileo://authentication_success and keychain.set stores the token; then Download & Install the free betterAlarm (com.noisyflake.betteralarm, Chariz, no purchase) and check cydian-helper install-paid installs it (dpkg -l ii) and the .deb is gone from Library/Caches/com.ryha.cydian/paid and /var/tmp; optionally set a passcode and check keychain.get prompts. The parts of R10 that need the user's own vendor login; everything else is in journal/2026-11-18-r10-*. | files: journal/**
