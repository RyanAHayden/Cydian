# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs both the public
site and the jailbreak app, a native shell around a WKWebView that installs `.deb`s (docs/native.md). It has to
feel native: 120 Hz, real swipe-back. Then (maybe) an IPA with notifications, and Shortcuts for auto-updating.
Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

- [ ] **F134** Settings changes (user 2026-11-18: "remove zoom setting. add settings to toggle showing when apps expire. reorganize the signing page in settings to be better"). 1) Remove Display > Zoom (allowZoom): zoom stays off (keep applyZoom's no-zoom behaviour as the fixed default), add allowZoom to RETIRED so dropRetired clears it, update docs/settings.md. 2) Add a switch (createSwitch, never On/Off text) "Show Expiry Dates" (iOS 6 wording; sideload and website builds, where signed apps expire), default on: off hides the expiry pills/labels (core/signing.js signatureState's sig pills in screens/installed.js, altstore.js app pages, the re-sign list's dates) but keeps the re-sign reminder and the Expired state's actions working. Put it in Settings > Signing. 3) Rework Settings > Signing like an iOS 6 settings page: certificate first (name, team, expiry as one group with Import/Replace), then provisioning profile, then options (Show Expiry Dates, Re-sign Reminder), then the walkthrough/help as a link at the bottom instead of steps inline; one-line footers; no duplicate rows; same behaviours. Update docs/settings.md's tables. t: node tests for the retired key, the switch hiding pills, and the Signing page's group order; tools/check.sh green. | files: web/app/core/settings.js, web/app/screens/settings.js, web/app/settings.css, docs/settings.md, web/app/screens/installed.js, web/app/screens/altstore.js
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
