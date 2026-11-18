# Sideload: signing and installing IPAs on the phone

R5, 2026-11-17. How Feather signs and installs IPAs with nothing but the phone, how jailbreak installers do it,
and what iFizBox takes from each. The user's rule (2026-11-17): iFizBox is its own project. It never routes through
sidedrop, and there is **no server of ours** in the install path.

This is desk research. I read the source and ran nothing on a phone. Sources, read at these commits:

| Project | Commit | Licence | Can iFizBox (GPL-3.0-or-later) take code? |
|---|---|---|---|
| [Feather](https://github.com/khcrysalis/Feather) (incl. its `NimbleKit/`, `AltSourceKit/`) | `31ab6de`, 2026-11-01 | GPL-3.0 | Yes, keep the file headers and credit |
| [Zsign-Package](https://github.com/khcrysalis/Zsign-Package) (`package` branch: zsign + Swift wrapper) | `c4ba9da`, 2026-09-19 | MIT | Yes |
| [zsign](https://github.com/zhlynn/zsign) upstream | (GitHub API, not cloned) | MIT | Yes |
| [IDeviceKit](https://github.com/khcrysalis/IDeviceKit) (Swift over idevice) | `837cf1e`, 2026-04-14 | MIT | Yes |
| [idevice](https://github.com/jkcoxson/idevice) (Rust, ships `IDevice.xcframework`) | v0.1.57 used by IDeviceKit | MIT | Yes |
| [krzyzanowskim/OpenSSL](https://github.com/krzyzanowskim/OpenSSL) (zsign's crypto, OpenSSL 3) | | Apache-2.0 | Yes (Apache-2.0 goes into GPLv3, one way) |
| Vapor / swift-nio-ssl (Feather's HTTP server) | | MIT / Apache-2.0 | Yes |
| [AppSync Unified](https://github.com/akemin-dayo/AppSync) (incl. `appinst`) | `235aca6`, 2024-11-28 | GPL-3.0-or-later | Yes |
| [TrollStore](https://github.com/opa334/TrollStore) | `88424f6`, 2026-04-01 | MIT, **except `RootHelper/uicache.m`: BSD-4-Clause** | MIT parts yes. **`uicache.m` no**: the advertising clause is GPL-incompatible |
| SideStore / minimuxer | | AGPL-3.0 | Avoid. GPLv3 §13 allows linking, but the AGPL network clause would then apply to those parts. idevice does the same job under MIT |

Feather's server files say "Copyright © 2024 Lakr Aream … ORIGINALLY LICENSED UNDER GPL-3.0, MODIFIED FOR USE
FOR FEATHER". Keep that line, add Feather's, then ours.

## How Feather works, step by step

### 1. Importing the user's certificate

The user brings a signing identity from elsewhere: a `.p12` (cert + private key), its password, and a
`.mobileprovision`. Feather has **no Apple ID login**. It never creates certificates or registers devices.
That is AltStore/SideStore's job, and it needs Apple's servers plus an anisette server.

- `Feather/Utilities/Handlers/CertificateFileHandler.swift`: parse the profile, copy both files to
  `Documents/Feather/Certificates/<uuid>/`, then add a Core Data row (password, nickname, expiry, `PPQCheck`).
  **The p12 password is kept in Core Data, not the Keychain.** iFizBox should keep it in the Keychain.
- `Feather/Utilities/CertificateReader/CertificateReader.swift` reads the profile cheaply: find `<?xml` in the
  CMS blob and decode the plist from there. It does not verify the CMS signature. Enough to show the name,
  team, expiry, entitlements, `ProvisionedDevices`, `ProvisionsAllDevices` and `PPQCheck`.
- `FR.checkPasswordForCertificate` uses zsign's `p12_password_check` to test the password before saving.
- Ways in: the Files picker, `.p12`/`.mobileprovision` document types, and
  `feather://import-certificate?p12=<b64>&mobileprovision=<b64>&password=<b64>`. `feather://export-certificate?callback_template=…`
  hands the p12 and password to another app (LiveContainer uses it). iFizBox should **not** copy the export
  route. Any app that opens that URL gets the user's private key after one tap.
- Revocation: `Storage+Certificate.swift` → `Zsign.checkRevokage` → `checkCert` in `swift/zsign.mm`. It reads
  the OCSP URL from the cert's AIA extension and asks Apple's OCSP responder. That is an internet call, but only
  a status check, and it can be skipped.

### 2. Signing on the device (`SigningHandler.swift` → `ZsignHandler.swift` → zsign)

`SigningHandler.modify()` runs these steps in order, on a copy of the `.app` in a temp folder:

1. **Bundle ID change**, if set. `_modifyPluginIdentifiers` walks every nested `.app`/`.appex` and does a string
   replace of the old main ID with the new one in `CFBundleIdentifier`, `WKCompanionAppBundleIdentifier`,
   `NSExtension.NSExtensionAttributes.WKAppBundleIdentifier` and `NSExtensionFileProviderDocumentGroup`.
   Extensions keep their suffix (`old.share` → `new.share`).
2. **Info.plist edits**: name (and `InfoPlist.strings` in each `.lproj`), version, icon, file sharing, minimum OS,
   and so on. It always drops `UISupportedDevices`.
3. **Cleanup**: remove `_CodeSignature` everywhere, `embedded.mobileprovision` ("zsign doesn't replace it"),
   `com.apple.WatchPlaceholder`, `SignedByEsign`, and Watch apps with no Info.plist.
4. Optional dylib injection (`TweakHandler`, can unpack `.deb` tweaks, bundles ElleKit). iFizBox doesn't need it.
5. **arm64e fix-up** (`_locateMachosAndFixupArm64eSlice`): rewrites old-ABI arm64e slices so iOS 26 accepts them.
   This is mostly for CydiaSubstrate. Keep it: an IPA from an AltStore source may carry one.
6. **Entitlements**. By default zsign takes the profile's `Entitlements` dict as-is
   (`ZSignAsset::Init` in `src/openssl.cpp`: `application-identifier`, `TeamIdentifier[0]`, and if no
   entitlements file is given, the profile's). The optional `mergeEntitlements` replaces `*` in the profile's
   values with the new bundle ID, except `associated-domains`. It then copies only `keychain-access-groups`
   from the binary's own entitlements (read with `LCGetMachOEntitlements`, from LiveContainer). Its own comment
   says it ignores extensions.
7. **Sign**: `Zsign.sign(appPath, provisionPath, p12Path, p12Password, entitlementsPath, removeProvision)` →
   `zsign()` in `swift/zsign.mm` → `ZBundle::SignFolder`. zsign signs nested frameworks, dylibs, `.appex` and
   `.app` bundles inside out, writes the code directory, CMS and entitlement slots (XML and DER), and caches
   unchanged Mach-Os. **One profile for every bundle.** Upstream zsign supports one profile per extension, but
   Feather's wrapper doesn't expose it. Ad hoc signing exists in zsign. Feather comments it out of the UI.

What this means for a profile:

- **Wildcard App ID** (`TEAM.*`): any bundle ID works, extensions included. Push, App Groups and iCloud are
  missing (see `docs/ipa.md`).
- **Explicit App ID**: the main app must be re-IDed to exactly that ID, and extensions get IDs the profile
  doesn't cover. iOS refuses the install, so either delete `PlugIns/` (zsign's `m_bRemoveExtensions`) or sign
  each extension with its own profile.
- **Free Apple ID profiles** are explicit, 7-day, 3 apps, and need Apple's servers to make. That's out of scope:
  we don't log in to Apple.

### 3. Install modes

Settings → Installation (`InstallationView.swift`) picks **Server** (default) or **idevice**. Server has two
sub-modes (`ServerView.swift`): **Fully Local** (`Feather.serverMethod = 0`) and **Semi Local** (`= 1`).
Both start an in-app HTTP server: Vapor on SwiftNIO, `0.0.0.0`, a random port from 4000 to 8000, one per install
(`ServerInstaller.swift`). The routes:

| Path | Serves |
|---|---|
| `/<uuid>.plist` | the itms-services manifest: `software-package` URL, 57/512 px images (a flat tint-colour square), `bundle-identifier`, `bundle-version`, `title` |
| `/<uuid>.ipa` | the signed IPA, streamed from disk. Status goes to "sending payload", then "installing" when the stream ends |
| `/app57x57.png`, `/app512x512.png` | the images |
| `/install` | an HTML page that only does `window.location = <itms-services link>` (Semi Local) |

#### Fully Local: the trick that makes itms-services accept a local URL

itms-services needs the **manifest over HTTPS, with a certificate the system trusts**. The answer is
**[backloop.dev](https://backloop.dev)**: a public domain whose wildcard DNS points every `*.backloop.dev` name
at loopback, plus a real, publicly trusted wildcard certificate for `*.backloop.dev` **whose private key is
published** at `https://backloop.dev/pack.json` (`cert`, `ca`, `key1` + `key2`, `info.domains.commonName`).

- At build time the `Makefile` `deps` target fetches `pack.json` and copies `server.crt`, `server.pem` and
  `commonName.txt` into the `.app`. "Update SSL Certificates" in Settings fetches it again into `Documents/`,
  which wins over the bundled copy (`ServerInstaller.getUrl`).
- The server loads the pair with `NIOSSL` (`ServerInstaller+TLS.swift`). The manifest URL is
  `https://<commonName>:<port>/<uuid>.plist`, opened with `UIApplication.shared.open`.
- Feather puts the `commonName` straight into the URL host. Today that is the literal `*.backloop.dev`. It
  resolves (a `*` label matches the wildcard record; checked here: `*.backloop.dev` → `127.0.0.1`), but a
  concrete label like `local.backloop.dev` is cleaner and certainly matches the wildcard cert. iFizBox should use
  one.
- **Checked today (2026-11-17): the live pack's cert has `notAfter 2026-10-29`. It expired 19 days ago.**
  Every Feather install that fetched it, and every build made since, fails Fully Local until backloop.dev
  rotates it. This is how the scheme works: a CA must revoke a cert whose key is public, so the pack is short-lived
  and someone has to keep reissuing it. **iFizBox must never publish such a key itself.** That would break CA
  rules. It can use backloop.dev's pack, and it must check `notAfter` before it offers this mode.
- The phone (its `installd`/`appstored`, not our app) then connects to `127.0.0.1:<port>` for the manifest,
  images and IPA.

What still touches the internet in Fully Local: the **DNS lookup** for `*.backloop.dev` (public DNS, cached
afterwards; no DNS means no install), fetching the pack (build time, or the Update button), and Apple's own
checks (below). The IPA never leaves the phone.

#### Semi Local: plain HTTP on the phone, manifest from someone else's server

- The server runs **without TLS**. The host is the phone's Wi-Fi/cellular IPv4 (`getifaddrs`, `en0` or
  `pdp_ip0`), or `127.0.0.1` with "Only use localhost address".
- The itms-services `url=` points at
  `https://api.palera.in/genPlist?bundleid=…&name=…&version=…&fetchurl=http://<ip>:<port>/<uuid>.ipa`,
  percent-encoded twice. That is **palera1n's server**: it echoes back a manifest whose `software-package` is
  our local **http** URL. iOS fetches the manifest over HTTPS from palera.in and the payload over plain HTTP
  from the phone. So iOS demands HTTPS for the manifest only, not for the IPA.
- Feather opens `/install` in an `SFSafariViewController`, and that page redirects to the itms-services link.
  It closes the sheet once the payload starts.

What touches the internet: **api.palera.in sees the app's bundle ID, name, version and the phone's LAN IP**,
on every install. The IPA stays on the phone. "No server of ours" holds, but it's a third party. iFizBox must
say so in the UI.

#### Both server modes: keeping the server alive, progress, self-update

- When the install dialog appears the app goes to the background, but its server must keep streaming the IPA.
  Feather plays silent audio (`BackgroundAudioManager`, `UIBackgroundModes = [audio]`) for as long as the
  install sheet is up. That's an App Store violation, but fine for a sideloaded app. `beginBackgroundTask` alone
  gives about 30 s, which isn't enough for a large IPA.
- Progress: polls private `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:`, and Open uses
  `openApplicationWithBundleID:`. Both are reached through base64-hidden selectors
  (`NimbleKit/.../UIApplication+open_private.swift`), and both work from a sideloaded app. That corrects
  `docs/ipa.md`'s blanket "`LSApplicationWorkspace` is blocked for third-party apps": some calls do work for
  sideloaded apps. Listing all installed apps is still not shown to work.
- Feather won't install **itself** through the server ("use an alternative tool to update it"), because the
  install kills the process that serves the IPA. iFizBox has the same limit: it can't update itself in sideload
  mode by itself.

#### idevice: no server, no TLS, no internet

`IDeviceSwift/InstallationProxy/InstallationProxy.swift` and `Heartbeat/` in IDeviceKit, over the Rust idevice
library. The app talks to the phone's own lockdownd as if it were a computer on USB:

- **Setup, once:** a pairing file (`pairingFile.plist`) made on a computer (with jitterbugpair, iloader or
  idevice's tools) and imported, plus the App Store app **LocalDevVPN**. That app runs a loopback VPN, so the
  device is reachable at `10.7.0.1`. Feather keeps a lockdown heartbeat alive in the background. iOS 17.4+ uses
  the RSD/RemotePairing tunnel (`tunnel_create_rppairing`); older versions use plain TCP lockdown.
- **Install:** AFC writes the IPA to `PublicStaging/`, then `installation_proxy_install_with_callback` asks
  installd to install it, with real progress callbacks. It can update the app itself (`suspend:` in the call).
- Internet: none. The pairing file is the risk. It's a full lockdown credential for the phone, so keep it like
  a key.
- Cost: IDeviceKit pulls `IDevice.xcframework` as a binary download from idevice's GitHub release. Build it from
  source for iFizBox, to keep GPL corresponding-source simple.

### 4. What Apple still checks, whatever the mode

This is iOS behaviour, not Feather's. It is from Apple's docs and common knowledge, not measured here.

- The **profile must cover this phone**: development or ad hoc profiles with the UDID in `ProvisionedDevices`, or
  an enterprise profile (`ProvisionsAllDevices`). Development and ad hoc need **Developer Mode** (iOS 16+).
- **Enterprise certs**: the first launch needs the user to trust the developer in Settings → VPN & Device
  Management, which goes online. iOS also checks the profile periodically (`ppq.apple.com`; that's the
  `PPQCheck` field, and Feather's "PPQ Protection" randomises bundle IDs to dodge it). Revoked certs stop working.
- **OCSP** for the signing cert (`ocsp.apple.com`) at install and launch, cached.

## How jailbreak installers do it (N9's jailbreak route)

On a jailbreak, iFizBox's root helper (N2) can install an IPA directly. There's no itms-services and no server.

- **AppSync Unified** (`AppSyncUnified-installd/AppSyncUnified-installd.x`): a Substrate tweak in installd that
  hooks `MISValidateSignatureAndCopyInfo` (`…WithProgress` since iOS 14) and returns success, so installd takes
  ad hoc-signed, fake-signed or unsigned-but-ldid'd apps. `control`: `firmware (>= 5.0)`, `firmware (<= 18.2)`.
  **It doesn't claim iOS 18.3+**, so no iOS 26/27 jailbreak should be assumed to have it.
- **`appinst`** (`appinst/appinst.m`, ships with AppSync): unzips the IPA and calls
  `[[LSApplicationWorkspace defaultWorkspace] installApplication:[NSURL fileURLWithPath:ipa] withOptions:@{@"CFBundleIdentifier": id} error:]`
  (iOS 8+). It falls back to `MobileInstallationInstall` on iOS 5-7. Entitlements it needs
  (`appinst_entitlements.plist`): `com.apple.private.mobileinstall.allowedSPI = [Install, InstallForLaunchServices]`,
  `com.apple.security.exception.mach-lookup.global-name = [com.apple.mobile.installd]`, `platform-application`.
  GPL-3.0, so N2 can copy it as-is. The IPA must still be signed in a way installd accepts: validly signed for
  this phone, or anything with AppSync.
- **TrollStore** (`RootHelper/main.m`, `installApp`): first tries `installApplication:withOptions:@{LSInstallType: 1, PackageType: @"Placeholder"}`
  on a temp copy. If that fails, it creates the container itself with
  `[MCMAppContainer containerWithIdentifier:createIfNecessary:YES …]`, copies the `.app` in, fixes permissions,
  and registers it with LaunchServices (`registerPath`, in `uicache.m`). On stock iOS (14.0-16.6.1, 16.7 RC, 17.0)
  it signs with the **CoreTrust bug** (`apply_coretrust_bypass`, from ChOma), so apps run with any entitlements and
  never expire. Those versions aren't iFizBox's iOS 26/27 target.
- **TrollStore Lite** (`TrollStoreLite/`, `#ifdef TROLLSTORE_LITE`): the same installer for jailbroken phones.
  No CoreTrust bypass: it ad hoc-signs with **ldid** (`signAdhoc`, `Depends: ldid`) and relies on the jailbreak
  to run ad hoc code. It only refuses FairPlay-encrypted main binaries. This is the closest model for iFizBox's
  jailbreak mode: helper + ldid + `installApplication`, falling back to MCM + register.
- **Hand-off**: TrollStore and TrollStore Lite take `apple-magnifier://install?url=<IPA URL>` when the user turns
  the URL scheme on. iFizBox can offer "Install with TrollStore" when `canOpenURL` says it's there (that needs
  `apple-magnifier` in `LSApplicationQueriesSchemes`).
- **Licence trap**: don't copy TrollStore's `uicache.m` (BSD-4-Clause). Use the jailbreak's own `uicache -p <path>`
  (uikittools, a dependency) or write our own `registerApplicationDictionary:` call.

## What iFizBox reuses

| Piece | Take from | How |
|---|---|---|
| Profile parsing | Feather `CertificateReader` | Copy (GPL), add CMS signature verification later if wanted |
| p12 password check, signing, revocation check | Zsign-Package (`Zsign` Swift product + `ZsignC`) | SwiftPM dependency, MIT, pinned |
| Bundle-ID rewrite across extensions, Info.plist cleanup, `_removePresetFiles`, arm64e fix-up, entitlement merge | Feather `SigningHandler` | Copy the functions we need (GPL), drop tweak injection, Liquid Glass and icon options |
| Local install server + manifest | Feather `ServerInstaller*` | Port the routes. Use SwiftNIO + NIOSSL directly rather than all of Vapor (smaller, same TLS loading) |
| Keep-alive during install | Feather `BackgroundAudioManager` | Copy, only for the install sheet's lifetime |
| Install progress / Open | `UIApplication+open_private.swift` | Copy (GPL) |
| idevice route | IDeviceKit + idevice | SwiftPM, MIT. Later, behind an "Advanced" switch |
| Jailbreak install | AppSync `appinst` (GPL) + TrollStore Lite flow (MIT parts) | In the N2 helper, with appinst's entitlements |

Credit goes in the About screen and `native/` NOTICE: Feather (khcrysalis, samara, GPL-3.0; server code from
Lakr Aream), zsign (zhlynn, MIT), IDeviceKit/idevice (khcrysalis, jkcoxson, MIT), AppSync Unified (Karen/あけみ,
Linus Yang, GPL-3.0), TrollStore (opa334, MIT), backloop.dev (its pack, used, not shipped).

## What N9 needs (share sheet → install an IPA)

**Sideload mode: replace the sidedrop step.** N9's text still says "send it to sidedrop's 'Sign your own IPA'
(POST /sign …)". That is overruled. The new route:

1. **Settings → Signing**: import `.p12` + password + `.mobileprovision` (Files picker and document types; no
   `export-certificate`). Show the team, expiry, wildcard or explicit, and whether this phone's UDID is listed.
   The app can't read its own UDID: show the device list and let the user confirm. The password goes in the
   Keychain.
2. **Sign on the phone** with zsign. Wildcard profile: keep the bundle ID (or let the user prefix it). Explicit
   profile: re-ID to that ID and **remove `PlugIns/`**, and say so before signing.
3. **Install**, with the mode in Settings → Installation:
   - **Local** (default when a valid pack exists): HTTPS on `local.backloop.dev:<port>` with backloop's pack.
     Check `notAfter` when the app starts and before every install. If it's expired, offer to fetch a new pack,
     or fall back.
   - **Semi-local**: HTTP on the phone + manifest from `api.palera.in`. A one-time notice names the third party
     and what it sees.
   - **idevice** (advanced, later): pairing file + LocalDevVPN.
4. Record the version for I3 from the signed bundle's `CFBundleShortVersionString`.

**Jailbreak mode**: the N2 helper installs it like `appinst` (`installApplication:withOptions:`), with appinst's
entitlements on the helper. Without AppSync, sign first (same zsign path, or ldid ad hoc where the jailbreak runs
ad hoc code, as TrollStore Lite does). With AppSync, install as-is. If TrollStore is present, also offer the
hand-off.

Tests N9 can run on Linux: classify the profile (wildcard/explicit, device count, expired) from fixture
`.mobileprovision` plists, the bundle-ID rewrite on a fixture `.app` tree, the manifest plist and the double-encoded
genPlist URL, and the pack-expiry check.

## What I2 needs (iFizBox itself as a sideload IPA)

- I2's text says "signed through sidedrop's ad hoc profile". **Overruled the same way.** Build the IPA unsigned,
  then `codesign -s -`/`ldid -S` ad hoc, as Feather's `Makefile` does (`CODE_SIGNING_ALLOWED=NO`, then copy
  `.app` → `Payload/`, zip). The user signs and installs it with whatever they already use (Feather, SideStore,
  AltStore, a computer). Once installed, iFizBox signs other IPAs itself.
- Entitlements for the sideload build: `get-task-allow` only, like Feather. No App Groups or push (wildcard
  profiles can't have them; see `docs/ipa.md`).
- Info.plist for the sideload build: `UIBackgroundModes: [audio]` (install keep-alive, alongside I3's
  `fetch`/`processing` for BGAppRefreshTask), `CFBundleDocumentTypes` for `.ipa` (`com.apple.itunes.ipa`),
  `.p12`, `.mobileprovision`, a URL scheme (`cydian://`), and `apple-magnifier` in `LSApplicationQueriesSchemes`.
- If iFizBox bundles a backloop pack at build time, that's an internet fetch in the build. Better: fetch it at
  first use and keep it in `Documents/`.
- Self-update: as with Feather, the server route can't update the running app. Say so, and point to the user's
  original tool (or the idevice route once it exists).

## Not verified

Everything below comes from reading code, not from a phone. There is no phone in scope, and the 4S runs iOS 6.

- That itms-services on current iOS (26) still accepts a `127.0.0.1` manifest over HTTPS, a plain-HTTP
  payload URL, and the literal `*.backloop.dev` hostname. Feather ships all three, which suggests they work. Not
  tested.
- Whether a user-installed, fully trusted root CA would let iFizBox make its own cert for a local manifest
  (that would remove backloop.dev). Not checked. It also needs the user to install a profile, which is heavy UX.
  Answered later (F75, 2026-11-17): it doesn't. I6 built it; Safari reached the HTTPS server with that certificate
  fine, but iOS's installer ignored the hand-trusted root and every install failed. Removed; the app takes the
  manifest from the Signing Server instead (docs/signing.md, "The install step").
- Whether iOS checks revocation for the backloop TLS cert, which would make Fully Local fail once the CA revokes
  it but before `notAfter`.
- The expired pack (`notAfter 2026-10-29`) is what `https://backloop.dev/pack.json` served on 2026-11-17. I
  didn't watch whether or how often it rotates.
- AppSync's `firmware (<= 18.2)` cap and TrollStore Lite's reliance on the jailbreak running ad hoc code are from
  their package metadata and code. Untested on any iOS 26/27 jailbreak, since none exists for us yet.
- Apple's online checks (OCSP, PPQ, enterprise trust) are from general knowledge, not observed traffic.
- Upstream zsign's per-extension profiles: seen in its README only, not in the code.
