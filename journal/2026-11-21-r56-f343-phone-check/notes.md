# R56: F343 on the iPhone 15 Pro (Re-sign from the IPA kept at install)

**Result: F343 passes.** Installed from a URL, the probe's IPA is kept byte-for-byte in
`Library/Caches/com.ryha.ifizbox.probe.ipa` and the record carries its SHA-256. A Re-sign with Wi-Fi off logs
"Signing from the IPA kept at install (20 KB), no download" and no Downloading line. Remove from List and a
reinstall from My IPAs both drop the kept file. A Re-sign with the file gone logs "The kept IPA is gone (iOS clears
caches when storage runs low): downloading it again", downloads it (the server logs the GET) and keeps it again.

One unrelated bug turned up: the queue's Re-sign (sign-ahead) signs under the app's own App ID, not the one it is
installed under, so iOS refuses the update (**B280**, below).

## Setup

- Phone: iFizBox Lite 0.18.3 (3590), the build R58 installed from main 7d00351, which includes F343. Main has moved on
  since (B274, B275, B276); none of them touches the kept-IPA code (`native/sign/OriginalIPA.swift`, the
  `takeOriginal`/`keepOriginal` paths), so I didn't rebuild.
- Probe: `tools/resignprobe/build.sh` (bundle ID `com.ryha.ifizbox.probe`, 19,990 bytes, SHA-256 `98aaa372…5ae4`).
  Served by `python3 -m http.server` on 127.0.0.1:8763 behind `tailscale serve --https=8475`, so every request has a
  logged time (`server-requests.txt`).
- Installed with `ifizbox://install?url=https://omarchy-desktop.beetal-ling.ts.net:8475/probe.ipa&name=Probe`
  (Install IPA prompt > Install). The install route was This iPhone through Tailscale (RemotePairing).
- Evidence: the run page's Log text read through Web Inspector (`pymobiledevice3 webinspector cdp` + R58's `ev.mjs`),
  saved here as `run*-log.txt`. The container (Caches and `signed.json`) was read with
  `afcclient --container com.ryha.ifizbox`. Screenshots are `ref/15/screens/r56-*.png` (gitignored).
- Before: Probe was installed, with a `library:probe.ipa` record (App ID `S8NFX3A2LT.com.ryha.sideload`) but My IPAs
  was empty. Caches held no kept IPA. There were 10 records.

## Runs

| # | What | Log | Server | Container after |
| --- | --- | --- | --- | --- |
| 1 | Install from the URL | Downloading, `IPA SHA-256: 98aaa372…`, "Keeping the IPA for Re-sign once it is installed (Caches/com.ryha.ifizbox.probe.ipa)", installed | GET 04:05:20 | kept file present, `sha256sum` equal to the served IPA; record `url` = the https URL, `sha256` = the same hash |
| 2 | **Wi-Fi off** (Control Center; the phone has no SIM, status bar "SOS", so there was no network at all), Installed > Probe > Re-sign > Confirm | **"Signing from the IPA kept at install (20 KB), no download"**, no Downloading line, signed. Then the install failed: "Tailscale didn't connect (NoState)", as it must with no network | nothing | kept file still present |
| 3 | Wi-Fi on, **server stopped** (the URL answers 502), Retry All | again "Signing from the IPA kept at install … no download", signed, copied. Then iOS refused: **appid_mismatch** (B280) | nothing | kept file still present |
| 4 | `ios uninstall com.ryha.ifizbox.probe` (go-ios) to get past B280, Retry All, server still stopped | "Signing from the IPA kept at install … no download" … "iOS installed Probe 1.0", "Re-signed Probe, expires Oct 28, 2027", "1 re-signed" | nothing | kept file present |
| 5 | Probe > Remove from List > Remove from List | | | **kept file gone**, record gone (9 records) |
| 6 | Server started, installed from the URL again | Downloading … installed | GET 04:10:18 | kept file back |
| 7 | probe.ipa put in My IPAs (`afcclient … put Documents/probe.ipa`), Install IPAs > Probe > Install (Reinstall) > Confirm | signed from the library file, "Kept the signed copy in My IPAs", installed | nothing | **kept file gone**; record `url` = `library:probe.ipa`, no `sha256` |
| 8 | Installed from the URL again, then the kept file deleted by hand (`afcclient --container com.ryha.ifizbox -- rm Library/Caches/com.ryha.ifizbox.probe.ipa`), Probe > Re-sign > Confirm | **"The kept IPA is gone (iOS clears caches when storage runs low): downloading it again"**, "Downloading https://…/probe.ipa", same SHA-256, signed, "Keeping the IPA…", installed, "1 re-signed" | GET 04:12:03 (install), **GET 04:13:12 (the Re-sign)** | kept file back |

The server's GET at 04:10:07 was my own `curl` check after restarting it, not the phone.

Runs 2-4 show the Re-sign doesn't touch the network for the IPA. Run 2 had no network at all. In runs 3-4 the URL
was dead and the server logged nothing. Run 4 got all the way to "Re-signed".

## Purging the cache by hand: possible from Linux

The brief (and F343's journal) said the kept file can't be purged from Linux because an ad hoc app's container has
no house_arrest access. That's wrong for this phone: `afcclient --container com.ryha.ifizbox` lists, reads and
deletes `Library/Caches` (R31, R55 and R58 used it too). So run 8 deletes the file by hand. No test build was needed,
and I didn't try storage pressure.

## Found along the way (filed)

- **B280** (normal): `SignAhead.sign` (the run page's sign-ahead: Confirm on Install or Re-sign, `signing.prepare`)
  never sets `signer.installedAppID`, which `Sideload.signAndOpen` sets (B138). Probe was installed under App ID
  `S8NFX3A2LT.com.ryha.sideload`. Run 1 (signAndOpen) logged "com.ryha.ifizbox.probe is installed under App ID
  S8NFX3A2LT.com.ryha.sideload" and kept it. Runs 2-3 (sign-ahead) logged no such line, signed it as
  `com.ryha.ifizbox.probe` "with the profile's entitlements", and iOS refused the update with appid_mismatch. The record
  sign-ahead writes has no `appID` either (`signed.json` after run 4). R58 didn't hit this: its apps were installed by
  sign-ahead in the first place, so their App ID was already TEAM.<bundle ID>.
- **B281** (low): after an install from an `ifizbox://install` link, Installed's list row and the app's page showed
  the record from before ("From My IPAs · 363 days", "Source: My IPAs") while `signed.json` already held the URL record.
  Once, Probe was missing from the list. The Re-sign still used the new record (run 8 downloaded from the URL).
- **B282** (low): Confirm's Statistics read "Downloading 20 kB" for the Reinstall from My IPAs (run 7), which
  downloads nothing.

## Cleanup

- Probe reinstalled from My IPAs, so its record is `library:probe.ipa` again, as before (App ID now
  `S8NFX3A2LT.com.ryha.ifizbox.probe`; the probe's container was wiped by the uninstall in run 4, which is fine for a
  test tool). My IPAs now holds `probe.ipa`, which that record points to (before, the file was missing).
- Caches holds no kept IPA. `signed.json` has the same 10 bundle IDs as before.
- Wi-Fi is back on. The HTTP server, `tailscale serve --https=8475` and the Web Inspector server are stopped, and the UI
  lock is released.

## Tried that went wrong

- `afcclient --documents com.ryha.ifizbox` says "Permission denied (10)". `--container` with `Documents/…` works.
- On Probe's page (after the URL install) I tapped where Re-sign had been on the previous layout. The page now had a
  Source row, so the tap hit Open and launched Probe. I went back with `launch`, took a screenshot first, then tapped Re-sign.
- In Control Center, swiping up to close it scrolled to the media page instead. `launch` brings iFizBox back.

## Not verified

- **Settings > Installation & Signing > Signed Apps > Re-sign / Re-sign All**: not pressed. Every Re-sign here went
  through Installed > Re-sign > Confirm (the run page, sign-ahead). Signed Apps queues the same rows into the same run
  (R58 run 2 used it, and its tiny apps signed from kept IPAs too), so the kept-IPA path is the same.
- **A kept file that doesn't match the record's SHA-256** (the "doesn't match" branch): not in the brief. I could make
  one with afcclient (put a different file at the kept path) but didn't, to keep to the asked checks.
- **iOS purging Caches by itself under storage pressure**: not tested. The file was deleted by hand instead (above).
- **An upgrade replacing the kept file** (a new version from the same URL): not in the brief.
- **Wi-Fi off all the way to "Re-signed"**: impossible on this phone. It has no SIM, so with Wi-Fi off the
  This iPhone install (Tailscale) can't connect. Run 2 shows the signing side with Wi-Fi off. Runs 3-4 show the whole
  Re-sign with the IPA's URL dead.
- **The latest main build**: tested on 3590 (7d00351), not on main after B274-B276 (reasoning under Setup).
