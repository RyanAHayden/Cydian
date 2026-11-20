# T33: release.sh publishes as the repo owner and checks the release is really up

## What changed

- `tools/release.sh`
  - `gh_auth`: when `GH_TOKEN` isn't set, a real run takes it from `gh auth token --user <owner of $repo>` and checks
    `gh api user` is that owner. No login for the owner: a clear error naming `gh auth login` / `GH_TOKEN`. A
    `GH_TOKEN` already set (publish.sh sets one the same way) wins. `--check-auth` runs only this.
  - `verify_release`: after `gh release create`, `gh release view --json isDraft,assets` must list iFizBox.ipa/.deb,
    Packages, Packages.gz, Release, source.json; for a non-draft, `github.com/<repo>/releases/latest/download/iFizBox.ipa`
    must redirect to `/releases/download/<tag>/iFizBox.ipa` and that must answer 200/206 (a `-r 0-3` GET, not HEAD,
    since signed asset URLs may refuse HEAD). Retried 120 s. `--verify-release X.Y.Z` runs it alone.
  - `--verify-live X.Y.Z`: polls `https://$BRAND_DOMAIN/repo/source.json` and `/repo/Packages` (15 s, 900 s cap) until
    the `com.ryha.ifizbox` app / package lists X.Y.Z; on timeout prints what each says and exits 1.
  - The last line of a real run now says: commit source.json, push, then run `--verify-live`.
- `tools/test_release.py`: class `Publish`, a fake `gh` on PATH (answers from files, logs each call with the
  GH_TOKEN it saw) and a local `http.server` for github.com's redirect and the site. 14 new cases.
- `docs/release.md`: owner token, the checks after publishing, steps 5-6 and the order (release, commit, push, verify).

## Found on the way

- Cloudflare in front of ifizbox.com answers Python's default User-Agent (`Python-urllib/3.x`) with 403 (curl's and
  a custom one get 200). The live check sends `User-Agent: release-check/1`; the test server refuses Python-urllib too,
  so the test would catch a regression.

## Checked against the real thing (read only)

- `tools/release.sh --check-auth` on this machine: "publishing as RyanAHayden (gh auth token --user RyanAHayden)".
- `tools/release.sh --verify-release 0.13.0`: assets listed, latest/download redirects to v0.13.0's IPA, 206.
- `tools/release.sh --verify-live 0.13.0`: both files list 0.13.0 (before the User-Agent fix: 403s, timeout, exit 1).

## Not verified

- A real `gh release create` with the owner token: no release was asked for, so nothing was published. The token pick
  is tested with the fake gh and `--check-auth` against the real gh logins.
- The 15-minute timeout against a real Workers Builds deploy in progress: only exercised with short timeouts on a local
  server (waits, then succeeds; never up, fails) and against the already-deployed v0.13.0.
- An organisation-owned repo (`gh auth token --user <org>` can't work): covered only by the error text pointing at
  `GH_TOKEN`.
- shellcheck: not installed here; `bash -n` passes.
