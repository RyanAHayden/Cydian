# R30 Free Apple ID route: feasibility

The idea: the website signs in to a free Apple ID, makes the development certificate and 7-day profiles, signs in
the browser (zsign WebAssembly) and installs through the existing `/sign/up` itms-services prompt. iFizBox itself
would be a Home Screen web app, so it uses none of the 3 app slots. The certificate route stays the recommended one.

## Verdict

**Go for a spike, no-go for building the feature yet.** Every technical piece works or very likely works (answers
1 to 5 below). One finding could sink the route, and only a stock phone can settle it. On the iPhone 7, iOS **would
not install a website-signed development build over an installed copy of itself**. Same bytes or a real update
(build 2), it said "Already Installed: delete it and try again", and the refusal came before installd. If a stock
phone does the same, every 7-day refresh means deleting the app and losing its data. That would make the route
worse than SideStore, which refreshes in place. The user's stock-phone check (R32 below) decides this before
anything is built.

| Question | Answer | Evidence |
|---|---|---|
| 1. Does a free-account development profile install through `/sign/up`? | **Yes on the iPhone 7.** A stock phone hasn't been checked (AppSync), and neither has updating in place | Below, "1." |
| 2. Does itms-services open from a standalone Home Screen web app? | **Yes on iOS 15**, from a plain link and from `location.href` in a tap. iOS 26 not checked | "2." |
| 3. Anisette servers | 22 public servers on SideStore's list: 18 answered every probe, 2 gave 502 and 2 timed out. No CORS, so the Worker has to fetch them. None of them sees credentials | "3." |
| 4. Can the Worker relay GSA and developerservices2? | **Very likely.** Neither Apple host sends CORS headers, so a relay is required. developerservices2 uses a public DigiCert chain. gsa.apple.com chains to Apple Root CA: that root isn't in Mozilla's store, but it **is** in Cloudflare's cfssl_trust bundle, and the chain verifies against it. Apple accepted a relayed SRP `init` carrying public anisette headers. The UDID config-profile reply is a standard trick and fits a Worker | "4." |
| 5. Reusable code and licenses | Usable: **isideload** (MIT, Rust), **Impactor** (MIT, Rust), **xtool** (MIT, Swift), **apple-private-apis** (MPL-2.0, Rust), **Sideloader** (GPL-3.0, D). Not usable: AltSign, SideStore, AltServer-Linux (AGPL), anisette-v3-server (no license) | "5." |
| 6. Free-account limits, clashes | 7-day profiles (seen), 1-year certificate (seen), 3 apps per phone, 10 App IDs per 7 days, a small cap on certificates (number unconfirmed) that SideStore fights over by revoking | "6." |

## 1. A free-account profile through `/sign/up` (iPhone 7, iOS 15.8.8)

How the profile was made:

- The MBA's Xcode is signed in to the user's Apple ID, which has a free **Personal Team** (`isFreeProvisioningTeam
  = 1` in `com.apple.dt.Xcode IDEProvisioningTeamByIdentifier`).
- I built a throwaway SwiftUI app (explicit App ID `com.<user>.r30probe`, deployment target 15.0) with
  `xcodebuild -allowProvisioningUpdates DEVELOPMENT_TEAM=<personal team>`. **Over plain ssh it fails with "User
  interaction is not allowed"**, because ssh can't get into the login keychain. It worked as a one-shot launchd job in
  the GUI session: `launchctl bootstrap gui/501 job.plist`, whose program runs xcodebuild and writes a log. The same
  trick ran `security export` without a prompt.
- What Xcode made: an "Apple Development" certificate valid for **1 year** (notBefore/notAfter one year apart), and
  "iOS Team Provisioning Profile: com.<user>.r30probe" with `TimeToLive 7`, expiring exactly 7 days after creation.
  The profile holds `get-task-allow true`, `keychain-access-groups TEAM.*` and **one device, not the iPhone 7**
  (some other device of the user's that the team already had). Xcode registers only devices plugged into it, and
  the 7 is plugged into the T490.
- `security export -t identities -f pkcs12` gave a `.p12` that the website signer **can't use, for two reasons**.
  It's encrypted with RC2-40, which OpenSSL 3 reads only with `-legacy`, so zsign's stays "Signed Failed!". And it
  holds every identity in the keychain (two "localhost" certificates and keys as well). Re-packed with `openssl
  pkcs12 -export -legacy` around just the matching cert and key (public keys compared), it signed fine. A future
  free-route website makes its own key and CSR, so this only matters to users who bring an export from a Mac.

Signing and installing:

- `tools/websign.mjs` runs the website's real `runSignJob` (websign-job.js and vendor/zsign) under node. Output:
  `codesign --verify --strict` on the MBA says "valid on disk, satisfies its Designated Requirement". The
  entitlements are `application-identifier TEAM.com.<user>.r30probe`, `get-task-allow false` and the keychain group
  narrowed to the app.
- I put it on the live Worker the way the website does (`POST /sign/upload`, `PUT /0`, `POST done`) and opened the
  itms link on the 7: "ifizbox.com would like to install R30Probe" → Install. installd logged `Install Successful
  for (Customer:com.<user>.r30probe)`. The app launched and showed its text (screens `ref/7/screens/r30-prompt2`,
  `r30-after-install`, `r30-launch1`).
- **This proves less than it looks.** The 7 runs AppSync Unified 116.0. The phone's UDID wasn't in the profile and
  iOS installed the app anyway. installd logged `MIUninstallProfilesForAppIdentifier` and VPN & Device Management
  shows no "Developer App" entry, so AppSync kept iOS from installing the profile at all. On a stock phone, the
  UDID has to be listed, the developer has to be trusted in Settings > General > VPN & Device Management (online),
  and iOS 16+ needs Developer Mode on.

**Updating in place: refused on the 7.**

| Try | Result |
|---|---|
| Same IPA again, manifest version 1.0 | "R30Probe is Already Installed. To install this app, delete … and try again." |
| Same IPA, manifest version 1.1 | Same |
| Second app (R30ProbeB, Keep Bundle IDs, same profile): first install from the web app | Install prompt, installed |
| R30ProbeB again, same IPA | "Already Installed" |
| R30ProbeB with CFBundleVersion 2 / 1.1 in the IPA, manifest 2 | "Already Installed" |

`/var/installd/Library/Logs/MobileInstallation/mobile_installation.log.0` has **no entry** for the refused tries,
so iOS stops before installd (in the itms/install-coordination side). I can't tell from here whether the cause is
development signing, this phone's jailbreak/AppSync, or something else. Paid-certificate re-signs install over
existing apps on the user's stock iPhone 15 Pro (the IPA queue and self-update work, B83/B85), so stock iOS does
update in place for ad hoc builds.

## 2. itms-services from a standalone Home Screen web app (iOS 15.8.8)

I served `tools/itms-webapp-test.html` to the 7 at `http://127.0.0.1:8731/`, through `ssh -R`, and added it from
Safari's Share > Add to Home Screen. Opened from its icon, it reported `navigator.standalone=true`.

- **1, a plain `<a href="itms-services://…">`**: iOS fetched the manifest (the Worker's status said
  `manifest:true`) and showed its alert. That was "Already Installed", because R30Probe was on the phone
  (`r30-wa-link3`).
- **2, `location.href = itms` inside the tap** (what signing-client.js does): "ifizbox.com would like to install
  R30ProbeB" → Install → installed (`r30-wb-loc3`). The page stayed in the web app; iOS didn't switch to Safari.
- 3, `location.href` 2 s after the tap: not tried. The R30ProbeB install was what I needed, and the early-link work
  (F121, B85) already covers what happens outside the tap.

So on iOS 15 a standalone web app opens the install prompt the same way Safari does. iOS 26 needs the user (R32).

## 3. Anisette

All anisette data comes from Apple's own provisioning code: `libstoreservicescore.so`/`libCoreADI.so` from the
Android Apple Music app, or AOSKit on a Mac or Windows. Servers run those native binaries (Provision, written in D,
or omnisette in Rust). **A Cloudflare Worker can't run them**, and hosting one would break "no server of our own".
That leaves the public servers.

`tools/anisette-probe.sh` probed the 22 servers on SideStore's list (`https://servers.sidestore.io/servers.json`)
three rounds each, from the desktop: `GET /v3/client_info` and `GET /` (v1 headers). Full output in
`anisette-probe.tsv` (on timeout rows the bracketed keys are left over from the previous row; ignore them).

- **18 answered all 6 requests**: ani.sidestore.io/.app/.zip, ani.846969.xyz, new.ani.sidestore.io,
  mac-ani/ani.jkcoxson.com, ani.npeg.us, 5.249.163.88:6969 (plain http), anisette.wedotstud.io, ani.xu30.top,
  ani.idevicehacked.com, ani3server.fly.dev, anisette.crystall1ne.dev, omni.ethxn.xyz, ani.sjwon0368.dpdns.org,
  ani.uwucloud.fun, anisette.lillq.me. Mostly 0.1–0.7 s. lillq answers v3 but returns no v1 headers.
- **2 return 502** (win.ani.sidestore.io, ani.jaydenha.uk) and **2 time out** (ani.owoellen.rocks, ani.neoarz.com).
  Three rounds over a few minutes say nothing about a week. These are hobby servers, and SideStore ships a list so
  users can switch when one dies.
- **CORS**: none sent `Access-Control-Allow-Origin`, and an OPTIONS preflight got 404. The browser can't call them,
  so the Worker fetches them. Four are behind Cloudflare (a Worker's fetch to another Cloudflare zone works; not
  tested).
- **What they see**: never the Apple ID or password. v1 (`GET /`) returns one shared machine's headers to everyone
  (`X-Apple-I-MD`, `-MD-M`, `-MD-LU`, `-MD-RINFO`, `X-Mme-Device-Id`, `X-MMe-Client-Info`). So every user of that
  server looks to Apple like the same Mac, and through the Worker they all come from Cloudflare's IPs. v3 provisions
  a machine per user. The client keeps an identifier and an `adi.pb` blob and sends both with every `get_headers`
  call, so the server sees that blob, the timing and the caller's IP (the Worker's, if relayed). v3's provisioning
  is a WebSocket session (`/v3/provisioning_session`) in which the client fetches Apple's start/end provisioning
  data. The Worker or the browser can open a WebSocket, so v3 is doable. It just isn't one GET.

## 4. Relaying Apple through the Worker

- **CORS**: neither host sends `Access-Control-Allow-Origin` (an OPTIONS to developerservices2 got a 200 JSON error
  and no CORS headers). The website can't call Apple directly, so it needs a relay.
- **TLS**: developerservices2.apple.com uses DigiCert Global Root G2, fine anywhere. **gsa.apple.com (and
  gsas.apple.com) chain to Apple Root CA** through "Apple Server Authentication CA". The desktop's Mozilla store
  says "self-signed certificate in certificate chain". Cloudflare's trust bundle
  (github.com/cloudflare/cfssl_trust `ca-bundle.crt`, updated 2026-11-10) holds Apple Root CA, G2 and G3, and the
  gsa chain verifies against it (`Verify return code: 0`). Workers can't turn verification off, so this is the
  deciding fact. It's very likely fine, but **no Worker has actually fetched gsa.apple.com yet**. A self-hosted
  `worker/node.mjs` would need Apple Root CA added (`NODE_EXTRA_CA_CERTS`).
- **Headers Apple wants** (`tools/gsa_init_probe.py`, one request each, a made-up `@example.invalid` address, no
  password). The body is a POST plist to `/grandslam/GsService2`: `Header.Version 1.0.1`, `Request: A2k, cpd, o=init,
  ps=[s2k, s2k_fo], u`. The headers were `Content-Type: text/x-xml-plist`, an akd `User-Agent` and
  `X-MMe-Client-Info`. Anisette goes **inside `cpd`** (`X-Apple-I-MD`, `-MD-M`, `-MD-RINFO`, `-MD-LU`,
  `-SRL-NO`, `X-Mme-Device-Id`, client time), alongside `bootstrap, icscrec, pbe, prkgen, svct, loc`.
  - With ani.sidestore.io's headers: HTTP 200, `ec -20970` "Your account information was entered incorrectly." That
    means Apple took the request and looked up the account.
  - Without anisette: `ec -80009` "MID is invalid."
  - An empty plist with no headers: HTTP 403.
- **The rest of the flow**, from the projects in 5 (not run here: it needs a real account): SRP `complete` (M1, the
  PBKDF2 password from `s2k`), then decrypting `spd` with the SRP session key. 2FA almost always follows on a modern
  Apple ID: `au: trustedDeviceSecondaryAuth` → `GET gsa.apple.com/auth/verify/trusteddevice` and
  `/grandslam/GsService2/validate` with `X-Apple-Identity-Token` and the code (SMS uses `/auth/verify/phone`). Then
  the `o=apptokens` call for `com.apple.gs.xcode.auth`, and developerservices2 calls
  (`/services/QH65B2/ios/listTeams.action`, `addDevice`, `submitDevelopmentCSR`, `addAppId`,
  `downloadTeamProvisioningProfile`) with `X-Apple-GS-Token`, `X-Apple-I-Identity-Id` and the anisette headers. A
  bare developerservices2 call answered `resultCode 1100 "Your session has expired"`, so the endpoint is reachable
  and speaks JSON or plist.
- **What the Worker sees**: if SRP runs in the browser, the password never leaves it, and the Worker can't decrypt
  `spd`. But the Worker forwards the app token and the developerservices2 traffic, so **it holds a live dev-portal
  session for each user while relaying**. The site would have to say so plainly and never log it.
- **Shared IPs**: every user would come from Cloudflare's egress addresses, often with the same v1 machine. Apple
  rate-limits and flags accounts. That isn't measurable without real accounts, and it's the biggest unknown after
  the refresh question.
- **UDID via a configuration profile**: the standard "Profile Service" `.mobileconfig` (`PayloadType Profile
  Service`, `PayloadContent.URL` set to an https Worker URL, `DeviceAttributes [UDID, PRODUCT, VERSION]`, a
  `Challenge`). iOS POSTs a CMS-signed plist there, and the Worker answers 301 to a page. The Worker can read the
  plist by finding `<?xml…</plist>` in the CMS (as Feather's CertificateReader does), with no crypto. Unsigned, the
  profile shows "Not Verified", which still works. One catch: the 301 opens **Safari**, not the Home Screen web app,
  and the two have separate storage. So the UDID has to come back through the Worker (KV keyed by the challenge,
  polled by the web app). Not tried on the phone: it needs a deployed endpoint.

## 5. Licenses of reusable auth and dev-portal code

| Project | License | Reusable here? |
|---|---|---|
| AltSign, SideStore, AltServer-Linux | AGPL-3.0 | No (brief) |
| SideStore/apple-private-apis (icloud-auth: GSA/SRP; omnisette: anisette) | MPL-2.0 | Yes, file-level copyleft that GPL-3.0 can include (MPL §3.3) unless a file says "Incompatible With Secondary Licenses". Rust. Last push 2024-11 |
| nab138/isideload | MIT | Yes. Rust: its own GSA/SRP (srp, pbkdf2, aes-gcm, cbc), anisette v3 client over WebSocket, dev portal, CSR with rcgen. The most complete and current (pushed 2026-10-28) |
| khcrysalis/Impactor (formerly PlumeImpactor) | MIT | Yes. Rust `plume_core`. Credits apple-private-apis for GSA, isideload for the Xcode token, Sideloader for the dev API |
| xtool-org/xtool | MIT | Yes. Swift, has GSA and dev-portal code (XKit) |
| Dadoum/Sideloader | GPL-3.0 | Yes (same license). D |
| Dadoum/Provision | LGPL-2.0 (COPYING-LGPLv2) | Anisette only, needs Apple's native libraries: no use in a Worker |
| Dadoum/anisette-v3-server | none | Code no. Its public instances are just a service |
| gms.py gist (GSA reference) | none | Reference reading only |

None of these runs in a browser or Worker as-is. The work is a JS port (WebCrypto has PBKDF2, HMAC, AES-CBC/GCM and
RSA keygen; SRP is BigInt maths; a CSR is a small DER builder) using isideload or Impactor as the reference. The
existing zsign WebAssembly already bundles OpenSSL if a p12 has to be built.

## 6. Free-account limits and clashes

Seen today: the profile lasts **7 days** (`TimeToLive 7`), the certificate **1 year**, one explicit App ID per app
(the profile has no wildcard), and `get-task-allow` is on. Push isn't in the profile.

From the projects above and SideStore/AltStore's docs, not checked here:

- **3 apps** signed by free accounts active per phone, extensions included (iOS enforces it at install). A website
  build of iFizBox takes none.
- **10 App IDs per 7 days** per account. Each new app uses one, and Keep Bundle IDs doesn't help: the profile is
  still per App ID.
- **Certificates**: free accounts get only a couple of development certificates. AltStore and SideStore **revoke**
  the existing one when they need a new one, because they can't reach its key. A website certificate and SideStore
  on the same Apple ID would keep revoking each other. The website should keep its key and certificate in the
  browser (IndexedDB) and reuse them for a year, and say "use a different Apple ID from SideStore". Whether apps
  already installed keep launching after a revoke is reported both ways. Not checked.
- **Xcode**: the same Personal Team. The Xcode run here made a development certificate and one App ID on the user's
  account. It's harmless, but it counts toward the limits above until it expires or is revoked.
- **Stock-phone steps every free route has**: trust the developer once in VPN & Device Management, Developer Mode
  on (iOS 16+), and refresh every 7 days by hand. A Home Screen web app gets no background time, so nothing can
  refresh for the user.

## Follow-ups (filed)

- **R32** (user hand test, stock phones): install a free-account website-signed app on a stock iPhone (UDID listed,
  trust, Developer Mode), **then install a second build over it through itms-services**: does iOS update in place or
  say "Already Installed"? Also itms-services from a standalone Home Screen web app on iOS 26. This decides the
  route.
- **F251** (low, after R32): the spike. A Worker relay (`/apple/*`, a fixed allow-list of Apple and anisette hosts)
  and a browser GSA sign-in with 2FA, listTeams, a deployed preview, and the user's spare free Apple ID. It proves
  Workers reach gsa.apple.com (the cfssl_trust question) and that Apple accepts Cloudflare egress.
- **F253** (low): a UDID Profile Service endpoint on the Worker. It's worth having even without the free route: the
  website's Settings > Signing says "unknown" for any device-list profile, because it can't read the phone's UDID.
- **F254** (`later`, after R32): the free route itself, parked for a person to schedule after R32 and F251.
