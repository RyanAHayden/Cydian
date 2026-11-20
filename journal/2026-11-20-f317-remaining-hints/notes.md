# F317 Hint style on the remaining pages

Applies the AGENTS.md Hints rule (F311; concept https://claude.ai/artifact/JMn57UQTZkom6h1Uttz261) to the pages
the brief lists. Each change is a small exported builder or constant, tested in
`web/app/screens/hintstyle-f317.test.js` (every new footer: 1–2 sentences, ≤140 characters).

- **home.js Help** `helpSections(mode, { changes, refresh })`: Not Jailbroken a group of its own ("Apps from
  AltStore-style sources, installed with a sideloader." / sideload: "…signed and installed on this iPhone."); Rootless,
  Rootful, Roothide one group with "Set Settings > Device to Jailbroken to list packages for your kind. A package built
  for another kind will not install." (sideload: needs the jailbreak app, F144 kept). Check for Changes and Refresh
  Sources a group each. `helpJailbreakFooter` is gone (no other caller). The arch names (iphoneos-arm64 …) were dropped
  to keep it to two sentences.
- **home.js Credits > Software** `softwareSections()`: ElleKit and Canister each in their own group with their own
  footer; zsign/OpenSSL/zlib/idevice/Tailscale stay one footer-less group.
- **free-apple-id.js**: entry footer two sentences; sign-in splits the spare-ID advice (under the Apple ID fields) from
  the password note (under Sign In); while Apple makes us wait the wait line replaces the password note there (the
  fix). Ready: `readySections` puts each setup step's summary under the row it made (This iPhone row added only when
  this session registered it; Certificate Until; App ID), never joined with ". "; Profile Until gets none (its detail
  already is the profile step's summary). The zip note under Save for the App; the weekly sign-in under Sign In Again.
  Also: the two-factor hint moved under the code field, and Developer Mode's "Once an app … opens fine" under its
  button, instead of footer-only groups between buttons.
- **tweaks.js** Inject Tweaks: `FOOTER` two sentences; `WITH_ELLEKIT` without the licence parenthesis.
- **roulette.js** `ROULETTE_INTRO` two sentences (the wheels sentence dropped).
- **manage.js** `IMPORT_FOOTER` two shorter sentences.
- **installroute.js** pairing: with a file, one group per numbered step; step 2's group holds Import Pairing File
  (drawPair no longer appends it as its own group; the file input goes into that row). This iPhone's footer lost
  "or Tailscale (below)". No VPN installed: LocalDevVPN's group ("…a free app. This page checks again when you come
  back.") and a new Install Tailscale group ("The other way in: install Tailscale and sign in to it."), the row opening
  Tailscale's App Store page (`TAILSCALE_STORE`, id1470499037, checked: apps.apple.com answers 200, title "Tailscale").
- **myipas.js** website IPA kept in the browser: `siteIpaSections` – an Install row (same action as the nav bar's)
  with the Install hint, Details with no footer; "Kept in this browser until you delete it." under Delete.
- **settings.js** Blocked (named in the brief though not in its file list): the mode's sentence (kept on this
  device / held with dpkg) is its own last group, not mid-footer under Packages. blocked.test.js updated.

## Found and fixed on the way

- Credits threw on main: the Canister row had `cls: "thanks-row canister-credit"` and ui.js does
  `classList.add(row.cls)` (one token), so everything after Special Thanks failed to draw in a browser
  (InvalidCharacterError in the render). Now `cls: "thanks-row"`; no CSS or test used `canister-credit`.
  findmore.test.js greps for `label: "Canister"`, and native/test_notices.py reads `label: "X"` literals (the first
  gate run failed: "Credits screen does not name ['ElleKit']" while ElleKit went through a row() helper), so the
  ElleKit and Canister rows are written out as literals.

## Decisions

- "Credits > Software (one group per row)": rows with a hint (ElleKit, Canister) get a group each; the five notice
  rows have no hint, so they share one group – five footer-less one-row groups would only add gaps.
- Help's kinds: the three jailbreak rows share the one footer that explains all three.
- Blocked: "put it first or on its own" – on its own, last, as it is about the whole page.
- Free Apple ID ready: rows that are pure status (Team, Profile Until) get none.

## Checks

- `node --test web/app`: 2521 pass, 1 fail (findmore's `label: "Canister"` grep) → fixed; that file and the new test
  rerun: pass. The gate runs it all again.
- 3x Chromium renders (capture.mjs from F314 + `idevice.*` fakes (PAIR, VPN_APPS env) and RELAY=1 for /apple/status;
  402x874@3; web/app served by `python3 -m http.server` on 127.0.0.1:8763):
  `help.png`, `credits-software.png` (help.json); `free-entry.png`, `free-signin.png`, `free-ready.png` (free.json,
  RELAY=1, a fake saved identity in localStorage); `pair.png` (pair.json, sideload, file state), `pair-novpn.png`
  (iOS 27 state, neither VPN app).

## Not verified

- Free Apple ID ready view with this session's step summaries (needs a real Apple sign-in and setup): unit test only.
- Sign-in wait footer (needs Apple to refuse a sign-in): unit test of the text only.
- Inject Tweaks, Roulette, Sources > Import, My IPAs website page, Settings > Blocked: not rendered (text-only or
  one-group moves, unit-tested); the brief asked for renders of Help, Free Apple ID and Pairing.
- Install Tailscale on a phone (opening the App Store URL via app.openURL): not run on a device; no phone test asked.
- The static server was started as a background task with a 30-minute timeout; it ends on its own.
