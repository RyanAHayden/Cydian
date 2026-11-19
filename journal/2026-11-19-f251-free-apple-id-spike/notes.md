# F251 Free Apple ID route spike: Worker relay + browser GSA sign-in

## What was built

- **`worker/src/apple-relay.js`**: `<METHOD> /apple/<host>/<path>` → `https://<host>/<path>`, wired into
  `src/index.js` and listed under `run_worker_first` in both wrangler files.
  - Allow-list (host + path regexes): gsa.apple.com `/grandslam/GsService2` (with `/lookup` and `/validate`),
    `/grandslam/MidService/{start,finish}MachineProvisioning`, `/auth`, `/auth/verify/{trusteddevice,phone,
    phone/securitycode}`; developerservices2.apple.com `/services/QH65B2/[ios/]<action>.action`; five v3 anisette
    servers (`/v3/client_info`, `/v3/get_headers`, `/`). The anisette WebSocket (`/v3/provisioning_session`, only with
    `Upgrade: websocket`) is handed through with `fetch(target, {headers: {Upgrade}})`.
  - The brief named GsService2 and auth/verify only. MidService and `/auth` were added because anisette v3
    provisioning and the trusted phone list need them (the scratch test site behind R32 used both).
  - Caps: request 64 KB, reply 2 MB, 20 s; `redirect: "manual"` (a 3xx becomes a 502, never followed); GET/POST/PUT.
    Outgoing headers are a fixed list (Apple's X-Apple-*/X-Mme-*, Content-Type, Accept, `security-code`). Cookies,
    Authorization and CF-* headers are dropped. `X-Relay-User-Agent` becomes User-Agent, since browsers can't set it.
    Only Content-Type comes back, plus `X-Relay-Status` so the client can tell Apple's status from the relay's own refusals.
  - No CORS headers. A cross-site `Origin` or `Sec-Fetch-Site` gets 403. Nothing is logged or stored. Error messages
    name only host and path.
  - **Off unless `APPLE_RELAY = "1"`** (404 otherwise). Why: ifizbox.com deploys from main through Workers Builds, and
    the brief says to deploy only a preview, with the user's OK. Shipping a live Apple/anisette relay on the
    production site is outside this task. A preview sets the variable.
- **`web/app/core/gsa.js`**: pure browser JS, no UI. Contents: XML plist (both ways), binary plist (read), SRP-6a
  in BigInt (GrandSlam's RFC 5054 shape, s2k/s2k_fo PBKDF2 keys), spd decryption (AES-CBC), app token decryption
  (AES-GCM), the `AppleIdSession` (init with the hsc 434 anisette resync, complete, trusted-device and SMS 2FA,
  `o=apptokens` for com.apple.gs.xcode.auth), an anisette v3 client (WebSocket provisioning, get_headers),
  `DevPortal.listTeams()` plus a generic `call()`, `relayTransport()`/`relayWsUrl()` and `signInAlert()` (the error
  code to alert mapping from the F254 notes).
  Ported from the scratch free-ID test site's `lib/` (the R32 session's: srp.js, appleid.js, anisette.js, plist.js,
  errors.js, devportal.js). That code was itself written fresh, checked against isideload (MIT) and pysrp, and it
  signed a real free Apple ID in and called the developer portal on 2026-11-19. Changes in the port: one file, the
  relay transport, a depth/truncation guard in the XML parser, spdKeyVariant reset per login, no logging of reply bodies.
- **Tests**: `web/app/core/gsa.test.js` checks SRP against the RFC 5054 Appendix B vector and a pysrp vector
  (s2k_fo), plists, and the whole flow (SRP, device 2FA, SMS 2FA, wrong password/code, unknown account, app token,
  listTeams, a session-expired portal error) against a fake GrandSlam that runs SRP's server side and encrypts spd and
  et the way Apple does. It also covers anisette v3 provisioning over a fake WebSocket, and relayTransport.
  `worker/test.mjs` ("worker apple relay") checks off by default, the allow-list (traversal, look-alike hosts,
  idmsa, other dev-portal paths), header filtering, no Set-Cookie and no CORS out, cross-site 403, 405, 413, the
  redirect refusal, the reply cap, timeout 504, and the WebSocket hand-through.
- `worker/README.md`: the `APPLE_RELAY` setting.

## Live check from the desktop (no account)

`scratchpad/probe/live-init.mjs` (not committed) ran gsa.js with `relayTransport` whose fetcher calls `appleRelay()`
in-process, with node's real `fetch` and `NODE_EXTRA_CA_CERTS` set to Apple Root CA (SHA-256 B0:B1:73:0E…). The
WebSocket went straight to the anisette server, because node has no Worker to pipe it. Result:

- anisette v3 provisioned a new machine on ani.sidestore.io: GiveIdentifier → GiveStartProvisioningData (relayed
  MidService start) → GiveEndProvisioningData (relayed finish) → ProvisioningSuccess.
- SRP init for `f251-probe-<time>@example.invalid` through the relay: `ec -20970` "Your account information was
  entered incorrectly." Apple took the anisette and looked the account up.

So the ported code and the relay's forwarding (allow-list, header filter, User-Agent mapping) talk to Apple correctly.

## Tried and failed

- First run of the relay test: the fake fetcher looked for the WebSocket header with `Headers.get`, but the relay
  passes a plain object. A test bug, fixed in the test.
- One shell command lost its output to EDQUOT on /tmp (the shared tmpfs is nearly full from other sessions'
  scratchpads). Retried and it worked. Nothing deleted.

## Not verified

- **A Worker fetching gsa.apple.com** (the cfssl_trust / Apple Root CA question): needs a deployed Worker. The brief
  allows a preview only with the user's OK, and this run is unattended. Filed as **R35**.
- **Apple accepting Cloudflare egress** for SRP, 2FA, the app token and listTeams: same reason (R35). From the
  desktop's IP only the no-account init was run.
- **The anisette WebSocket through the Worker** (`fetch` with `Upgrade: websocket`, returned as is): Workers' pass-through
  can't run under node. Only the hand-off is tested (R35).
- **A real sign-in with gsa.js** (SRP complete, spd, 2FA, app token, listTeams): needs the user's spare Apple ID and
  2FA. The fake GrandSlam covers the maths and the message shapes; the same code (pre-port) did it for real in the R32
  test site.
- **Browser behaviour**: in the browser WebCrypto, BigInt and relayTransport's `fetch` (credentials omit, header
  names) weren't run; only node 26's implementations ran. `Sec-Fetch-Site` and Origin as browsers send them were
  only tested with synthetic headers.
- `node worker/node.mjs` (self-hosted) with the relay: not run. The README says it needs Apple Root CA.
