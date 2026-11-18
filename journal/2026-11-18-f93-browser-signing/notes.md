# F93: sign in the browser (zsign as WebAssembly on the website)

User 2026-11-18: website signing comes back, "In the browser". The NAS signer is gone and the Worker can't run zsign.
Home also goes back to how it was before F89: the Signing tile, and the green Install Cydian App | Send Settings card
carrying the certificate.

## What I did

**zsign as WebAssembly** (`web/app/vendor/zsign/`: `zsign.js` 96 kB, `zsign.wasm` 2.2 MB, `SOURCE`, `LICENSE.zsign`
(MIT), `LICENSE.openssl` (Apache-2.0), `LICENSE.zlib`)
- `tools/build-zsign-wasm.sh` builds it. It uses zsign at 9299685 (the commit and tarball SHA-256 that the old
  Dockerfile pinned; found in git history: `ARG ZSIGN_COMMIT` in e334ad2..9905b05) and OpenSSL 3.5.9 (SHA-256
  checked), configured static, no-asm, no-threads, no-sock, no-module (so the legacy provider is built in and RC2
  .p12s open; the legacy fixture is tested). emcc comes from PATH, or from `~/emsdk` (emsdk 6.0.13 here). The
  OpenSSL build is cached under `~/.cache/cydian-zsign-wasm`, behind a flock, because parallel gates share the
  cache. The output is an ES module (`MODULARIZE`, `EXPORT_ES6`, `ENVIRONMENT=worker,node`), with MEMFS, memory
  growth up to 4 GB and `INVOKE_RUN=0`.
- `tools/zsign-wasm/cydian.cpp` adds two exports that call zsign's own code: `cydian_unzip` (its minizip) and
  `cydian_plist_json` (its jvalue plist reader, which handles binary plists). The job needs the app's bundle ID
  before signing, and most Info.plists are binary.
- **Reproducible build.** OpenSSL compiles in its prefix and its build date. I fixed both: prefix `/openssl`
  installed with DESTDIR into the cache, and `SOURCE_DATE_EPOCH`. zsign's temp paths are hidden with
  `-ffile-prefix-map`. Two from-scratch builds with separate caches came out byte-identical, and both match the
  committed copy.
- Exit code 3 means a download failed. The gate treats that as a skip.

**The job** (`web/app/core/websign.js` pure rules, `web/app/websign-job.js`, `web/app/signing-worker.js`)
- The rules are the old server signer's (`web/signer/identity.py`, from git history):
  - `targetBundleId`: a `com.you.*` profile signs any app as `com.you.<last part>`.
  - `appEntitlements`: the profile's entitlements are narrowed to the app, and `get-task-allow` is false.
- Steps:
  1. Unzip into MEMFS and free the zip.
  2. Read Info.plist.
  3. Write the .p12, the profile and the entitlements plist.
  4. For Cydian's own IPA (`com.ryha.cydian`) with bring, write `cydian-identity.plist` and `web/transfer.link`.
  5. Run `zsign -f -k -p -m -t -z 6 -o [-b] -e <app folder>`.
- zsign signs the folder, so the bring files are sealed into CodeResources (checked on the real wasm).
- Each job gets a fresh module, because zsign's main() keeps globals.
- Errors: the last `>>>` failure line from zsign. A wrong password becomes "The certificate's password doesn't
  open it…". A non-zip input becomes `bad_ipa` (zsign itself says "Invalid mach-o").

**Browser flow** (`signing-client.js signInBrowser`, `runInWorker`, `downloadIpa`, `uploadSigned`)
- The HUD shows Downloading N%, then Signing, then Uploading N%, then Installing, then iOS's install prompt (with a
  banner saying to press Install). The IPA comes through `/api/fetch?url=&kind=ipa` and runs in a module Web Worker.
  The signed IPA goes to `/sign/upload` in parts, then `done` returns the itms link. Errors end in an alert whose
  message is the server's or zsign's text.
- Identity storage on the website is IndexedDB again (pre-F89 code). `signingReady` is true on the site when a .p12
  and a profile are saved and the password isn't known to be wrong. `getBring`/`setBring` are back.
- `signAndInstall` on the website calls `signInBrowser`.

**Worker** (`worker/src/index.js`)
- New routes:
  - `POST /sign/upload?bundleid&version&title&size` → `{token, partSize: 20 MB, parts}`.
  - `PUT /sign/upload/<t>/<i>` (exact length; part 0 must start with PK).
  - `POST /sign/upload/<t>/done` (checks every part's length) → `{itms, manifest, ...}`.
  - `GET|HEAD /sign/up/<t>/manifest.plist` and `app.ipa`, with Range across parts, streamed part by part
    (`FixedLengthStream` on Cloudflare keeps Content-Length).
- Any app, the same TTL, and a size cap `MAX_UPLOAD_MB` (512; "0" turns it off). I chose this over `HOST_IDS="*"`
  because a KV value holds 25 MB and a Worker request ~100 MB, and website IPAs are often bigger.
- Storage: the upload's own key is `up.<t>`, with metadata. Parts are `up.<t>.<i>`, kept TTL+300 s so a live link
  never points at half an app.
- `/api/fetch?kind=ipa` streams the body with a byte cap. Its 30 s timeout covers the headers only, so a long
  download isn't cut.
- `/sign/status` now also returns `upload: <cap>`.
- **Bug fixed on the way:** the asset fallback skipped every path starting with `/sign`, including
  `/signing-client.js` and the new `/signing-worker.js`. Cloudflare's `run_worker_first` hid this, but under
  `node worker/node.mjs` and Docker the site's modules got 404s. Now only `/sign` and `/sign/...` are the server's
  (a test checks it).

**UI, as before F89**
- `screens/settings.js`:
  - The website's Signing row (certificate name).
  - The page: the certificate rows (footer: kept in this browser), the green Install Cydian App row and Bring My
    Certificate (shown once the certificate works), the profile summary, How It Works, Remove Certificate.
  - No Signing Server row. The website uploads to its own origin's Worker, the same one that serves `/api/fetch`.
- `screens/home.js`:
  - `showsSigningTile` is true on the site again (Featured | Signing).
  - Install Cydian App calls `installApp`: with a certificate it signs Cydian (bring per the switch), and without
    one it opens Settings > Signing. Subtitle "Signed with your certificate".
  - Send Settings' subtitle is "Your certificate, sources and settings".
  - F89's sideloader sheet (`appInstallChoices`, `installAppSheet`) is removed.
- `screens/altstore.js`: on the website, Install comes first (signs in the browser) and F89's hand-offs follow. The
  nav bar's Install runs it, because browse.js runs a first row that isn't a hand-off. The footer text is updated.
- Send Settings carries the certificate again:
  - `core/transfer.js` encodeLink/decodeLink take an `identity`.
  - `screens/importlink.js websitePayload` adds it (`identity: false` leaves it out).
  - `reviewAndImport` calls `signing.import`.
- `app.js`: the first-launch `transfer.link` import is back. It is the same code F89 removed.
- Cydian's IPA always carries the sources and settings (`transfer.link`, without the certificate). It carries the
  certificate (`cydian-identity.plist`) only with Bring My Certificate on. Before F89 both went only with bring. I
  changed that because the brief says it carries the certificate, sources and settings, and the switch is about the
  certificate.

**Elsewhere**
- `.gitignore` gets `!web/app/core/fixtures/signing/*.ipa`, so the tiny test IPA is committed (`*.ipa` is ignored).
- `native/build.sh` leaves `web/app/vendor/zsign/` out of the app (2.3 MB the app never uses: it signs natively).
- Docs: `docs/signing.md` gets a new section, "The website signs in the browser (F93)", and the website-to-app
  section is updated. Also `worker/README.md`, both wrangler tomls (`MAX_UPLOAD_MB`), and AGENTS.md's one line that
  said the website signs nothing.

**Tests**
- `core/websign.test.js`: the rules, the plist writer read back by parsePlist, the args, and error extraction.
- `websign-job.test.js`: three tests with a fake zsign (flow, bring only for Cydian, every error) and two with the
  real wasm on `core/fixtures/signing/tiny-cydian.ipa` (1.1 kB):
  - The fixture has a 32 kB arm64 Mach-O, built with clang `--target=arm64-apple-ios14.0` and linked with emsdk's
    `lld -flavor darwin`, a binary Info.plist and `com.ryha.cydian`. It is signed with the test certificate, the
    bring files are sealed, and a wrong password is reported.
- `signing-client-web.test.js`: the whole browser flow with a fake server and worker (HUD labels, parts, itms,
  bring), plus no certificate, zsign, download, upload and offline errors, runInWorker, and Bring.
- `worker/test.mjs`: upload in parts, done refusing a missing part, manifest, whole and ranged downloads across
  parts, HEAD, size, non-zip, finishing twice, uploads off, and the `/sign`-prefixed asset paths.
- Updated: siteinstall, transfer and incoming tests.
- `node --test web/app`: 699 pass (the gate: wasm rebuilt and identical, worker tests, both native builds).
- `tools/check.sh` rebuilds the wasm where emcc is and compares it byte for byte when the emcc version matches
  `SOURCE`.

**Checked in a browser**
- Headless Chromium (CDP from node) against `node worker/node.mjs`:
  1. Saved the test certificate in IndexedDB.
  2. Ran `signInBrowser` on `tiny-cydian.ipa` (served by the same server) with bring.
- The real module Worker and wasm signed it in 140 ms. The upload went through, the manifest named
  `com.ryha.cydian`, and the downloaded app.ipa had CodeResources, `cydian-identity.plist` and `transfer.link`.
- Screenshots at 390 px × 2 showed Home (Featured | Signing, the green card with both subtitles) and the Signing
  page (rows, green Install Cydian App, Bring switch, profile, How It Works, Remove).

## Tried and failed
- `zsign -q`: it hides zsign's own error lines too, so a wrong password showed only OpenSSL's queue. I dropped `-q`.
- On node, emscripten sets `process.exitCode` when main() returns non-zero, which failed the test file. The test
  now restores it. A browser worker only throws.
- The first build wasn't reproducible: the temp dir path was embedded. With `-ffile-prefix-map` fixed, a fresh
  OpenSSL still differed by its cache-path prefix. The fixed `/openssl` prefix with DESTDIR and `SOURCE_DATE_EPOCH`
  fixed that.
- The e2e first ran on a port already in use (not mine). I used free ports after that.

## Not verified
- **Signing and installing from cydian.dev in Safari on an iPhone** (the brief's user step). I had no device for
  this task (AGENTS.md: the 4S runs iOS 6 and is touched only when a task says so). Not checked: Safari's module
  workers and wasm memory on a real phone, iOS accepting the manifest from `/sign/up/…`, and how big an IPA an
  iPhone's memory can sign (the whole IPA, unpacked, plus the signed copy is in wasm memory).
- **The Cloudflare deploy**: the new routes ran only in node (worker/test.mjs, node.mjs), not on workerd. Not
  checked: `FixedLengthStream`, KV's 25 MB values with 20 MB parts, the request size limit on cydian.dev's plan, KV
  write quotas (each upload is 2 + parts writes), and `/api/fetch?kind=ipa` streaming large bodies from GitHub.
  Nothing was deployed (the brief doesn't say to publish).
- **The first-launch imports in the app** (`cydian-identity.plist` via native BundledIdentity, `web/transfer.link`
  via app.js) were not run on a phone. The files are in the signed IPA and sealed, and the native side is unchanged
  since F75.
- **Safari specifics in the e2e**: Chromium only. WebKit's Playwright build is cached on this machine but there is
  no Playwright package to drive it.
