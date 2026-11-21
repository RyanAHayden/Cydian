# R61 Lite on the iPhone 15 Pro: This iPhone after delete + reinstall (B284's phone check)

**Result: passes.** On a fresh container (iFizBox deleted and reinstalled), the first `signing.status` read 5 s
after launch already had the profile's `device` at `state: "in"` with this phone's UDID, and Signing > Certificate
showed **This iPhone: In Profile**, "This iPhone is in the profile." (`fresh-certificate.jpg`). Nothing used the
pairing before that: no `iFizBox install:` line in the syslog and no `Caches/idevice.log` in the new container
(idevice writes it on its first step). In R59's step 5 the same check read Unknown.

The log line the brief names could not be read: it is an `NSLog`, and iOS 27's syslog relay shows `NSLog` text only
as `<private>` (see below). Filed **B286** (low) to log it with `os_log` `%{public}@`.

## Setup

- Phone: `ideviceinfo -k ProductType` = iPhone16,1, iOS 27.0.1. Driven with `tools/ui-15.sh` under the R61 lock;
  state read through Web Inspector (`pymobiledevice3 webinspector cdp --port 9378`, `ev.mjs` here). WebKit's
  `Runtime.evaluate` ignores `awaitPromise`, so a bridge call was stored in `window.__r` first and read after.
  Taps by text with R60's `tapt.sh` / `where.sh` (copied, R61's lock).
- Build: Lite from this branch at main d1b0652 (includes B284's merge 2ed3907a), `native/build.sh ipa`:
  0.18.3 (3678). The binary holds "phone UDID restored from the keychain" and the service `com.ryha.ifizbox.phone`.
- Before: iFizBox 0.18.3 (3664, R60's build), paired, identity + "sidedrop adhoc" profile, `ifizbox.phone.udid` =
  this phone's UDID in UserDefaults. Container backed up first (`afcclient --container com.ryha.ifizbox -- get -r`):
  `Library/Application Support` (profile, `signed.json` with 10 records, MyIPAs' `probe.ipa.*`, tailscale state),
  `Library/Preferences`, `Documents/probe.ipa`.
- `pymobiledevice3 syslog live` captured the whole run (not committed: about 1.07 M lines).

## Runs

| Step | What | Result |
| --- | --- | --- |
| 1 | Over-install of 3678 with `ui-15.sh R61 install` (container kept), launch | `signing.status`: identity + profile, device `state: "in"`, UDID (`status-1-overinstall.json`). This launch is when B284 copies the UserDefaults UDID into the Keychain. It logs only a refusal, as an NSLog, which would be `<private>` here too, so the syslog can't say it worked; step 3 shows it did. |
| 2 | `ios uninstall com.ryha.ifizbox` (05:15:47); afterwards `afcclient` found no container. Install 3678 again: fresh container (`Library` held Caches, SplashBoard and an empty Preferences; no Application Support) | |
| 3 | Launch 05:16:11; `signing.status` at 05:16:16, before any tap | identity + profile back (B276), **device `state: "in"`, `udid` this phone, `shared: 1`** (`status-2-fresh-container.json`). R59's step 5 read `state: "unknown"`, `shared: 2` (the embedded profile's two devices) here. |
| 4 | Settings > Installation & Signing > Certificate (05:18) | **This iPhone: In Profile** (`fresh-certificate.jpg`). `device.udid` = `{udid, source: "lockdown"}` (`device-udid-fresh.json`): `PhoneID.source` reads "lockdown" whenever UserDefaults holds `ifizbox.phone.udid`, and the Keychain branch writes it there, so a restored UDID reports the source it was first learned from (B284 kept this on purpose: "`source` then reads "lockdown" as before"). It does not mean lockdown was asked this time. The new container's Preferences plist holds `ifizbox.phone.udid` = this phone's UDID, which only the Keychain branch of `PhoneID.read()` writes without a pairing. |

Installation & Signing shows "Checking…" when opened, but the container still had no `idevice.log` after the
Certificate shot and the syslog had no `iFizBox install:` line from launch to then: the pairing was not used before
the Certificate page was read. Either way the step 3 read came before that page was opened.

## The log line

`PhoneID.read()` logs "phone UDID restored from the keychain" with `NSLog`. The syslog from launch has five
`iFizBox{Foundation}[1767] <NOTICE>: <private>` lines at 05:16:11 to 05:16:12, and no readable `NSLog` text: SignStore's
"signing certificate restored from the keychain" (B276; the identity was restored, so it ran) is not readable either.
`IDevice.swift` already notes "NSLog never reached it on iOS 27"; `os_log` with `%{public}@` does show
(`iFizBox tailscale: signed-in node restored from the keychain` is in the same capture). So the restore is shown by
its effects (steps 3 and 4), not by the line. Filed **B286**.

## Phone left as

iFizBox 0.18.3 (3678, this branch, rig-signed), container fresh from step 2 with these put back from the backup
(`afcclient put`, each checked with `cmp` against the backup): `Signing/signed.json` (Signed Apps 10), MyIPAs'
`probe.ipa.signed`, `probe.ipa.json`, `probe.ipa.signed.json`, `Documents/probe.ipa`. As in R59, not put back:
`Library/Preferences` (theme, update list, push registration; the app rebuilds them, the theme may be at its default)
and the old `tailscale` folder (Tailscale came back from the Keychain: "signed-in node restored from the keychain").
After a relaunch: `idevice.verify` = `{ok: true, kind: "rp"}`, Installation & Signing reads Ready to Install,
This iPhone · Paired, Certificate 341 days left, Signed Apps 10, Changes 9. iOS asked for local network again
(expected after a fresh install): Allow. CDP server and syslog capture stopped by their pids, UI lock released.

## Tried that went wrong

- `ev.mjs` returned `{}` for `ifizboxNative.call(...)`: WebKit ignores `awaitPromise`. Stored the answer in a global.
- The first tap on Home's Settings did nothing (taken by the app's start, or by a system prompt not on screen at the
  shot); the second worked.
- The first `afcclient put` of the restore used a wrong local path (`Library/Library/...`) and put nothing; redone
  with the right path and checked with `cmp`.

## Not verified

- **The log line itself**: not readable on iOS 27 (`NSLog` is `<private>` in the syslog relay); B286 filed. The
  restore is shown by the UDID in step 3 and the new UserDefaults key in step 4.
- **The notifications prompt**: R59 saw iOS ask again after a fresh install; it did not show in this run's shots,
  so whether notifications are allowed now was not checked (the push registration rebuilds when the app asks).
- **A phone paired before B284 that is deleted without ever opening a B284 build**: not possible to restore by
  design (the Keychain item is written only by a B284 build); step 1's over-install launch is what wrote it here.
