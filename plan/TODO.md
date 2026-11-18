# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs both the public
site and the jailbreak app, a native shell around a WKWebView that installs `.deb`s (docs/native.md). It has to
feel native: 120 Hz, real swipe-back. Then (maybe) an IPA with notifications, and Shortcuts for auto-updating.
Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F135** Home changes (user 2026-11-18: "move settings up on the main page and give it an icon. on jailbroken remove the horizontal scroll of apps. That can be there if you go browse. but it should have a placeholder for while it loads"). 1) Home's Settings row (homeLinks in screens/home.js, F123) moves up: its own group directly under the tiles, above the help links; give it a 29px iOS 6-style settings icon at the row's left (draw our own grey gear in the style of iOS 6's Settings icon, not Apple's artwork; 1x/2x/3x PNG or SVG under web/app/icons/), as iOS 6 Settings rows have. 2) Jailbreak build: Home no longer shows the horizontal scroller of featured apps/banners (homeFeatured from screens/extras.js, sileo-featured.json, above the tiles); the website and sideload Home keep theirs unless it's the same scroller, in which case jailbreak only. The scroller moves to Browse's page (screens/browse.js) at the top, in every build where Home dropped it. 3) While its banners load, the scroller shows placeholder cards of the same size (the app's existing placeholder style, as F-placeholder pages use) instead of nothing or a spinner. t: node tests for the row order, the icon, the jailbreak Home without the scroller, Browse with it and its placeholders; tools/check.sh green. | files: web/app/screens/home.js, web/app/home.css, web/app/screens/browse.js, web/app/screens/extras.js, web/app/icons
### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

### Parked
- [ ] **F21** (later) Ideas from feature research, journal/2026-11-17-feature-research, not scheduled: iPad layout and keyboard shortcuts (⌘F search, ⌘R refresh; Zebra #1892); block authors/packages from lists and upgrades (Zebra #1037, #998); 'worked for me' compatibility votes per package and iOS version (Sileo #249; needs moderation); malware check of installed packages against the F19 list; Bootstrap Install mode for broken bootstraps (Irisin); uicache from the app; localisation; self-update for the IPA build. See `journal/2026-11-17-feature-research/reports/Sideloader and package manager features.md`.
- [ ] **F15** (follow-up, later) idevice install route (R5, docs/sideload.md): IDeviceKit + idevice (MIT, xcframework built from source) behind an Advanced switch: import a pairing file, LocalDevVPN loopback, AFC upload + installation_proxy with progress. The one route with no internet and no TLS, and it can update Cydian itself. | files: native/sideload/idevice/**
- [ ] **F107** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **F120** (later, when the jailbreakme.dev exploit is ready) Upgrading & Jailbreaking Help stays unlocked on the website's locked Home (user 2026-11-18: 'we will not have the jailbreak tutorial thing locked when jailbreakme.dev exploit is ready, thats for later'): leave that row out of websign-gate's browsingLocked set in screens/home.js and point it at the jailbreak guide. | files: web/app/screens/home.js
- [ ] **R15** (follow-up, later) On the iPhone 7 (ssh 7, Cydian installed), with the user present: sign in to Chariz (or Havoc) in Cydian and check the sheet closes on sileo://authentication_success and keychain.set stores the token; then Download & Install the free betterAlarm (com.noisyflake.betteralarm, Chariz, no purchase) and check cydian-helper install-paid installs it (dpkg -l ii) and the .deb is gone from Library/Caches/com.ryha.cydian/paid and /var/tmp; optionally set a passcode and check keychain.get prompts. The parts of R10 that need the user's own vendor login; everything else is in journal/2026-11-18-r10-*. | files: journal/**
