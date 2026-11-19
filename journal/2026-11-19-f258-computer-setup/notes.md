# F258 Free route: one-time computer setup as a single command

How it works now: `docs/sideload.md` "Free Apple ID: the one-time computer setup".

## What I built

- **`worker/src/setup.js`** (new), routed from `index.js` (one import, one line; the upload's `done` now also keeps
  `doneAt`):
  - `POST /sign/setup?token=…[&bundleid=…][&pairing=<path>|&pairing=][&sha256=…]` → `{ code: "ABCD-2345",
    expiresIn }` for a finished upload. 8 characters from 31 (no 0/O, 1/I/L), unbiased (bytes ≥ 248 skipped), kept in
    KV as `setup:<CODE>` for what is left of the upload's TTL (from `doneAt`).
  - `GET /sign/setup/<code>` (any case, spaces/dashes ignored) → `{ ipa, size, sha256, bundleId, name, version,
    pairing: { bundleId, path } | null, expiresIn }`; `bad_code` 400, `gone` 404.
  - `GET /sign/setup.sh`, `/sign/setup.ps1`, `/sign/setup/bin/<file>` → assets of the GitHub release tagged `setup`
    (`SETUP_TAG`, `IFIZBOX_REPO`), only the names in `SETUP_FILES`.
  - Under `/sign/*` on purpose: that's already `run_worker_first` in wrangler.toml, which isn't in this task's files.
- **`tools/setup/core`** (new crate, no dependencies): arguments (`[CODE] --udid --server --wait --keep-ipa --check
  --download-only`), code normalising, the Worker's answer checked (IPA on the same server under `/sign/up/`, sane IDs
  and container path), and `run`/`check`/`download_only` over `Ui`/`Net`/`Device` traits, with every failure's words
  and exit code. Order: find iPhone → trusted (pair) → code (3 tries) → download (size + SHA-256; a bad file is
  deleted) → install → pairing file → Developer Mode note. 17 tests with fakes.
- **`tools/setup/cli`** (new crate, `ifizbox-setup`): idevice at F15's pinned commit (`ring`, `usbmuxd`, `pair`,
  `afc`, `house_arrest`, `installation_proxy`, `amfi`), ureq 3 + rustls for HTTP, tokio current-thread. Name and
  domain from `native/brand.env` via `build.rs`. Release profile: opt z, LTO, strip, panic abort.
  - Pairing: usbmuxd's record if a lockdown session with it works (no prompt); else `pair_once` in a loop ("tap
    Trust", "unlock"), session test, `EnableWifiConnections` (wireless_lockdown) set, record saved to usbmuxd.
  - Linux keeps waiting when usbmuxd's socket is missing (udev starts it on plug-in); macOS/Windows fail at once with
    the hint.
- **`install.sh.in` / `install.ps1.in`**: filled by `release.sh` with the binaries' SHA-256; a mismatch runs nothing.
  sh runs the command with `</dev/tty` (curl | sh). The PowerShell one checks 127.0.0.1:27015 first, then the Apple
  Mobile Device service, opens the Store's Apple Devices page when there's no driver, never uses `exit` (iex would
  close the window), and on ARM64 falls back to the x64 build when no arm64 one was released.
- **`release.sh`**: `--probe`, `--dry-run [--out]`, publish to the `setup` release (pre-release, `--latest=false`;
  selfrepo.py also skips non-vX.Y.Z tags). Builds: Linux x86_64/arm64 static musl (clang for ring's C; arm64 links
  with rust-lld), Windows x64 (mingw), Windows arm64 (llvm-mingw, optional), macOS universal (clang + rustup's
  ld64.lld + llvm-lipo against `MACOS_SDK`).
- **`test_setup.py`** (gate): core's cargo tests; the CLI's `cargo test --offline --locked` (skipped only when the
  crates aren't on the machine) in a shared target dir `~/.cache/ifizbox/setup-target` (6 s warm); install.sh against
  a file:// stand-in (runs and passes the code on with the right sum, refuses with a wrong one, says "no build"); the
  placeholders, file names (release.sh ↔ templates ↔ SETUP_FILES) agree; no Rust source spells the name or domain.
- `worker/test.mjs`: the hand-off (codes, POST checks, read back as typed/lowercase, other container, no pairing,
  bad/unknown/expired), and the asset proxy (names allow-listed, SETUP_TAG/IFIZBOX_REPO, nothing fetched for others).

## Decisions (unattended)

- **Order: device and trust before the code.** A driver or Trust problem then never wastes a code that lives
  ~10 minutes.
- **Reuse the computer's pairing record** when it works rather than always making a new one: no second Trust prompt,
  and usbmuxd keys records by UDID, so a fresh pairing would replace the computer's own anyway.
- **Pairing file path**: chosen by the website per code (default `Documents/pairingFile.plist`, StikDebug's name),
  so the app side (F254g) and LiveContainer (F254h) can decide without a new CLI. `pairing=` empty = none, which
  covers "skip on iOS 27 if the phone pairs itself" without the CLI guessing.
- **Developer Mode**: only reported (and revealed in Settings with amfi) after the install; the install itself goes
  ahead, iOS asks for it when the app opens.
- **No real install on the iPhone 15**: memory says it's the user's daily phone, read only; and there's no code to
  run with anyway (the website side isn't built). Only reads were run on it (below).
- **Serve binaries from GitHub releases through the Worker**, not committed: several MB each per release.
- **Windows ARM64**: x64 under emulation until llvm-mingw is here (T21).

## Checked

- Core: 17 tests; CLI: its own test (JSON → Lookup); gate test file: 11 (1 skipped: no pwsh here).
- `worker/test.mjs` all OK.
- Real iPhone (iOS 27.0.1, plugged into this machine by USB, already trusting it), read-only `--check`:
  "Found …, This computer is trusted, Developer Mode is on" with the debug build, the static x86_64 musl build, the
  arm64 musl build under qemu-aarch64-static, and the Windows x64 .exe under wine through a socat bridge from
  127.0.0.1:27015 to /var/run/usbmuxd (the same protocol Apple's Windows driver speaks). The first plain run (before
  `--check` existed) found the phone, took the existing pairing (session only) and stopped at the code prompt
  (stdin closed): nothing written to the phone.
- Without the bridge, the Windows build under wine prints the Apple Devices hint.
- HTTP half end to end with `--download-only` against a scratch server running `worker/src/index.js` (a KV that
  streams like Cloudflare's): upload of a 3 MB fake IPA, `POST /sign/setup` with its SHA-256, the command took
  "nope" (refused locally), "zzzz-zzzz" (server: gone) then the code typed lowercase with a space; the saved file is
  byte-identical. A code made with a wrong SHA-256: refused, file deleted, exit 5.
- `release.sh --dry-run` with a `MACOS_SDK` copied off the MBA (usr/lib, usr/include and five frameworks, 90 MB,
  scratch only, not committed): Linux x86_64 2.7 MB static-pie, Linux arm64 2.2 MB static, Windows x64 2.3 MB, macOS
  universal (x86_64 + arm64) 4.0 MB; install.sh/ps1 filled, SHA256SUMS written.

## Tried and failed

- `worker/node.mjs` (the self-hosted server) answers `/sign/up/<t>/app.ipa` with an empty reply: its KV ignores
  `type: "stream"`. Not my file: filed **B114**; tested with a scratch server instead.
- The gate test's first CLI check used `cargo fetch --offline`, which wants crates for every platform in the lock
  (wasm-bindgen) and skipped; it now runs `cargo test --offline --locked` and skips only on a download error.
- `scp` to the MBA failed ("Connection closed"), then the MBA went off the network (ssh timed out twice, minutes
  apart), so the macOS binary never ran on a Mac.

## Not verified

- **No install, pairing (Trust prompt) or pairing-file write on any phone.** The website side that signs
  LiveContainer and asks for a code isn't built (F254f/F254h), the iPhone 15 is read-only, and an install of a
  free-signed app there needs the user. R38 is the real run.
- **The macOS build on a Mac** (MBA unreachable): whether macOS accepts LLD's ad hoc signature on arm64 and the
  x86_64 slice runs under Rosetta. Only `file`/lipo checked it.
- **Real Windows**: only wine + a socat bridge. Apple's own service on 27015, the driver check, the Store product ID
  `9NP83LWLPZ9K` (from memory), `iwr | iex` not closing the window, and PowerShell parsing install.ps1 (no pwsh here).
- **Windows ARM64**: no build (no llvm-mingw); the x64 fallback under Windows 11's emulation is assumed.
- **`EnableWifiConnections`** being what the app needs over LocalDevVPN: set best effort, from other tools' practice.
- **A usbmuxd without a record saving one** (`SavePairRecord`) on macOS/Windows: the path wasn't hit (the phone was
  already trusted).
- **Codes expiring in Cloudflare KV**: the tests' fake KV doesn't expire; the TTL arithmetic is only unit-checked.
- **The real `setup` release and the Worker's proxy of it**: nothing was published (needs a person's OK); the proxy
  is tested with a fake upstream.
- install.sh on macOS's `/bin/sh` and with wget: run only with dash/bash + curl on Linux.
