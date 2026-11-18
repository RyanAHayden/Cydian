# Signing with your own certificate (I5)

Cydian's site can sign an AltStore app with **your** certificate and install it over the air. You keep a `.p12`
(certificate and private key), its password and a `.mobileprovision` in Settings > Signing; Install on an app's
page then signs that app on a signing server and opens the `itms-services://` link it answers with. The server is
cydian.dev by default, or any server you run yourself (below). Signing on the phone itself is the Cydian app's
sideload build, which needs the server only for the install manifest: [On the phone (I6)](#on-the-phone-i6).

This is Cydian's own signer: `web/signer/` (Flask blueprint, Python) driving
[zsign](https://github.com/zhlynn/zsign) (MIT License, which GPL-3.0-or-later can include; built into the Docker
image from a pinned commit of tag v1.1.3, its tarball checked by SHA-256; licence text at
`/usr/local/share/licenses/zsign/LICENSE` in the image).

## How it works

1. **Settings > Signing** (the site only; `web/app/screens/settings.js`, parsing in `web/app/core/signing.js`).
   Pick the `.p12`, type its password, pick the `.mobileprovision`. The page reads them on the phone:
   - the profile's plist (it sits in plain bytes inside the CMS signature): name, team, app ID, expiry, how many
     devices it lists (or All, for enterprise), and the certificates it names (`DeveloperCertificates`, whose
     subject gives the certificate's name, team and expiry);
   - the password against the `.p12`'s MAC (RFC 7292's own key derivation plus HMAC, in WebCrypto), so a wrong
     password shows at once, whatever the file encrypts its contents with.

   The page shows the certificate's name, team, its expiry, the profile's expiry, the device count and the app ID,
   and says what's wrong (expired, wrong password). The `.p12` can't be opened in the browser (its certificate bag
   is usually encrypted with RC2 or 3DES, which WebCrypto lacks), so the certificate shown is the one in the profile
   of the profile's own team; the server checks that the `.p12`'s certificate is in the profile.
2. **Install** (the nav bar button on an AltStore app's page, as Cydia's package page; `browse.js packageActions`).
   With a certificate saved and a version that has an `http(s)` IPA, the button signs and installs: a HUD
   "Signing" while the server works, "Installing" as the link opens and iOS asks to install. Without a certificate
   it does what F29 does (the source's own signed link, a sideloader, the IPA), plus "Sign with My Certificate",
   which opens Settings > Signing. Version History's rows sign the same way.
3. **POST `<server>/sign`** (`web/signer/__init__.py`), JSON `{url, p12, profile, password}` (the files base64).
   The server, in order:
   - rate-limits the address (10 per 10 minutes);
   - opens the `.p12` with the password, reads the profile, and refuses with a clear error: a wrong password,
     a file that isn't a `.p12` or a profile, an expired (or not yet valid) certificate, an expired profile, a
     certificate the profile doesn't list. None of this needs the IPA, so nothing is downloaded for a bad pair;
   - downloads the IPA through the fetch proxy's SSRF guard (http and https only; no private, loopback,
     link-local, CGNAT or other non-public address, the checked IP pinned for the connection, each redirect
     re-checked; `web/fetch.py`), streaming to a job folder with a size cap and a time limit;
   - looks inside: `Payload/<App>.app/Info.plist` must be there; no entry may leave the folder; the unpacked size
     is capped (zip bombs);
   - fits the bundle ID to the profile's app ID: a wildcard `TEAM.*` keeps the app's own; `TEAM.com.example.*`
     keeps it if it starts with `com.example.`, else **refuses** ("the profile is for com.example.*, which doesn't
     fit this app"); an explicit app ID signs the app as that ID (`zsign -b`);
   - runs zsign with the profile's entitlements (zsign takes them from the profile);
   - keeps the signed IPA under a random 256-bit token and answers
     `{itms, manifest, expiresIn, bundleId, name, version}`.

   **Asynchronous jobs (F47).** The page adds `"async": true` to the JSON. The server then does the checks above
   that need no IPA (rate limit, `.p12`, password, profile, certificate, a free job slot) in the request, so a bad
   pair still fails at once, and answers **202** `{job, status: "downloading", poll: 1}` (and a `Location` header)
   while a thread downloads, inspects and signs. The page polls **GET `<server>/sign/job/<job>`** every `poll`
   seconds under the same "Signing" HUD; it answers `{job, status}` with `status` one of `downloading`, `signing`,
   `done` (plus the fields above) or `error` (plus `error`, `code` and `httpStatus`, the status the synchronous
   POST would have answered). The job id is another random 256-bit secret, as it leads to the install link. A
   finished job is kept for the signed IPA's 10 minutes; an unknown or expired one answers 404 `gone` (a server
   restart forgets them all). Without `"async"` the POST answers when signing is done, as before (curl, older
   pages); a server from before F47 ignores `"async"` and answers 200 with the link, which the page takes as well
   (`web/app/signing-client.js`, `pollJob`). The page gives up after five failed polls in a row or 15 minutes.
4. The phone opens `itms-services://?action=download-manifest&url=<server>/sign/<token>/manifest.plist`; iOS reads
   the manifest and downloads `<server>/sign/<token>/app.ipa` (a HEAD, ranges, the whole file: the installer asks more than once, so the link answers every request until it expires).

`GET <server>/sign/status` answers `{ok, zsign, maxBytes, ttl, jobs}` (`jobs`: it takes `"async"`, F47); Settings >
Signing's Check Server row asks it.

## What is stored where

| What | Where | For how long |
| --- | --- | --- |
| `.p12`, its password, `.mobileprovision`, their file names | The phone: IndexedDB `cydian-signing` of the site's origin, in that browser | Until Remove Certificate (or the browser's site data is cleared) |
| Signing server address | The phone: `localStorage["cydian.signingServer"]` (absent = cydian.dev) | Until changed |
| Certificate, key, password, profile inside Cydian's own IPA (F75, `bring: true` from Install Cydian App only) | The signed copy of Cydian the server holds under its token, then the app's bundle on the phone; the app imports it into the Keychain on first launch | 10 minutes on the server; on the phone until the next Cydian update replaces the bundle |
| Certificate, key, password, profile on the server | That request's memory only (with `"async"`, its job thread's, until the job ends). zsign gets an unencrypted copy of the key and the profile through anonymous in-memory files (`memfd_create`, opened as `/dev/fd/N`): no file on disk, no password on a command line | The request |
| The downloaded IPA and zsign's unpacked copy | The server's job folder in `CYDIAN_SIGN_DIR` | Deleted when the job ends, signed or not |
| A job's status and, once done, its install link | The server process's memory, under the job id | 10 minutes after the job ends; a restart forgets it |
| The signed IPA | `CYDIAN_SIGN_DIR`, named by the token's SHA-256 (a directory listing gives no token away) | 10 minutes; after a restart none can be fetched, and the first signing request deletes them |

Nothing about a signing request is logged by Cydian: no URL parameters carry secrets (it's a JSON body), errors
never repeat the password, and gunicorn's access log is off in the image. The page states this under Signing
Server. A reverse proxy in front of the server (Nginx, Caddy, Cloudflare) logs request lines as it is set up to;
the body, where the secrets are, isn't in a request line.

The signed IPA embeds your profile (`embedded.mobileprovision`, as every signed app does) and is signed with your
certificate: anyone who gets the install link within its 10 minutes, before you use it, could install the app
signed by you, on a device your profile lists. Treat the link like a password; it is never shown, only opened.

## Limits

| Variable | Default | What it limits |
| --- | --- | --- |
| `CYDIAN_SIGN_RATE` | `10` | Signing requests per address per 10 minutes |
| `CYDIAN_SIGN_MAX_BYTES` | `1073741824` (1 GiB) | IPA download size |
| `CYDIAN_SIGN_MAX_UNZIPPED` | 4 x the above | The IPA's unpacked size |
| `CYDIAN_SIGN_TTL` | `600` | Seconds a signed IPA waits for its download |
| `CYDIAN_SIGN_STORE_BYTES` | `8589934592` (8 GiB) | All signed IPAs waiting at once; past it, new requests get "busy" |
| `CYDIAN_SIGN_JOBS` | `2` | Signing jobs at once; more get "busy, try again in a minute" |
| `CYDIAN_SIGN_DOWNLOAD_TIMEOUT` | `300` | Seconds for the IPA download |
| `CYDIAN_SIGN_TIMEOUT` | `300` | Seconds for zsign |
| `CYDIAN_SIGN_DIR` | `<tmp>/cydian-sign` | Where IPAs are while a job runs and while they wait |
| `CYDIAN_PUBLIC_URL` | the request's host, over https | The base of the manifest and IPA links (set it when the server's own host name isn't the one the phone uses) |
| `CYDIAN_ZSIGN` | `zsign` on `PATH` | The zsign binary |

- **One worker.** Tokens and signing jobs live in the server process's memory (a poll another worker answers finds
  no job); run one gunicorn worker (threads are fine), as the image does.
- **HTTPS.** iOS only installs `itms-services` links whose manifest and IPA are on https with a certificate it
  trusts. The links are built https unless the request's host is localhost.
- **Proxy timeouts.** Cloudflare's proxy gives up after 100 seconds and Nginx after 60 by default
  (`proxy_read_timeout`). The page signs as an asynchronous job (F47): every request it makes answers at once and
  the job runs as long as the download and zsign caps allow, so a big game signs behind either. Only a synchronous
  POST (no `"async"`: curl, a page from before F47) still waits for the whole job and meets those limits.
- **What iOS still checks.** zsign signs whatever you give it; the phone decides whether it runs. The device must
  be in the profile (Development and Ad Hoc), the certificate not revoked, and the profile's entitlements must
  cover what the app needs (an app with extensions needs a wildcard profile or one per extension; Cydian signs
  them all with the one profile).
- **The site only.** The jailbreak app installs through its helper, and the sideload build signs on the phone
  ([On the phone (I6)](#on-the-phone-i6)).

## Run your own signing server

One command, from a clone of this repo:

```sh
docker compose up -d --build cydian
```

That builds the image (zsign included) and serves Cydian, signer and all, on port **8080** (`CYDIAN_PORT` in `.env`
changes it). The phone needs it over **HTTPS** with a trusted certificate, so put something in front:

- **Tailscale** (no domain, no open ports): `tailscale serve --bg 8080`, then use
  `https://<machine>.<tailnet>.ts.net` as the server in Settings > Signing, from a phone on the same tailnet.
- **Caddy** with a domain pointing at the machine: a `Caddyfile` of
  ```
  sign.example.org {
      reverse_proxy 127.0.0.1:8080
  }
  ```
  and `caddy run`; Caddy gets the certificate itself.

Then Settings > Signing > Signing Server: type the address (`sign.example.org` is enough), and Check Server should
say it signs apps. The page can stay on cydian.dev: `/sign` answers any origin (CORS `*`, no cookies), so nothing is
tied to cydian.dev. Or open your own server's address in Safari and use Cydian from there; its Settings have their
own, separate storage.

Running the signer outside Docker: `zsign` on `PATH` (build it from
[its repo](https://github.com/zhlynn/zsign): `cd build/linux && make`, needs `g++` and `libssl-dev`), then
`.venv/bin/python web/app.py` serves on 127.0.0.1:8080. It needs Linux (`memfd_create`).

## Tests

- `web/test_signer.py`: a throwaway CA, certificate, `.p12` and profile and a tiny hand-built IPA
  (`web/signer/testkit.py`). The checks (wrong password, expired certificate and profile, a certificate the profile
  doesn't list, app ID fit), the token store (expiry, a restart's cleanup), asynchronous jobs
  (202 at once, the phases, done with the link, a download error and a crash in the poll, a bad pair still in the
  POST, the job slot held until the job ends, expiry; zsign replaced by a copy so they run everywhere), POST /sign's guards
  (SSRF: loopback, private, IPv6 loopback, `file:`, `ftp:`, credentials, a redirect to loopback; the size cap with
  and without Content-Length; not an IPA; a path that leaves the folder; the rate limit; CORS) and, where zsign is
  installed (`CYDIAN_ZSIGN` or `PATH`), real signing: the manifest, one download, the CodeDirectory's identifier and
  team (the profile's), every code page's hash, and the CMS signature over the CodeDirectory checked with
  `openssl cms -verify`. Without zsign those tests skip and say so.
- `web/app/signing-client.test.js`: the page's poll of a job (phases, error status, a gone job, network errors
  and proxy hiccups, the poll interval).
- `web/app/core/signing.test.js`: the profile's fields, its certificates, the plist parser, the `.p12` password
  (SHA-256 and SHA-1 MACs), the summary rows. Fixtures in `web/app/core/fixtures/signing/` come from
  `web/signer/make_fixtures.py` (throwaway keys, fixed dates).

## On the phone (I6)

The Cydian app's sideload build (I2) signs IPAs by itself and serves the signed IPA from the phone; the certificate
never leaves it when installing other apps (the one exception, Cydian updating itself, is F73 below). Only the
install manifest comes from a server: the Signing Server (cydian.dev by default, or the user's own, "Run your own
signing server" above), which sees the app's bundle ID, version and name. User 2026-11-17 first asked for it all
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
| **B. A manifest from a server, IPA from the phone** (Feather's Semi Local, **built**, 0.1.4): `GET <server>/sign/manifest?bundleid=&version=&title=&port=&path=` answers a manifest whose IPA URL is `http://127.0.0.1:<port>/<path>` | the server's own certificate | the Signing Server (cydian.dev by default, or the user's own), which sees the app's bundle ID, name and version on every install | **Used.** Nothing to set up on the phone; the certificate and the IPA stay there. |
| C. A CA made on the phone: the user installs Cydian's own root as a profile and turns on full trust; an HTTPS server on 127.0.0.1 uses a certificate it issues | the user's own trust setting | a one-time setup in Settings | **Removed (F75).** Built in I6, but it never worked: iOS's installer ignores a hand-trusted root. The user's test page on that server opened fine in Safari while every install through it failed. |
| D. A pairing file + LocalDevVPN (idevice, Feather's third mode) | lockdownd, no TLS | a computer once to make the pairing file, an App Store VPN app | Works without any certificate, but it needs a computer and keeps a full lockdown credential on the phone. Later, maybe, behind an advanced switch (docs/sideload.md). |
| E. A `data:` URL or a file URL as the manifest | – | – | Not accepted: the manifest URL must be https. |

So every install in the app takes its manifest from the Signing Server; with no server set (or one that isn't
https) `signing.install` and `signing.resignAll` answer `no_server`, and Install opens Settings > Signing at the
server step.

### Setting it up (once)

1. **Settings > Signing**, as on the site: the `.p12`, its password and the `.mobileprovision`. In the app they go
   to `signing.import`: the `.p12` is opened with `SecPKCS12Import` and its identity (certificate and private key)
   is added to the iOS Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (never synced to iCloud, never in
   a backup that restores to another phone). F73: the `.p12` file as picked and its password are kept too, as one
   Keychain generic-password item (service `com.ryha.cydian.signing.p12`, also `...ThisDeviceOnly`), for Cydian's own
   update (below); nothing else reads it. The checks are I5's: a wrong password, an expired certificate or profile, a certificate the profile
   doesn't list.
2. **A Signing Server**: cydian.dev unless the user enters their own. That's all (F75): no profile to install, nothing
   to trust. A phone that ran 0.1.x drops the old local CA's keys and files at launch
   (`SignStore.removeOldInstallCA`); its old profile stays in iOS Settings until the user deletes it.

Or skip step 1: a certificate added on the website comes over by itself or with one tap ("From the website to the
app", below).

Remove Certificate (`signing.remove`) deletes the identity and the kept `.p12` from the Keychain, and the profile
file.

### What leaves the phone, and when (F73)

Installing other apps sends only the app's bundle ID, version and name (to the Signing Server, for the manifest):
they are signed on the phone and served from 127.0.0.1. Cydian itself
can't be installed that way (iOS closes Cydian while it installs, which stops its install server), so Cydian's own
update (Essential Only / Complete, and Changes' self-upgrade: `installSelf` in `web/app/core/essential.js`) signs on
the Signing Server instead. For that it calls `signing.export`, which answers `{p12, profile, password}` (the files
base64, as imported) or `null`; installSelf first asks the user, saying the certificate and key go to the server,
and only then posts them to `<server>/sign` exactly as the site's Install does (I5's rules on the server: memory
only, the request's or its job's lifetime). That is the only time the `.p12` and its password leave the phone, and
only to the Signing Server set in Settings (cydian.dev by default, or the user's own).

`signing.export` answers `null`, and installSelf falls back to opening cydian.dev in Safari, when there is no
certificate, when its profile file is gone, or when the certificate was imported before F73 (the `.p12` wasn't kept
then: Remove Certificate and import it again). The kept item also records the certificate's SHA-256 and is only
handed out while that certificate is the one in use.

### The page's side (F58)

In the sideload build Settings > Signing has the site's Certificate rows (`.p12`, `.mobileprovision`, Password, each
with Browse; one pick can fill all three), but the picks wait in memory only (`signing-client.js`: no IndexedDB)
until all three are there and the password isn't known to be wrong, then go to `signing.import`; after that only the
file names stay, until the app quits. The rest of the page comes from `signing.status`: the identity and its profile
(`core/signing.js deviceSummary`, the signer's `problem` as its footer) and Remove Certificate (`signing.remove`).
F69/F75: the page is a walkthrough (`screens/signing.js`) of two steps, each ticking green once done: **Import Your
Certificate** (a big Select All Files button over the three rows: one multi-select pick of the `.p12`, the
`.mobileprovision` and the password file, or their `.zip`, fills whatever is missing; the picture is today's iOS file
picker, drawn, unless `web/app/icons/steps/select-files.png` holds a real screenshot; and Import from Safari) and
**Signing Server** (the server row and Check Server). Install on an AltStore app's page and Version History's rows
first look whether both are there (`firstInstallCheck`: `signing.status` and `getServer()`); the first Install with
one missing opens this page at that step, with no alert. Then `signing.install {url, manifestServer}`
(`installOnDevice`); the HUD follows its phase events (`phaseLabel`: "Downloading 42%", "Reading", "Signing",
"Installing") and an error alerts by its code (`deviceError`): `no_server` and `no_identity` then open Settings >
Signing. Tests: `web/app/signing-client-device.test.js`, `web/app/screens/signing.test.js` and
`web/app/core/signing-device.test.js`, against a fake `cydianNative`.

### From the website to the app (F75)

Three ways, none of which puts the certificate in a URL in the clear:

- **Inside Cydian's own IPA.** Install Cydian App on the website sends `bring: true` with the sign request while the
  Signing page's "Bring My Certificate" switch is on (the default). The server, signing an IPA whose own bundle ID is
  `com.ryha.cydian` (never any other app), adds `Payload/Cydian.app/cydian-identity.plist` (`{p12, password,
  profile}`, from the request's memory) before zsign seals the bundle. On its first launch the app imports it into the
  Keychain (`SignBridge.importBundled`) unless the Keychain already holds one, and remembers the file's SHA-256 so it
  never looks at it again. **The copy sits in the app's own files until the next update replaces the bundle**, and in
  the signed IPA the server holds for its 10 minutes. Off: the app comes without it; use Import from Safari.
- **Import from Safari** (Settings > Signing, step 1). The app makes a random 256-bit key, keeps it for 30 minutes and
  opens `<server>/#/settings/signing-export.<key>`: the key is in the fragment, which Safari never sends to a server.
  That page reads the certificate from that origin's IndexedDB (`loadIdentity`), seals it with AES-GCM under the key
  (WebCrypto, `core/transfer.js sealIdentity`) and opens `cydian://signing-import#<base64url iv ‖ ciphertext>`; the app
  opens it with its key (one use) and imports it (`signing.import`), then shows the walkthrough ticked. Another app
  claiming `cydian://` would get only ciphertext. Safari and a Home Screen web app keep separate storage, and every
  site (cydian.dev, a test site) is its own origin: with no certificate there the page says so and offers the rows to
  choose the files, then goes on by itself.
- **Open in Cydian App** (sources and settings, never the certificate). On the website (Settings, and Home beside
  Install Cydian App; Not Jailbroken only) it opens `cydian://import?d=<base64url of gzipped JSON>`: the source list
  as export lines, the settings in `core/settings.js TRAVELS`, Ignored Upgrades and the Signing Server, after a banner
  saying to press Open. The app shows "Import from the Website?" listing only what's new (sources not added yet,
  settings that differ, holds it lacks, another server) with Cancel / Import; nothing changes on Cancel. Gzip keeps 400
  sources around 5 kB.

The shell takes only those two `cydian://` hosts (`IncomingLink`, at most 512 kB), keeps the latest and tells the page
(`cydian:url`), which takes it with `app.takeURL` (also at start, for a link that launched the app). `app.gunzip`
unpacks the import link where WebKit has no `DecompressionStream` (before iOS 16.4).

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
  website the library is a list of links kept in localStorage: Add is From URL only, and Install sends the link to
  the Signing Server (`signAndInstall`). There are no Sign Options there.

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
and that nothing of the local CA is left. `web/test_signer.py BringTest`: the identity file goes only into
`com.ryha.cydian` and only with `bring: true`. Node: `core/transfer.test.js` (Import from Safari's seal/open round
trip, the import link's encode/decode and review), `incoming.test.js` (the hand-off and the import's merge). `rcodesign verify`
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
