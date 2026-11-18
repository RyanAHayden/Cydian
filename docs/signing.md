# Signing with your own certificate (I5, I6)

Only the Cydian app's sideload build signs: it signs every app **on the iPhone** with your certificate, which never
leaves the phone for other apps, and needs a server only for iOS's install manifest and Cydian's own update. That
server is the Signing Server: `https://sign.cydian.dev` by default, a Cloudflare Worker anyone can deploy for
themselves (`worker/`, `worker/README.md`). [On the phone (I6)](#on-the-phone-i6) has the whole picture.

## The website signs nothing (F89)

cydian.dev is one Cloudflare Worker with no server of its own (user 2026-11-18: the NAS that ran I5's zsign signer
and Web Push is gone, and so are `web/signer/`, POST `/sign` and its jobs, Settings > Signing and the certificate on
the website, Bring My Certificate, Import from Safari and the website's upgrade alerts). What the website does instead:

- **An app's page** (and Version History's rows, and My IPAs' links): Install offers hand-offs
  (`web/app/screens/handoff.js installLinks`, `altstore.js installRows`):
  - **Open in Cydian**: `cydian://install?url=<ipa>&name=<name>`. The app (`incoming.js`) opens Install IPAs, asks
    "Install IPA", then signs and installs it on the phone (`signAndInstall`). Safari can't tell whether Cydian is
    installed; without it Safari says the address is invalid.
  - **Get in AltStore / SideStore / Feather**: their install links (`altstore://install?url=`,
    `sidestore://install?url=`, `feather://install/<https url>`; the shapes `core/otherlinks.js` reads back).
  - **Download IPA**.
  A source's own signed link (`itms-services`) still installs straight away. The nav bar's Install lists the
  hand-offs in an action sheet. Nothing queues on the website (the F80 queue is the sideload app's).
- **Home's Install Cydian App** (Not Jailbroken): an action sheet that adds Cydian's own AltStore source
  (`core/appoffer.js APP_SOURCE_URL`) to AltStore, SideStore or Feather, or downloads the latest `Cydian.ipa`
  (`home.js appInstallChoices`). Jailbroken visitors get the release's `.deb`, as before. **Send Settings**
  (Open in Cydian App, `screens/importlink.js`) stays: sources, travelling settings and Ignored Upgrades, never a
  certificate or a server.
- The app's own Essential Upgrade, when it can't sign Cydian itself (no bridge), opens cydian.dev in Safari for that
  same sheet (`core/essential.js installSelf`).

A browser that registered the old push service worker drops it at the next visit (`app.js`).

## On the phone (I6)

The Cydian app's sideload build (I2) signs IPAs by itself and serves the signed IPA from the phone; the certificate
never leaves it when installing other apps (the one exception, Cydian updating itself, is F73 below). Only the
install manifest comes from a server: the Signing Server (sign.cydian.dev by default, or the user's own deployment of
`worker/`), which sees the app's bundle ID, version and name. User 2026-11-17 first asked for it all
local ("so they dont rely on me"); F75 removed the fully local mode because iOS refused it (below). In the jailbreak build none of this runs: the N2 helper installs IPAs directly, and the `signing.*` calls answer
code `jailbreak`.

### The install step: the options

Signing on the phone is plain work (below). Installing is the hard part: a sideloaded app can't call installd, so
the only door is `itms-services://?action=download-manifest&url=<manifest>`, and iOS fetches that manifest only
over **HTTPS with a certificate it trusts**. The IPA the manifest names can be on plain HTTP (Feather's Semi Local
relies on it). What could serve a trusted manifest:

| Option | Trusted how | Needs | Verdict |
| --- | --- | --- | --- |
| **A. backloop.dev** (Feather's Fully Local): `*.backloop.dev` resolves to 127.0.0.1, served with a public CA's wildcard certificate whose private key is published | a public CA | backloop's pack fetched, public DNS | **No.** A CA must revoke a certificate whose key is public, so the pack lives on borrowed time: on 2026-11-17 it had expired 19 days earlier (docs/sideload.md). Shipping our own such key breaks CA rules; using theirs makes installs depend on a third party re-issuing it. |
| **B. A manifest from a server, IPA from the phone** (Feather's Semi Local, **built**, 0.1.4): `GET <server>/sign/manifest?bundleid=&version=&title=&port=&path=` answers a manifest whose IPA URL is `http://127.0.0.1:<port>/<path>` | the server's own certificate | the Signing Server (sign.cydian.dev by default, or the user's own), which sees the app's bundle ID, name and version on every install | **Used.** Nothing to set up on the phone; the certificate and the IPA stay there. |
| C. A CA made on the phone: the user installs Cydian's own root as a profile and turns on full trust; an HTTPS server on 127.0.0.1 uses a certificate it issues | the user's own trust setting | a one-time setup in Settings | **Removed (F75).** Built in I6, but it never worked: iOS's installer ignores a hand-trusted root. The user's test page on that server opened fine in Safari while every install through it failed. |
| D. A pairing file + LocalDevVPN (idevice, Feather's third mode) | lockdownd, no TLS | a computer once to make the pairing file, an App Store VPN app | Works without any certificate, but it needs a computer and keeps a full lockdown credential on the phone. Later, maybe, behind an advanced switch (docs/sideload.md). |
| E. A `data:` URL or a file URL as the manifest | – | – | Not accepted: the manifest URL must be https. |

So every install in the app takes its manifest from the Signing Server; with no server set (or one that isn't
https) `signing.install` and `signing.resignAll` answer `no_server`, and Install opens Settings > Signing at the
server step.

### Setting it up (once)

1. **Settings > Signing**: the `.p12`, its password and the `.mobileprovision`. In the app they go
   to `signing.import`: the `.p12` is opened with `SecPKCS12Import` and its identity (certificate and private key)
   is added to the iOS Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (never synced to iCloud, never in
   a backup that restores to another phone). F73: the `.p12` file as picked and its password are kept too, as one
   Keychain generic-password item (service `com.ryha.cydian.signing.p12`, also `...ThisDeviceOnly`), for Cydian's own
   update (below); nothing else reads it. The checks are I5's: a wrong password, an expired certificate or profile, a certificate the profile
   doesn't list.
2. **A Signing Server**: sign.cydian.dev unless the user enters their own (a saved cydian.dev, the website's old
   signer, counts as the default). That's all (F75): no profile to install, nothing
   to trust. A phone that ran 0.1.x drops the old local CA's keys and files at launch
   (`SignStore.removeOldInstallCA`); its old profile stays in iOS Settings until the user deletes it.

Remove Certificate (`signing.remove`) deletes the identity and the kept `.p12` from the Keychain, and the profile
file.

### What leaves the phone, and when (F73)

Installing other apps sends only the app's bundle ID, version and name (to the Signing Server, for the manifest):
they are signed on the phone and served from 127.0.0.1. Cydian itself can't be served that way (iOS closes Cydian
while it installs, which stops its install server), so Cydian's own update is signed on the phone too and then
uploaded to the Signing Server (`signing.install {host: true}`, `POST /sign/host`), which holds that signed IPA for
10 minutes and serves it to iOS (`worker/README.md`). The certificate and key stay on the phone; the signed Cydian
(which embeds the profile, as every signed app does) is on the server for those 10 minutes.

`signing.export` (F73: the `.p12` and password kept in the Keychain) is still in the shell, but nothing on the page
calls it since the website's signer went (F89).

### The page's side (F58)

In the sideload build Settings > Signing has the Certificate rows (`.p12`, `.mobileprovision`, Password, each
with Browse; one pick can fill all three), but the picks wait in memory only (`signing-client.js`: no IndexedDB)
until all three are there and the password isn't known to be wrong, then go to `signing.import`; after that only the
file names stay, until the app quits. The rest of the page comes from `signing.status`: the identity and its profile
(`core/signing.js deviceSummary`, the signer's `problem` as its footer) and Remove Certificate (`signing.remove`).
F69/F75: the page is a walkthrough (`screens/signing.js`) of two steps, each ticking green once done: **Import Your
Certificate** (a big Select All Files button over the three rows: one multi-select pick of the `.p12`, the
`.mobileprovision` and the password file, or their `.zip`, fills whatever is missing; the picture is today's iOS file
picker, drawn, unless `web/app/icons/steps/select-files.png` holds a real screenshot) and
**Signing Server** (the server row and Check Server). Install on an AltStore app's page and Version History's rows
first look whether both are there (`firstInstallCheck`: `signing.status` and `getServer()`); the first Install with
one missing opens this page at that step, with no alert. Then `signing.install {url, manifestServer}`
(`installOnDevice`); the HUD follows its phase events (`phaseLabel`: "Downloading 42%", "Reading", "Signing",
"Installing") and an error alerts by its code (`deviceError`): `no_server` and `no_identity` then open Settings >
Signing. Tests: `web/app/signing-client-device.test.js`, `web/app/screens/signing.test.js` and
`web/app/core/signing-device.test.js`, against a fake `cydianNative`.

### From the website to the app (F75, F89)

- **Open in Cydian App** (Home's Send Settings, and Settings; Not Jailbroken only): `cydian://import?d=<base64url of
  gzipped JSON>`, the source list as export lines, the settings in `core/settings.js TRAVELS` and Ignored Upgrades,
  after a banner saying to press Open. The app adds what's new straight away. Gzip keeps 400 sources around 5 kB.
  Since F89 neither a certificate nor a Signing Server travels (the website keeps neither); a link from before that
  still carries them is imported without them.
- **Open in Cydian** on an app's page: `cydian://install?url=…&name=…` ("The website signs nothing", above).

Gone with the website's signer (F89): the certificate inside Cydian's own IPA (`bring`), Import from Safari
(`cydian://signing-import`) and the first-launch `transfer.link`. The shell's `BundledIdentity` launch import is still
compiled in but finds no `cydian-identity.plist` in an IPA from GitHub's releases.

The shell keeps the latest `cydian://` link (`IncomingLink`, at most 512 kB) and tells the page (`cydian:url`), which
takes it with `app.takeURL` (also at start, for a link that launched the app). `app.gunzip` unpacks the import link
where WebKit has no `DecompressionStream` (before iOS 16.4).

### Installing an app

`signing.install {url, manifestServer}`, with progress events (`downloading`, `reading`, `signing`, `installing`):

1. Downloads the IPA to the app's temporary folder (http or https, 4 GB cap).
2. Signs it on the phone (`native/sign/`, below), into a second file.
3. Starts the plain HTTP server (Network.framework, `NWListener` bound to 127.0.0.1 only), serves `/<token>/app.ipa`
   (ranges supported), and opens `itms-services://?action=download-manifest&url=<server>/sign/manifest?bundleid=…
   &version=…&title=…&port=<port>&path=<token>/app.ipa` (`InstallManifest`): the Signing Server answers a manifest
   pointing at `http://127.0.0.1:<port>/<token>/app.ipa`.
4. iOS asks to install and fetches the IPA from 127.0.0.1. Once the whole IPA has gone out the token is spent and the
   file is deleted a minute later; unused, it goes after 15 minutes. A background task keeps the server alive while
   the install sheet covers Cydian.

Nothing listens on Wi-Fi or cellular; every path has a random 128-bit token.

### The signer (`native/sign/`)

Cydian's own, in Swift, with no OpenSSL: the private key stays inside Security.framework (`SecKeyCreateSignature`)
and only the CMS signature comes out. zsign (I5's server signer) would need the key handed over as a file or bytes
and OpenSSL cross-compiled into the app; this way neither. It writes what Apple's `codesign` writes:

- each Mach-O (thin, or fat with its 64-bit slices kept): a SuperBlob of a CodeDirectory (version 0x20400,
  SHA-256, 4 KiB pages, the team ID, the executable segment with the main-binary flag), an empty requirement set,
  the entitlements as XML and as DER (iOS 15+ reads the DER ones), and a detached CMS SignedData over the
  CodeDirectory with the signed attributes iOS reads (content type, signing time, message digest, the CDHashes plist
  and the CDHashes2 attribute) and the certificate chain: the user's certificate, then Apple's WWDR intermediate and
  root picked by issuer from `native/sign/certs/` (public certificates from apple.com/certificateauthority);
  an unsigned binary gets an `LC_CODE_SIGNATURE` in the room after its load commands; an App Store-encrypted one is
  refused;
- each bundle inside out (frameworks and extensions before the app): `_CodeSignature/CodeResources` sealing every
  file with SHA-1 and SHA-256 (nested bundles' files included, as zsign seals them; symlinks as links; `.lproj`
  optional), `embedded.mobileprovision` in apps and extensions, the entitlements narrowed per bundle as I5 does
  (`application-identifier` and the keychain group set to the bundle's ID, `get-task-allow` off);
- I5's bundle ID rules: a wildcard profile keeps the app's ID (a `com.you.*` one moves it under the prefix if it
  doesn't fit), an explicit one renames the app and **leaves out its extensions and Watch apps** (one profile, one
  app ID), and says which in `removed`. Extensions' IDs follow the app's;
- zip to zip: the IPA is read once to hash every file and is never unpacked to disk; untouched entries are copied
  still compressed, only signed binaries, changed Info.plists and the new files are deflated. ZIP64 is read and
  written.

F14 added the arm64e fix-up and the user's edits (below). Not done: dylib injection (not wanted).

### Before and around signing (F14)

`native/sign/SignOptions.swift`, `Inspect.swift`, `CertCheck.swift` (Linux-tested) and `native/Sources/Sideload.swift`
(the phone half, which also took over `signing.install` from `SignBridge.swift`). The calls are listed at the top of
`Sideload.swift`.

- **Look first.** `signing.inspect {url}` downloads the IPA, keeps it 15 minutes under a token and answers what it is
  and asks for: name, bundle ID, version, minimum iOS, size, its entitlements (read from the main executable's
  current signature; none when unsigned), its privacy permissions (the `NS…UsageDescription` keys, with Settings'
  names and the app's own reason), its extensions and Watch apps (path, ID, extension point), its icon (the PNG as it
  is in the IPA: often Apple's CgBI form, which a browser can't draw), the entitlements the user's profile can't give
  it (`missing`: the signed app goes without them), the ID it will be signed as, and the profile's kind (Development,
  Ad Hoc, Enterprise, Distribution, as the site's `profileKind`).
- **Edit.** `signing.install {token | url, name?, bundleId?, icon?, removeExtensions?, fixArm64e?}` signs with them:
  the name goes into `CFBundleDisplayName`, `CFBundleName` and every `<lang>.lproj/InfoPlist.strings` that names
  either (rewritten as a binary plist); the bundle ID is asked of the profile (I5's rules, so an explicit profile
  still signs as its own ID) and extensions follow it (`old.share` -> `new.share`); the icon (a PNG the page sizes,
  180x180 best) is written as `CydianIcon60x60@2x.png` and `@3x.png` and named in `CFBundleIcons` (and `~ipad`), with
  `CFBundleIconName` dropped so iOS doesn't take the asset catalog's; `removeExtensions` leaves those bundles out
  (an unknown path is refused). Bad input answers `bad_options`.
- **arm64e fix-up**, on by default: Feather's `_locateMachosAndFixupArm64eSlice` (via LiveContainer's
  `LCPatchMachOFixupARM64eSlice`, Apache-2.0): a fat binary's arm64e slice of the old pointer-auth ABI (subtype
  exactly 2) gets `CPU_SUBTYPE_LIB64` in its own header and the fat header, which iOS 26 wants. Done on every Mach-O
  the signer signs, before signing (Feather only does `.dylib`s and frameworks' executables; the change only touches
  a fat file's old-ABI arm64e slice, so doing all of them costs nothing and covers bundles' and extensions' too); the reply lists the fixed ones in `fixedArm64e`.
- **Keep-alive.** From the moment the itms-services link opens until iOS has fetched the whole IPA (plus a minute),
  or the link expires, Cydian plays one second of silence on a loop (`AVAudioPlayer`, volume 0, mixed with other
  audio; `UIBackgroundModes: audio` is in `Info-sideload.plist`), as Feather's `BackgroundAudioManager` does: the
  install sheet sends Cydian to the background, and I6's `beginBackgroundTask` alone gives about 30 seconds.
- **Install progress.** `signing.progress {bundleId}` streams iOS's own progress from the private
  `LSApplicationWorkspace installProgressForBundleID:makeSynchronous:` (looked up at run time, as Feather does) and
  answers `installed: true/false` when it ends, `false` when none showed in 45 seconds, `null` when the API isn't
  there. It is its own call because the bridge drops a call's stream once it has answered, and `signing.install`
  answers as soon as iOS has the link.
- **Re-sign All.** Every install is recorded in `Application Support/Signing/signed.json` (installed and original ID,
  name, version, the IPA's URL, when, its signature's expiry (the earlier of the certificate's and the profile's),
  and the edits). There is no IPA library: `signing.resignAll` downloads each again from its URL, signs it with the
  current certificate and the same edits, and installs them one after another (the next once iOS has fetched the
  previous IPA, or its link expired), answering which worked and which didn't. `signing.installed` lists the
  records; `signing.forget {bundleId}` drops one.
- **Revoked?** `signing.checkCertificate` asks the OCSP responder in the certificate's AIA extension (Apple's
  `ocsp.apple.com`), over plain HTTP as OCSP is, with a request naming the certificate by its issuer (Apple's WWDR
  intermediate from `certs/`) and serial: no nonce, unsigned. The answer is `good`, `revoked` (with `revokedAt`) or
  `unknown`; its signature isn't checked (Feather's doesn't either): it's a warning, and iOS checks for itself when
  the app opens. The last answer is cached and `signing.status` shows it as `identity.revocation`, beside
  `identity.signatureExpires` and `profile.kind`. Asking is an internet call to Apple only when the page asks.
- **Re-sign reminder.** `signing.remind {days}` (the Settings row F13 made) keeps one local notification at 10:00,
  `days` before the earliest recorded signature expiry (or the certificate's and profile's, with no apps yet):
  "Delta stops opening in 2 days. Open Cydian and tap Re-sign All." It moves after every install and `forget`; 0 turns
  it off. The first call asks for notification permission.

Not built from F14's original brief, and why: backloop.dev and api.palera.in installs (I6 chose the phone's own CA
instead, above), so no backloop pack expiry check or genPlist URL encoding; Zsign-Package (I6's own signer replaces
it).

### The page's side (F68)

- **Install** on an AltStore app in the sideload build (`signing-client.js` `signAndInstall`, so the package page,
  Sign with My Certificate and Version History alike) signs and installs straight away (F81, one tap). **Custom
  Install**, the row under it on an app page (`signing-sheet.js` `customInstall`), goes through `signing-sheet.js`:
  `signing.inspect` under a Downloading HUD, then a sheet (iOS 6 grouped table, **Install** at the top right of its
  bar, a red **Cancel** at the bottom): the app's head, **Install As** (Name, Bundle
  ID, Icon: Choose draws the picked image centred and cropped into a 180x180 canvas and sends that PNG), App
  (version, size, minimum iOS, profile kind), Permissions, Entitlements (each one the profile lacks marked Missing),
  **Your Profile Can't Give It** (red), and Extensions with a switch each (off leaves it out). The IPA's own icon is
  shown when it's a plain PNG; Apple's CgBI PNG (most) can't be drawn, so a letter placeholder stands in.
  **Install** sends `signing.install {token, ...}` with only what changed (`core/signing.js installParams`: a
  name or ID left as it was isn't sent; a bad ID is refused before signing), then `signing.progress {bundleId}`
  keeps the HUD on "Installing N%" until iOS says it's installed. A shell without `signing.inspect` installs as
  before (straight `signing.install {url}`).
- **Through the queue (F84)**: on an app page, Install (the nav button and the Install row) queues the app with no
  sheet and opens Confirm (`screens/queue.js`); Custom Install's sheet Install queues it with its options
  (`altstore.js appPageCustom`, `signing-sheet.js inspectToQueue`) kept on the job (`core/appqueue.js` `options`:
  the look's token and time, the edits). Confirm signs each in turn with its own options (`queue.js installCustom`):
  the token while it's under 14 minutes old (the phone keeps the looked-at IPA 15), else `{url, ...edits}`, which
  downloads it again; a token goes with one try only. The Queue row says what's custom ("Custom: as \"Name\", ID").
  Version History's rows still sign straight away.
- **Settings > Signing** (sideload, under the walkthrough; `screens/signed-apps.js`): Certificate Status with Check
  Certificate (`signing.checkCertificate`; the row shows Good / Revoked / Unknown / Not Checked from
  `identity.revocation`) and a red footer when the certificate is revoked or `identity.signatureExpires` is under 7
  days away (`certificateWarnings`); Signed Apps from `signing.installed`, soonest to expire first, with Re-sign All
  (`signing.resignAll`, one HUD whose label follows each app: "Signing 40% Delta (1 of 3)", then an alert for any that
  failed) and a left swipe to Delete, which is `signing.forget`.
- **Re-sign Reminder** shows (FEATURES has `resign`); its value goes to `signing.remind {days}` on every change and
  at launch (`screens/settings.js remindNow`, `core/signing.js syncReminder`).

### My IPAs (F77)

Installed > My IPAs is the user's own IPAs. In the sideload app they are plain files in Cydian's Documents, which
Files shows under On My iPhone > Cydian (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`), so an IPA
dropped there from Files is listed too. Add offers Browse (the iOS Files picker, several at once) and From URL (the
Add alert with Paste); an .ipa another app opens in Cydian (AirDrop, Files, Mail: the document type in
`Info-sideload.plist`) is copied in and its page opens (`cydian://myipas?file=<name>`, `web/app/incoming.js`).

- `native/sign/Library.swift` (`IPALibrary`, Foundation only, tested on Linux in `native/sign/tests/main.swift`):
  the list, the details cache (by size and date) with the icon, each IPA's Sign Options, and the signed copy in
  Application Support/MyIPAs. A signed copy counts only while it fits: same file, the certificate in use, the
  Sign Options set now, signature not expired. Anything else is "Not signed yet".
- `native/Sources/MyIPAs.swift`: the `library.*` bridge calls (list, add, pick, options, sign, install, export,
  delete). Sign Now signs offline. Install signs if needed and then installs through `Sideload.serveAndOpen`, the
  second half of `signAndOpen`, with the Signing Server's manifest. The server gets a copy, so the signed copy stays.
  The record's url is `library:<file>`, so Re-sign All signs from the library's file instead of downloading.
- `web/app/signing-client.js` `installFromLibrary`: signs first, then checks that `<server>/sign/status` answers.
  Offline it says installing needs the Signing Server for iOS's manifest and keeps the signed copy.
- `web/app/core/myipas.js` holds the states and rows, and `web/app/screens/myipas.js` draws the pages. On the
  website the library is a list of links kept in localStorage: Add is From URL only, and Install offers the
  hand-offs (Open in Cydian, Get in AltStore / SideStore / Feather, Download IPA: `siteInstallChoices`). There are no
  Sign Options there.

### Tests

`native/test_sign.py` builds `native/sign/` with `native/sign/tests/main.swift` for Linux (the Swift toolchain the
native build uses; it skips and says so without one) and runs it against `web/signer/testkit.py`'s throwaway CA,
certificate and profiles, with openssl holding the key. It signs a fixture IPA with a framework, a loose dylib, an
extension, localisations, a symlink and an old signature's leftovers, then re-signs the result, signs with an
explicit profile, signs an unsigned and a fat binary, and, where the build made one, `native/build/Cydian.ipa`
itself. Each signature is read back: identifier, team, every page hash, the Info.plist, requirements,
CodeResources and entitlement slots, and the CMS checked by `openssl cms -verify`, also against the test CA. Python
then reads the signed IPA again on its own (the DER entitlements decode to the XML ones; CodeResources lists exactly
the bundle's files with their real hashes). Also: SHA vectors, the DER entitlements bytes, a zip round trip, the
profile rules, refusals (not an IPA, a path out of the folder, an encrypted binary), the manifest and itms link, and
the HTTP parsing and ranges. F75: `test_sideload.py`'s Swift also covers `BundledIdentity` (parse, the first-launch
rule), `IncomingLink` and `gunzip`; its `HandoffSourceTest` reads the sources for the URL hand-off, the launch import
and that nothing of the local CA is left. Node: `core/transfer.test.js` (the import link's encode/decode and
review), `incoming.test.js` (the hand-off, `cydian://install` and the import's merge), `screens/siteinstall.test.js`
(F89: the website's Install rows, Home's Install Cydian App sheet, My IPAs' links). `rcodesign verify`
also passed on the signed fixture and the signed Cydian.ipa (by hand, not in the gate).

The phone half (Keychain, `NWListener`, opening the links, the scene's URL contexts) compiles in the native build but runs only on an iPhone.
F73: `test_sign.py` also checks that `signing.export` is registered and answers `p12`, `profile` and `password`
from the kept item, and that `signing.remove` deletes that item.

`native/test_sideload.py` (F14) builds the same way with `native/sign/tests/sideload/main.swift`: profile kinds,
signature expiry, the bridge's options and their refusals, `.strings` parsing (UTF-8 and UTF-16), the arm64e fix-up
on fat fixtures, the inspector, signing a fixture with two extensions, localised names and an old-ABI arm64e
framework with a new name, ID and icon and one extension left out (Python then reads the IPA: the plists, the
CodeDirectory identifiers, the icon files sealed in CodeResources, the fixed slice, `openssl cms -verify` against the
test CA), an explicit profile overriding the asked-for ID, OCSP (the request checked by `cryptography`, answers made
by its OCSP builder: good, revoked, unknown, another certificate's, tryLater), the reminder's date and words, and the
record of signed apps. The phone half of F14 (audio, `LSApplicationWorkspace`, notifications, the OCSP fetch) is
compiled by the native build only.
