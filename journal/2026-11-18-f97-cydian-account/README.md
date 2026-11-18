# F97 Cydian Account

The task came in with an empty brief, because `plan brief F97` found nothing: the plan clone in `s1/plan` still had
the task under its old duplicate id F96. Commit 612b6b3 ("plan: the Cydian Account task is F97") renamed it, so I
did the Cydian Account task as written there (user 2026-11-18, approved as drafted).

## What I did

- **Worker** (`worker/src/account.js`, wired in `src/index.js` with one line): `GET/PUT/DELETE /api/account/<64 hex>`,
  one encrypted blob per account in `HOSTED` under `acct:` + SHA-256(id). There is a 256 KB cap, checked against
  the header and against the bytes that really arrive. `If-Match` / `If-None-Match: *` versioning answers 409 with
  the current ETag. Delete is included, and CORS is set for the app's `cydian://app` origin (PUT, DELETE,
  If-Match, ETag exposed). Each address is rate-limited in isolate memory, so the limiter spends no KV writes.
  Bodies are never logged. In `node.mjs`, KV gained `delete`, `getWithMetadata` returning arrayBuffer values, and
  no expiry when no TTL is given, so accounts don't vanish after 10 minutes.
- **Core** (`web/app/core/account.js`): the key (Crockford base32 code and link), HKDF id and key, AES-GCM
  seal/unseal, the HTTP client, the three-way merge, `changesFor`, and `createAccountSync` (create, sign in, sync,
  the batched save, remove). The rules are in `docs/account.md`.
- **Screen** (`web/app/screens/account.js`, `account.css`): Settings has a Cydian Account row (On/Off) that pushes
  `#/settings/account`. The page has Create Account and Sign In With Key. Once signed in it shows Sync Now, Last
  Synced, the Sync Certificate switch (site and sideload builds) with the footer about encryption, Show/Hide
  Account Key (the code, Copy Key, Copy Link and a QR code, with the warning that a lost key is lost data), and
  Delete Account (the red action-sheet button, which asks first). The key is shown once on creation. Launch
  reads; `visibilitychange: hidden` and `pagehide` save. `cydian://account?k=` (incoming.js, and the shell's
  `IncomingLink` hosts) opens Sign In With Key with the key filled in.
- **Native**: `native/Sources/Account.swift` (`account.key.*` in the Keychain), registered in `Bridge.swift`;
  `account` added to `IncomingLink.hosts` (Handoff.swift) and to its Swift test.
- **Tests**: `web/app/core/account.test.js` covers the encrypt/decrypt round-trip, the id not revealing the key,
  the merge rules, and two devices against the real Worker code over a fake fetch: create, sign in is a read,
  batched saves, the 409 path, a removal travelling, delete, and Sync Certificate off. `screens/account.test.js`
  covers collect/apply with fake backends, the key store and the incoming route. `worker/test.mjs` covers the
  size cap, version check, delete, rate limit, and the CORS preflight through the Worker.

## Decisions (unattended, so written down)

- The URL's id is itself an HKDF output, and the server hashes it again before using it as a KV key. The brief
  says "keyed by SHA-256 of a separate HKDF-derived id"; with this reading, a KV dump doesn't give the URLs either.
- Sets merge three ways against what was last synced, not as a plain union. Removals then travel, and a fresh
  device still only adds. A plain union would bring every deleted source back.
- Sync Certificate off writes `identity: null`, which removes the certificate from the account, and takes no
  certificate in. Applying an account never deletes a certificate from a device, so turning the switch off on
  one phone doesn't wipe the others.
- When an account is deleted on another device, the next sync here says so and forgets the key. It does not
  recreate the account.
- Rate limiting is per isolate and in memory. It is best effort, but it costs nothing against KV's 1,000 free
  writes a day. Cloudflare's Rate Limiting binding would be stricter: filed as F98 (low).
- No gzip on the blob: CompressionStream is missing in iOS 15's WebKit, and a payload with a certificate is about
  20 to 40 KB, far under the cap.

## What failed along the way

- This worktree was cut before 612b6b3 renamed the task, so its plan had no F97. The first `plan add` for the
  follow-up was therefore given the id F97 itself. I reverted that edit, cherry-picked 612b6b3 (plan/TODO.md
  only, the same change as on main) so `done F97` ticks the right task, and filed the follow-up again: F98.

- The first worker test run returned 200 for a 5-byte body because `fail()` had no status there. Fixed.
- Driving the website in headless Chromium (CDP over node's WebSocket, `worker/node.mjs` on 127.0.0.1) found a
  real bug: `sourceLine` added "/" to every URL, which turned AltStore sources like `…/source.json` into
  `…/source.json/`. It now adds the slash only to a bare host, and a test covers that.
- The same run showed the key code cut off with an ellipsis at 390 pt. Its row now wraps, at 18 px.

## Checked

- `tools/check.sh` passed: 747 node tests, the worker tests including `worker account: ok`, and the native .deb
  and .ipa built. That run used the earlier `sourceLine`; `done` runs the gate again on the final tree.
- Website, headless Chromium at 390×844 @2x: Settings shows the Cydian Account row (`1-settings.png`). Create
  Account → the alert → the HUD → the page with the key and QR code (`4-account-created.png`). localStorage
  then held version 1, Sync Now worked, and the page logged no errors.

## Not verified

- **The app (WKWebView on `cydian://app`)**: not run on a device. I assume `crypto.subtle` is available there.
  WebKit treats custom-scheme pages as secure contexts on recent iOS, but I didn't check on iOS 15. Without it,
  Create Account says "This browser can't encrypt (Web Crypto is missing)." The cross-origin fetch from
  `cydian://app` to `https://cydian.dev/api/account` with PUT, If-Match and a read of ETag is also unchecked
  outside node. The only test phone is the iOS 6 4S, which can't run the app, and the task didn't ask to touch it.
- **`account.key.*` in the Keychain**: it compiled in the native build, but it never ran on a phone. The same
  device limit applies.
- **Real Cloudflare KV**: only the in-memory fakes and `node.mjs` ran it. Nothing was deployed: the task doesn't
  say to publish, and the runner publishes after the merge.
- **Restoring a certificate end to end** (site → account → sideload app `signing.import`): covered only with fake
  bridges in `screens/account.test.js`.
- **Removing a source that lives in another apt list file** (jailbreak): `removeSource` throws there, so the
  source stays and the account keeps listing it on that device. The fake backend shows this is tolerated, but it
  wasn't run on a device.
