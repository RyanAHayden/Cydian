# R33 Free route shape check

Context: F254 (free Apple ID route). R32 found that iOS 27 refuses free-profile apps from itms-services
(MIInstallerErrorDomain 111) but installation_proxy works. So the free route has to install through installd
(idevice + pairing file + LocalDevVPN, F15). This task checks three ideas for its shape.

Phone: the user's iPhone 15 Pro, reached **over Wi-Fi and Tailscale only** (not plugged into anything, nobody at
the screen). lockdownd identified it as `iPhone16,1`, iOS **27.0.1** (24A446), UDID `00008130-…001C`, Developer
Mode **on**. The desktop already had a lockdown pairing record for it (`/var/lib/lockdown/00008130-….plist`, from
2026-10-28), so read-only lockdown sessions over Wi-Fi worked.

## Summary

| # | Question | Answer |
|---|----------|--------|
| 1 | iFizBox Lite as a guest in LiveContainer, renewing LiveContainer itself | **Go for a spike** (paper result, not run on the phone) |
| 2 | iOS 27 on-device pairing file, no computer at all | **Go for the pairing file; no-go for "no computer at all"** (the first app still has to get on the phone somehow) |
| 3 | App → own Tailscale IP reaches lockdownd | **No-go** (lockdownd hangs up on Tailscale connections; measured from outside the phone) |

## (1) iFizBox Lite inside LiveContainer, renewing LiveContainer: go for a spike

How LiveContainer+SideStore does it (read in LiveContainer's source, AGPL-3.0, 2026-11-15 HEAD):

- SideStore isn't a normal guest. It ships **inside LiveContainer's own build** as
  `LiveContainer.app/Frameworks/SideStoreApp.framework` (`LiveContainerSwiftUI/Models/BuiltInSideStoreAppInfo.swift`)
  and LiveContainer hooks it (`SideStoreSupport/SideStoreHooks.m`): `appbundleIdentifier`/`storeAppBundleIdentifier`
  return `com.kdt.livecontainer`, `activeBundle` returns LiveContainer.app, the app group becomes LiveContainer's
  and its source URL becomes LiveContainer's. SideStore's ordinary "refresh myself" then re-signs and reinstalls
  **LiveContainer.app** through its usual pairing file + VPN path. So it's not something any guest can do out of
  the box. It works because a guest runs in LiveContainer's process.
- A guest runs **in LiveContainer's process**, with LiveContainer's sandbox, entitlements, app group and keychain
  groups ("Guest app containers are not sandboxed", README Limitations). So a guest iFizBox Lite can read
  LiveContainer.app's bundle and LiveContainer's shared data. LiveContainer keeps the certificate's password in
  its shared defaults (`LCCertificatePassword`, `LCSharedUtils.m`). On the free route iFizBox doesn't even need
  that: the website gave LiveContainer the certificate, so iFizBox already holds the same certificate and key.
- From there iFizBox needs to: copy LiveContainer.app, re-sign it with a fresh 7-day profile (the free route's
  Apple ID session makes the profile, zsign signs it, both already in the plan), then idevice
  `installation_proxy` **upgrade** (MIT library, `idevice/src/services/installation_proxy.rs`: `install`, `upgrade`,
  and an RSD shim `com.apple.mobile.installation_proxy.shim.remote`). installd kills LiveContainer, and iFizBox
  inside it, at the install step. The upload is already done by then, so the install finishes without us. SideStore
  in LiveContainer has the same problem and lives with it.
- Slots: LiveContainer is the one app that uses a slot and an App ID. iFizBox and the apps it installs into
  LiveContainer use none. So **1 of 3 slots used, 2 free**, as the task hoped. (An iFizBox installed as its own
  app would take a second slot.)
- Things to work out in the spike:
  - A guest gets LiveContainer's entitlements, not its own. Lite's **share extension won't work**, and neither
    will its URL scheme (LiveContainer says custom URL schemes "might not work"). So the handoff from the website
    to a guest iFizBox goes through LiveContainer's `livecontainer://` launch URL, or the user opens it in
    LiveContainer by hand.
  - On iOS 26+ there's no JIT, so LiveContainer signs guests with its own certificate. That's fine here (the same
    free certificate).
  - Push doesn't work for guests (LiveContainer README). Free accounts have no push anyway (F254).
  - LiveContainer's own source/bundle layout is internal and can change between releases. The spike should only
    rely on `Bundle.main` (LiveContainer.app) and on installation_proxy, not on LiveContainer's private classes.
  - License: we copy no LiveContainer code. AGPL-3.0 is compatible with GPL-3.0 (GPLv3 section 13) if code were
    ever needed, but F254 says none is copied.

## (2) iOS 27 on-device pairing: go for the pairing file, no-go for zero computer

- iOS 27 has a new **"Pair with <app> on this iPhone"** entry in Settings › Privacy & Security › Developer Mode.
  An app on the phone advertises itself as a pairable host over Bonjour and runs the RemotePairing SRP/Ed25519
  responder. The user taps the entry and types the 6-digit PIN the app shows. Two public apps do it:
  - **PhonePair** (github.com/GhouI/PhonePair, **MIT**, 2026-11-08): uses idevice's `PairableHostInfo` and remote
    pairing responder, then checks the result through LocalDevVPN at `10.7.0.1:49152`. One owner-reported iOS 27
    test (JIT through StikDebug worked).
  - **StikPair** (StikDebug/StikPair, archived, **"MIT, non-commercial"**, so not a free licence: don't copy it,
    and nothing it does is needed beyond idevice). Its README says StikDebug replaced it.
  - idevice itself (MIT) has the pieces: `ffi/src/pairable_host.rs`, `ffi/src/rp_pairing_file.rs`,
    `tunnel_create_rppairing` (Wi-Fi/LAN RPPairing → TLS-PSK tunnel → RSD).
- What it makes is an **RPPairing file** (CoreDevice/RemotePairing identity, RSD on port 49152), **not** the old
  lockdown pairing plist SideStore/F15 use. installation_proxy still works over it: idevice's
  `InstallationProxyClient` is an `RsdService`, and **StikDebug (AGPL-3.0) already does exactly this on the
  phone**: `rp_pairing_file_read` → `tunnel_create_rppairing` → `installation_proxy_connect_rsd` →
  `installation_proxy_get_apps` (`StikDebug/Device/IdeviceFFIBridge.swift` lines ~125 and ~843-857). So F15 should
  build on the RPPairing + RSD path on iOS 27 and keep the lockdown-plist path for older iOS.
- **But it doesn't remove the computer.** Pairing needs an app *already running on the phone*. On the free route
  the first app can't come from the website (R32: error 111). Ways the first app can get on:
  1. A computer once (USB, Xcode or idevice/installation_proxy). That's the same one-time computer step as today,
     but now *only* to get the first app on. After that the phone pairs itself, and no pairing file has to be
     carried over.
  2. The certificate route: an iFizBox Lite signed with a distribution certificate installs from the website
     (itms-services is fine for those), pairs on the phone, then installs free-signed apps (e.g. LiveContainer)
     through installation_proxy. That works without any computer, but it needs a certificate, which the free route
     was meant to avoid. And the Lite build keeps the certificate's revoke risk.
  3. An app the user already has (SideStore, LiveContainer+SideStore, StikDebug) that can install an IPA: iFizBox
     makes the signed IPA and hands it over. That's what the F254 LiveContainer handoff already plans.
- Also needed: Developer Mode on (iOS hides the switch until a development app has been installed or Xcode has
  seen the phone, so a brand-new phone may not show it before the first install, not checked here) and Wi-Fi
  (Bonjour) during pairing. After that, LocalDevVPN for every install.

## (3) Tailscale instead of LocalDevVPN: no-go

Measured from the desktop on the same tailnet, 2026-11-19, phone awake and on both networks
(`tools/lockdown_probe.py`, `tools/lockdown_session.py`, read-only: QueryType, StartSession, GetValue; nothing written):

| Path to the phone | Port 62078 (lockdownd) | Port 62079 / 1 |
|---|---|---|
| Wi-Fi LAN `192.168.0.41` | accepts, stays open, answers QueryType `com.apple.mobile.lockdown`, paired StartSession + GetValue work | — |
| Tailscale `100.119.220.13` | TCP accepts, then the **phone closes the connection at once**, before any request (3 of 3 tries, alternating with Wi-Fi which held every time) | refused (so the phone itself answers on Tailscale, not Tailscale's relay) |

So iOS 27's lockdownd listens on the Tailscale interface but drops anything arriving over it. LocalDevVPN works
because it loops the packets back so they look like a normal network peer (`10.7.0.1`). Tailscale doesn't. An
app dialling the phone's *own* Tailscale IP is worse still: iOS knows that address is local and sends it through
loopback, and loopback is exactly what lockdownd refuses (that's the reason LocalDevVPN exists). **Tailscale users
have to switch to LocalDevVPN while installing.** iOS allows one VPN at a time. The app should say so ("Turn off
Tailscale, turn on LocalDevVPN") instead of trying Tailscale.

Side finding: `com.apple.mobile.wireless_lockdown` / `EnableWifiConnections` reads `MissingValue` on this phone,
but network lockdown over Wi-Fi still works for a paired host. On iOS 27 that switch doesn't gate it.

## What I did

- Read F254, R30 and R32 notes. Found the iPhone 15 Pro on the tailnet and on the LAN, and confirmed which host
  it is with a paired read-only lockdown session using the desktop's existing pairing record.
- Probed lockdownd over Wi-Fi and over Tailscale (table above).
- Read LiveContainer's source (SideStore integration, certificate storage), idevice's installation_proxy and
  tunnel FFI, StikDebug's on-device install-proxy path, and PhonePair/StikPair READMEs and licences through the
  GitHub API.

## What failed

- `ideviceinfo -n -u 00008130-…` ("Device not found"): usbmuxd's network discovery didn't see the phone even
  though `idevice_id -n` listed it once. I used my own lockdown probe instead.
- The MBA has no phone plugged in (USB list empty, and only the Command Line Tools are selected, so no
  `devicectl`). Nothing was run over USB.

## Not verified

- **(1) not run on the phone.** That needs LiveContainer installed and signed with the free certificate, an
  iFizBox Lite build added as a guest, and someone at the screen. It also needs the idevice install code F15
  hasn't written yet. The go is from reading LiveContainer's and idevice's code, not from running it.
- **(2) not run on the phone.** I didn't install PhonePair or StikDebug on the user's phone or open the Developer
  Mode pairing entry, because that needs taps and a PIN on the screen. Whether the Developer Mode switch shows up
  on a phone that has never had a development app is not checked (this phone has it on already).
- **(3) app-on-the-phone case not run.** The no-go comes from probing the Tailscale interface from outside, plus
  the known loopback refusal. No probe app was built and installed on the user's daily phone to dial its own
  Tailscale IP (an install on their phone with nobody watching, and nobody to read the result).
- Task bookkeeping: the runner's `files:` line for R33 names `journal/2026-11-17-b1-dist-source-icon`. That looks
  like a runner glitch (that's B1's old journal), so I didn't touch it. This entry is in its own folder.
