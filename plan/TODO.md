# TODO: open tasks, in order

Goal: Cydia's iOS 6 look and behaviour, rebuilt for modern iPhones. One frontend (`web/app/`) runs both the public
site and the jailbreak app, a native shell around a WKWebView that installs `.deb`s (docs/native.md). It has to
feel native: 120 Hz, real swipe-back. Then (maybe) an IPA with notifications, and Shortcuts for auto-updating.
Rules: `AGENTS.md`.

Task lines end in keyed fields: `| files: a, dir/** | after: ID | test: what proves it` (only the fields are
parsed). Finish with `agent-runner done <ID> "msg"`.

### Web: browse and upgrade (in order)

### Research (any time, parallel)

### Native jailbreak app (shape decided: docs/native.md)

- [~] **N6** Hand test on a modern jailbroken phone (the 4S never runs Cydian): add source, install, upgrade, remove, notification. — reopened: N5 landed BLOCKED: Needs a person with a rootless-jailbroken iPhone (iOS 15+): the only reachable device is the 4S (iOS 6), which can't run Cydian, and the user said there's no test phone. Unblock: run the checklist in journal/2026-11-17-n6-hand-test/README.md on a phone and record the results. — N8 (App Intents, widget, controls) is also untested on a device: on the hand-test phone, check that Shortcuts lists Cydian's actions (Check for Updates, Add Source, Install All Updates, Respring, Userspace Reboot, Export/Restore My Packages), the Updates widget shows a count, and the Respring/Userspace Reboot controls work in Control Center. List: journal/2026-11-17-n8-app-intents/README.md, Not verified.

### IPA: sideload management (same shell as the jailbreak app)

### Shortcuts

### Follow-ups

- [~] **R10** (follow-up, normal) On a modern jailbroken iPhone (iOS 15+, Dopamine/palera1n) with a Havoc or Chariz account, check F57's paid-package shell (native/Sources/Paid.swift): Sign In opens the ASWebAuthenticationSession sheet and comes back from sileo://authentication_success; keychain.set/get asks for Face ID/passcode (keychain-access-groups entitlement accepted, no -34018); device.info returns the UDID (MobileGestalt AllowedProtectedKeys entitlement works); buy a cheap tweak; Download & Install runs cydian-helper install-paid and the tweak is installed. Write findings in the journal; file bugs for anything broken. Needs a person with the phone and an account. | files: journal/** | after: F57 BLOCKED: Needs a person with an iOS 15+ Dopamine/palera1n iPhone and a Havoc or Chariz account (and approval to buy a cheap tweak). No such device is reachable here (only the iOS 6 4S). Follow the checklist in journal/2026-11-17-r10-paid-device-check/README.md.
- [ ] **F98** (follow-up, low) Cydian Account (F97): use Cloudflare's Rate Limiting binding (wrangler [[ratelimits]], free) for /api/account when bound, falling back to the per-isolate memory limiter in worker/src/account.js, so the per-address limit holds across isolates. Also say in Settings > Ignored Upgrades' footer ('Kept on this device.') that a Cydian Account syncs them. | files: worker/src/account.js, worker/wrangler.cydian.toml, worker/wrangler.toml, worker/test.mjs, web/app/core/settings.js | after: F97
### Parked
- [ ] **F21** (later) Ideas from feature research, journal/2026-11-17-feature-research, not scheduled: iPad layout and keyboard shortcuts (⌘F search, ⌘R refresh; Zebra #1892); block authors/packages from lists and upgrades (Zebra #1037, #998); 'worked for me' compatibility votes per package and iOS version (Sileo #249; needs moderation); malware check of installed packages against the F19 list; Bootstrap Install mode for broken bootstraps (Irisin); uicache from the app; localisation; self-update for the IPA build. See `journal/2026-11-17-feature-research/reports/Sideloader and package manager features.md`.
- [ ] **F15** (follow-up, later) idevice install route (R5, docs/sideload.md): IDeviceKit + idevice (MIT, xcframework built from source) behind an Advanced switch: import a pairing file, LocalDevVPN loopback, AFC upload + installation_proxy with progress. The one route with no internet and no TLS, and it can update Cydian itself. | files: native/sideload/idevice/**
