# T4: the gate builds zsign so SignTest runs

## What I did
- `tools/check.sh`: `zsign_build` reads `ZSIGN_COMMIT` / `ZSIGN_SHA256` from the `Dockerfile` (one place to bump
  the pin, not two), checks for g++, make and libssl headers (pkg-config or `/usr/include/openssl/ssl.h`), downloads
  the GitHub tarball, checks its SHA-256, builds `build/linux` in a temp dir and installs `.venv/bin/zsign`.
  `.venv/.zsign` holds the commit built, so later runs reuse the binary; a new pin, or a `.venv` rebuilt after
  requirements change, builds it again. It then exports `CYDIAN_ZSIGN`.
- An explicit `CYDIAN_ZSIGN` from the caller wins: no build.
- Any failure (no compiler, no headers, no network, hash mismatch, build error) prints
  `check: zsign build skipped (SignTest will skip): <why>` and does not fail the gate. SignTest's own skip message
  still shows. Decision: the tests are optional where the toolchain is missing (as with the native build), and
  a GitHub outage should not block every merge.
- Build takes about 7 s on this machine (16 cores). The binary reports `version: 0.0.0-dev` (upstream's Makefile
  sets no version; the commit is pinned by hash, so this is fine).

## Results
- `web/test_signer.py`: all 6 SignTest tests pass with the built zsign (the brief said 5; there are 6). The full
  gate passes, with 83 web tests and no skips.

## What went wrong along the way
- My first SignTest run skipped. The gate I had started in the background had just `rm -rf`'d `.venv` (its
  requirements stamp did not match) and the binary was gone for a moment. Run again afterwards, all passed. The gate itself is
  not affected: the zsign build runs after the venv step.

## Not verified
- Hash mismatch was checked in a scratch dir with a wrong pin: it skips, nothing is installed, the temp dir is
  removed. The other skip paths (no g++, no libssl headers, failed download) were not run because this machine has
  all of those. They are the same `|| { echo; return 1; }` shape.
