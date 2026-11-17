# F33: sources added in Cydian go into apt's sources through cydian-helper

## What I did

- **Helper verbs** (`native/helper/`): `addsource <uri> <suite> [component...]` and `removesource <uri> <suite>`.
  `helper_plan` checks them (`helper_uri_ok`, `helper_suite_ok`, `helper_component_ok` in policy.c) and points
  `plan.path` at `<prefix>/etc/apt/sources.list.d/cydian.sources`; main.c then calls `helper_sources_apply`
  instead of `execve` (after the caller check and the clean-process setup, so umask 022 applies). New exit code 74
  (EX_IOERR) when the file can't be written. The exact rules are in native/helper/README.md.
- **Edit**: exclusive `flock` on the sources.list.d directory (no lock file needed), read with `O_NOFOLLOW`
  (regular file, at most 1 MiB), rewrite stanza by stanza (the first naming exactly this URI + suite is replaced
  in place, later duplicates dropped, new ones appended), write `.cydian.sources.XXXXXX` (mkstemp, 0644, fsync)
  and `rename`. Empty result: the file is unlinked rather than left empty. No change: no write.
- **Checks** keep a value from adding a deb822 field: no whitespace, newline, `#`, quotes, brackets; no
  `user:password@` (the file is world-readable); no `.`/`..` segments; flat suites take no components, others
  need 1-16.
- **Fake helper** (`native/fake/cydian-helper`): same verbs, messages and exit codes, awk paragraph-mode edit,
  temp + mv; `FAKE_FAIL=addsource` fails like a write error (74). `fake-native.mjs`: a missing or unstartable
  helper is now a `helper:` error, as Apt.swift's `Helper.run` throws, instead of exit 126 (nothing relied on it).
- **backend-native.js**: `addSource` verifies, then `addsource` through the helper and stores the record without
  `added`; only when the helper can't be run at all (BackendError `helper` from the bridge: the sideload build)
  does it keep `added: true` on the device as before. A refusal or failed write rejects with the helper's last
  stderr line. `removeSource` runs `removesource` for sources whose file is `sources.list.d/cydian.sources`, still
  refuses apt's other files. `refreshSources` first migrates `added: true` records one at a time (already in apt:
  just drop the flag; write fails: keep it, try next refresh), then `apt-get update`.
- Tests: test_helper.py (strings, plan + refusals, apply sequence, hand-written stanzas, symlink/dir refused,
  12 concurrent adds, the chain incl. caller refusal and an unwritable dir → 74); backend-native.test.js (add
  writes the file, remove, failed write, no-helper fallback then migration, migration failure keeps the record).

## Decisions (unattended, no one to ask)

- addSource does not run `apt-get update` itself: the Sources screen's Refresh does, and the source's Packages
  is read over the network until then (as before). Keeps add fast and an offline update from failing an add that
  was written.
- `removesource` of a source that isn't there and `addsource` of one that is exit 0 ("nothing to change"):
  idempotent is what the app wants.
- The helper creates `sources.list.d` but not `etc/apt` (always there on a device).

## Tried / failed

- First `helper_uri_ok` underflowed the path length for a bare `/` path (`https://r.test/`) and ran off the
  end of the string; ASan showed it, fixed by checking for the one-slash path first.
- Checked the concurrency test fails without the lock (10/12, 12/12, 11/12 lines in a scratch build): it does
  catch lost updates, though not every run.

## Not verified

- On a device: nothing ran on the 4S or a modern iPhone (the task didn't ask for it, and the 4S is iOS 6, not the
  rootless target). Not checked: that apt on iOS 15+ reads the written `cydian.sources` as expected, `flock` on a
  directory on APFS (works on Linux and is documented for BSD/Darwin), the persona spawn writing as root.
- The iOS build of policy.c/main.c compiled (test_ios_build, IOS_SDK present), but wasn't run.
- Swift side unchanged: `helper.run` passes any words, so no change was needed; not rebuilt beyond what the gate does.
