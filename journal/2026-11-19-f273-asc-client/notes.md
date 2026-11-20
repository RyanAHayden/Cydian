# F273: App Store Connect API client (the brain)

## What landed
- `web/app/core/asc.js`: pure JS + WebCrypto, transport injected (`request(method, path, body)`, `httpTransport`
  builds one over a fetch-like function).
  - `makeJwt`: ES256, header `{alg, kid, typ: "JWT"}`, claims `{iss, iat, exp, aud: "appstoreconnect-v1"}`, exp at most
    iat + 20 min (15 by default). The .p8 is imported as PKCS#8; WebCrypto's ECDSA signature is already JWS's raw r||s.
    `keyIdFromName` reads the Key ID from `AuthKey_<KeyID>.p8`.
  - Steps, the same requests as sidedrop's `register`, `cert_id`, `ensure_app_id`, `regen_profile` (read, not
    imported): `ensureDevice`, `findCertificate` (serial, case and leading zeros ignored), `ensureAppId` (exact match
    after the prefix-match filter; made with PUSH_NOTIFICATIONS, APP_GROUPS, ASSOCIATED_DOMAINS; only Push failing is
    fatal), `ensureProfile` (IOS_APP_ADHOC, every ENABLED iOS device, the certificate; the old profile of the same
    name deleted first).
  - App ID naming `appIdFor`: `<prefix>.<last component>`, one per app; `appIdPrefix` from the imported profile's
    App ID, else `<name>.<team>`.
  - `remakeReason(cached, {udid, capabilities, certId, now})`: missing, expired (or within a day of it), device,
    capabilities, certificate; null when fine.
  - Cache shape (header of asc.js) and `profileRows` for the Provisioning Profile rows.
  - `makeCertificate` / `distributionCerts` / `revokeCertificate` kept because the queued F276 names them.
- `web/app/core/asc.test.js`: 16 node tests against a fake ASC: JWT header/claims/signature verified with the public
  key, request bodies (device, App ID, capabilities, profile, certificates), App ID naming, every remake rule, reuse
  costing one call, a cached App ID deleted on Apple's side, no UDID known, and nothing written to the console.
- Worker pass-through (see CORS below).

## CORS
`curl -X OPTIONS https://api.appstoreconnect.apple.com/v1/devices -H 'Origin: https://ifizbox.com'
-H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'` on 2026-11-19 ->
`HTTP/2 401`, a JSON NOT_AUTHORIZED body and no `Access-Control-Allow-*` header. Browsers can't call it.
So `worker/src/apple-relay.js` passes `/apple/api.appstoreconnect.apple.com/v1/...` through. It's narrower than
`/v1/*`: only devices, certificates, bundleIds(/id(/bundleIdCapabilities)), bundleIdCapabilities and profiles(/id),
because that's all asc.js calls. Only that host gets the Authorization header and DELETE. It stays on with APPLE_RELAY
off, because it's the paid-account route, not the free Apple ID spike. Like the rest of the relay it logs and stores
nothing. Tested in worker/test.mjs.

## How it was done
The earlier attempt (wip/F273) also did F274/F275 (Swift, Settings UI) and was never merged. I took only this task's
files from it: core/asc.js, its test and the relay diff (apple-relay.js and test.mjs were unchanged on main since
then). Changes from that attempt: the option and cache field is now `capabilities` (the brief's name), not `caps`;
`ensureProfile` takes an optional `certId` so a changed certificate remakes; the header doesn't describe Swift code
that isn't on main; the fallback prefix comes from brand.js `NAME`; the tests use `com.example`, because
native/test_brand.py refuses `com.ryha.*` IDs that aren't the brand's.
F274 and F275 are ticked in the plan as "landed in F273", but their code is only on wip/F273, and F276/B117 build on
it. Filed F278 (critical, after F273) to port it.
`done` couldn't push at first: origin/task/F273 still held that attempt (ea5447c). I did not force-push. I merged it
with `-s ours`, so the tree is this task's alone and ea5447c stays reachable in history for F278.

## Not verified
- No call to the real App Store Connect with a real key: there's no API key on this machine. JWT format and
  signature are checked locally (they verify with the public key); Apple accepting them is not checked.
- The relay pass-through isn't checked on the deployed Worker, only in worker/test.mjs. Publishing is the runner's
  job.
