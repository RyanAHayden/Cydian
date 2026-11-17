# I5: Sign and install IPAs with your own certificate, on the website

## What I did
- **Server, `web/signer/`** (a Flask blueprint registered in `web/app.py`):
  - `identity.py`: opens the `.p12` (cryptography's pkcs12) and the profile (the plist inside the CMS bytes), with
    clear errors: `bad_password` (a PKCS#12-shaped file that the password doesn't open), `bad_p12`, `bad_profile`,
    `cert_expired`, `cert_not_yet_valid`, `profile_expired`, `cert_not_in_profile`, `app_id_mismatch`. App ID fit:
    `*` keeps the app's ID, `com.x.*` keeps it if it fits or refuses, an explicit ID signs as that ID (`zsign -b`).
  - `ipa.py`: the IPA download streams to a file through `fetch.Fetcher.check` and `fetch._PinnedConnection` (the
    F3 SSRF guard, unchanged: every hop re-checked, checked IP pinned), with its own size cap and deadline, since
    `Fetcher.get` buffers in memory and caps at 50 MB. `inspect()` reads `Payload/*.app/Info.plist`, refuses
    entries with `..`/absolute paths, too many entries, or an unpacked size over the cap.
  - `zsign.py`: runs zsign with the key and the profile in `memfd_create` files (`/dev/fd/N`, inherited via
    `pass_fds`). The `.p12` handed to zsign is re-serialised unencrypted in memory, so no password is on its
    command line (zsign also needs the issuer from the p12: see below). `-f` (no cache), cwd and `-t` in the job
    folder, which is removed when the job ends.
  - `__init__.py`: `POST /sign` (JSON, base64 files; rate limit 10/10 min per address; body cap 4 MB; 2 jobs at
    once; store cap), `GET /sign/<token>/manifest.plist`, `GET /sign/<token>/app.ipa` (first download: the file is
    unlinked as it starts streaming and the token forgotten), `GET /sign/status`, CORS `*` and preflight. `Store`:
    `secrets.token_urlsafe(32)` tokens, files named by the token's SHA-256, 10-minute expiry swept on every access,
    leftovers deleted when the store starts. Links are https unless the host is localhost (behind Nginx Proxy
    Manager the app hears http); `CYDIAN_PUBLIC_URL` overrides.
  - `testkit.py`: throwaway CA + leaf (team in OU, as Apple's) + `.p12` (AES or legacy SHA-1/3DES) + CMS-signed
    profile + a tiny IPA whose binary is a hand-built arm64 Mach-O (`__PAGEZERO`, `__TEXT` with `ret`,
    `__LINKEDIT`, `LC_MAIN`). `make_fixtures.py` writes the node fixtures from it with fixed dates.
- **Docker**: the root `Dockerfile` (the brief says `web/Dockerfile` / `docker-compose.yml`; the repo's are
  `Dockerfile` and `compose.yaml` at the root, so I changed those rather than add a second set) gets a builder
  stage compiling zsign from commit 9299685 (tag v1.1.3) with the tarball's SHA-256 checked, `libstdc++6` in the
  runtime, `COPY web/signer`. `compose.yaml` needed no change: `docker compose up -d --build cydian` already runs
  the server with the signer.
- **Licence**: zsign is MIT (GitHub API and its `LICENSE`), which GPL-3.0-or-later can include; recorded in the
  Dockerfile, `docs/signing.md`, and the licence text is installed at `/usr/local/share/licenses/zsign/LICENSE`.
  zsign is run as a separate program, not linked.
- **Dependency**: `cryptography==50.0.2` added to `web/requirements.txt` (AGENTS.md says ask first; unattended, so
  decided: PKCS#12 and X.509 have no stdlib parser, and shelling out to `openssl` would need the password on a
  command line or more plumbing for the same result. It's the standard, widely packaged choice).
- **Frontend**:
  - `core/signing.js` (pure): DER/X.509 reader (CN, OU, O, validity), a plist XML parser, `parseProfile` (name,
    team, app ID, expiry, devices, enterprise, certificates), `checkP12Password` (RFC 7292 B.2 KDF over WebCrypto
    digests + HMAC; works for any p12 encryption since it checks the MAC), `summary` rows/problems,
    `normalizeServer`, `signBody`, `errorText`.
  - `signing-client.js` (new): IndexedDB `cydian-signing` for the files and password, `cydian.signingServer` in
    localStorage, `signAndInstall` (HUD "Signing" → POST → the same HUD relabelled "Installing" → `location.href =
    itms`; errors in an alert titled "Couldn't Sign <app>").
  - `screens/settings.js`: a Signing group on the root page (Certificate: its name, None, or Incomplete) and the
    `#/settings/signing` page: Certificate / Password (UIAlertView with a secure field) / Provisioning Profile rows,
    the profile's facts (long values as subtitles so they wrap), problems as the footer, Signing Server (alert with
    a URL field) and Check Server (`/sign/status`), the privacy statement, Remove Certificate. Site only.
  - `screens/browse.js` (outside the brief's file list, but the nav-bar Install the user asked for lives there):
    `packageActions` for an app first tries `signIfReady` (cert saved + the version has an http(s) IPA) and signs;
    otherwise F29's sheet, plus "Sign with My Certificate" (→ Settings > Signing) when the source has no signed
    link, and its title says the app needs signing. Version History rows sign the same way. Label stays Install.
- Docs: `docs/signing.md` (how it works, what is stored where, limits, running your own with Docker + Tailscale or
  Caddy, tests); README: a "Your own signing server" section and a pointer under Run it.

## What failed on the way
- First zsign run on the fixture: "Unknown issuer hash … No embedded WWDR intermediate matches and the p12 carries
  no usable CA chain". zsign needs the leaf's issuer: its embedded Apple WWDR intermediates cover real
  certificates; a self-signed one needs a CA in the p12. So the testkit makes a throwaway CA, and the server passes
  zsign a re-serialised p12 (key + cert + the user's CA certs) rather than PEM key + cert, which would drop the chain.
- A password test used "wrong" as the wrong password and asserted it isn't in the message "…password is wrong."
- The plist tokenizer missed `<plist version="1.0">` (attributes). The node fixtures caught it.
- Dates in the summary formatted in local time: the test passes `timeZone: "UTC"`.
- Walk-through: the root page's Certificate row stayed "None" after setting one (drawn before); Signing changes
  now redraw every open Settings page. The "Signing" → "Installing" HUD swap showed both labels mid-fade; the HUD
  is relabelled in place now.
- My first walk-through launch backgrounded a whole `&&` chain, so `$S` was empty outside it and the PIDs were
  wrong; the server it started kept port 8749 (the second run used it, same code). Stopped it by the PID `ss`
  showed for that port.

## Checks run
- `web/test_signer.py`, 22 tests, with zsign built from v1.1.3 in the scratchpad (`CYDIAN_ZSIGN=…`): all pass,
  including real signing (CodeDirectory identifier and team = the profile's, every page hash, CMS signature over
  the CodeDirectory verified with `openssl cms -verify -noverify`, embedded profile, one download, token expiry,
  nothing left in the store folder, the key passed as `/dev/fd/N` and no `-p`). Without zsign: 17 run, 5 skip.
- `node --test web/app`: all pass (signing.test.js: 9).
- `docker build` of the image: builds; inside it zsign signs the fixture IPA through `signer.zsign.sign` (memfd),
  `/sign/status` answers `zsign: true`, and a bad POST gets the JSON error.
- Chromium walk-through (`tools/serve.py` + `tools/shots.mjs`, 390x844 3x, light and dark): Settings with no
  certificate, the empty Signing page, a wrong password, the password alert, the filled page, the root row with the
  certificate's name, the app page, nav-bar Install → "Signing" → "Installing" and an `itms-services://` navigation
  to `/sign/<token>/manifest.plist`, then a wrong password → the server's "The certificate's password is wrong."
  alert. No page errors. Screenshots were looked at, not kept in the repo.

## Not verified
- **A real certificate on a real iPhone** (the brief's last test): needs the user's `.p12` and profile and their
  phone; nothing here has been installed on a device. Whether iOS Safari opens `itms-services://` from
  `location.href` after the `await fetch` (no fresh user gesture) is unknown: if it doesn't, the HUD's
  "Installing" would need to become a tap ("Install" in an alert). Real Apple certificates go through zsign's
  embedded WWDR intermediates, which the tests (throwaway CA) don't exercise.
- **The gate doesn't run the zsign tests**: no zsign on this machine's PATH, so `tools/check.sh` skips the 5
  signing tests (they say why). Filed T4 to build zsign for the gate.
- **cydian.dev in production**: not deployed by me. Cloudflare's 100 s origin timeout and Nginx's 60 s
  `proxy_read_timeout` bound how long a sign may take (big IPAs); documented, not measured. Filed F47 for
  asynchronous jobs.
- **The `.p12`'s own certificate is not shown in the browser**: its bag is usually RC2/3DES-encrypted, which
  WebCrypto can't decrypt; the page shows the profile's certificate of its own team and the server checks the
  match. A p12 whose certificate isn't in the profile is only caught at sign time.
- **iOS file pickers** with no `accept` filter: not tried on an iPhone (Chromium drove `saveIdentity` directly,
  as the pickers would). `.mobileprovision` files from Files/iCloud should be pickable; not checked.
- **IndexedDB in iOS Safari private mode or Home Screen web apps**: not checked; private mode may refuse to store.
- **Apps with extensions/watch apps**: signed with the one profile; not tested (the fixture has none).
- **Tailscale serve / Caddy instructions**: written from their documented commands, not run here.
