# T6: release publishing for F61's self-update

## What was done

- `tools/release.sh`:
  - Builds `native/` (`make -C native package`), or with `--dist DIR` takes a build that already exists.
  - Reads the .deb's Package/Version/Architecture with mkdeb.py's own reader (stdlib, no dpkg-deb), then runs
    mkdeb/mkipa's checks. It also checks that the .deb's Version (before the `-build`) and the IPA's
    `CFBundleShortVersionString` both equal `native/VERSION`.
  - Stages `Cydian.ipa`, `Cydian.deb` and `<pkg>_<ver>_<arch>.deb`, then runs
    `gh release create vX.Y.Z --target <HEAD> --title "Cydian X.Y.Z"`.
  - Before publishing it refuses: a dirty tree, a HEAD that isn't on origin, a tag that already exists (locally, on
    origin, or as a release), and a build that fails its checks.
  - `--dry-run` does everything except the network checks and the publish. It prints check problems instead of
    stopping, and says a real run would stop.
- `tools/test_release.py`, new and outside the brief's file list. It is a test, purely additive, and it keeps
  the script under the gate. It makes fake .deb/.ipa files with mkdeb/mkipa.build and dry-runs the script on them. It
  checks the three asset names, and checks that a version mismatch is reported. It also feeds the printed names to the real
  `selfupdate.js` `parseRelease`/`debFor` under node: the IPA is found, iphoneos-arm64 gets the Debian-named
  .deb, and arm64e gets nothing.
- `docs/release.md`: what a release is, how to cut one, and the options.

## Decisions

- Version in the Debian name: the .deb's full control Version (`0.2.0-412`, VERSION-build), so the file name is
  what `dpkg-name` would give. debFor only looks at the `_<arch>.deb` ending, so the version part doesn't matter
  to the app.
- The release notes come from `--notes FILE`. Without it, the script uses commit subjects since the last tag plus the
  footer from v0.1.1's notes. The alert shows 4 lines and commit subjects here are long, so the doc says to
  write notes.
- `gh release create --target <sha>` creates the tag on GitHub, so no local tag is pushed. The script then fetches it.
  No push to main ever happens.
- Not run for real: the brief says only when a person asks. `native/VERSION` is 0.1.1, which is already
  released, so a real run would refuse anyway.

## Tried and failed

- First test run: `assertNotIn("Version", stderr)` matched the fake build's unrelated check messages (Info.plist
  CFBundleVersion). The test now asserts on the exact mismatch message.

## Verified

- `python3 -m unittest tools/test_release.py`: 3 pass.
- `tools/release.sh --dry-run --dist native/build` on this worktree's leftover (stale, 0.1.0-310) build. It named
  `com.ryha.cydian_0.1.0-310_iphoneos-arm64.deb`, reported the version mismatch and the old build's missing daemon,
  and published nothing.
- Read-only `gh release view v0.1.1`: the hand-made releases use exactly `Cydian.ipa` and `Cydian.deb`.

## Not verified

- **A real publish** (`gh release create` with assets, the tag created at HEAD, the fetch afterwards). Publishing is
  outward-facing, and the brief says to run it only when a person asks. Nobody asked, and VERSION 0.1.1 is already
  released. The first real release will be the check.
- **The real-run refusals** (dirty tree, HEAD not on origin, tag exists, `gh release view`). They need the network and
  gh. They are simple guards, but they were never run.
- **A dry run with a fresh native build in this session.** The gate builds `native/` when the toolchain is set,
  but release.sh's own `make` path wasn't run here. `--dist` was used instead.
- shellcheck is not installed here; only `bash -n` was run.

## Outside the brief: a test that depends on order

The first `done` failed in F14's `native/sign/tests/sideload/main.swift:151`. The test expected `removed` (the
extensions left out) as `[Share, Widget]`, but IPASigner builds that list in directory-listing order, which isn't
fixed, and this time it came back as `[Widget, Share]`. That is a bug in the test, not in T6. The check now compares
`e.removed.sorted()`. It's a one-line change, and the code under test is untouched. `test_sideload.py` then passed (3 tests).
