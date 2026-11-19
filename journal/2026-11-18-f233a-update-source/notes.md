# F233a: ifizbox-helper update-source

## What I did

- `policy.c`/`policy.h`: new verb `update-source <uri> <suite> [component...]` (`HV_UPDATE_SOURCE`). Its words go
  through `source_plan` with addsource's rules (URI, suite, flat/non-flat component rules, at most 16 components),
  then `update_source_plan` builds
  `apt-get -o Acquire::AllowInsecureRepositories=true -o Dir::Etc::SourceList=<temp> -o Dir::Etc::SourceParts=/dev/null -o APT::Get::List-Cleanup=0 [-o APT::Status-Fd=3] update`
  and the one-line `deb <uri> <suite> [component...]` text.
- The temp file is `<prefix>/etc/apt/ifizbox-update-source.XXXXXX` (`HELPER_UPDATE_SOURCE_TMP`). I picked etc/apt
  because it is root-owned and not world-writable (so not /tmp), and it is *not* inside sources.list.d: a full
  `apt-get update` run at the same time would otherwise read it (or warn about its extension). The name doesn't end in
  `.sources`, so apt reads it in the one-line format; every word was already checked to have no spaces, `[`, `#` or
  newlines, so the line can't add options (`[trusted=yes]`) or a second entry.
- `helper_update_source_file` (policy.c) does mkstemp (0600: apt reads the sources as root before dropping to
  `_apt`), writes the line, and points the plan's option at the real name. Fails: unlinks, exit 74.
- `main.c update_source`: fork, child execve apt-get, parent waitpid (EINTR loop), unlink, return apt's status
  (128 + signal). Runs after the usual clean-up (fds, signals, env), so apt gets the same clean process as update.
- Tests (`native/helper/test_helper.py`): `test_update_source_plan` (exact argv with and without fd 3, refusals
  including `[trusted=yes]` and newline injection) and `test_chain_update_source` (through the stand-in app: the
  stand-in apt-get prints the temp file's content and mode; the file is gone after exit 0 and after exit 100;
  ifizbox.sources untouched; exit 64 refused words, 77 wrong caller, 74 unwritable etc/apt with apt never run).
- README: usage line and table row.
- Fake helper learned the verb: copies only `FAKE_REMOTE/lists/<uri-prefix>_*`, a `FAKE_DEAD` URI fails like update
  (Err line, exit 100); `FAKE_OLD_HELPER=1` makes it refuse the verb with 64, like a helper from before it.
- `web/app/backend-native-live.test.js` (outside the task's `--files`, but unavoidable): its F233 retry test relied on
  the fake refusing update-source. It now sets `FAKE_OLD_HELPER=1` to keep testing the fallback, and two new tests
  cover a retry that runs only update-source (Havoc not fetched) and a dead source failing its row.

## Tried and failed

- Nothing failed. (One slip: the first policy.h edit went through a python heredoc instead of the edit tool; the
  result was checked in the diff.)

## Not verified

- The real apt on the iPhone 7: that apt reads the one-line temp file with `SourceParts=/dev/null` and that
  `List-Cleanup=0` really keeps the other sources' lists. The task doesn't say to touch the phone, so I didn't; the
  options are apt's documented ones. Worth a look the next time a task is on the 7: retry a dead source in Sources and
  check `/var/jb/var/lib/apt/lists` still holds the others.
- The iOS build of the helper: `test_ios_build` needs the iOS SDK, not on this Linux box. The new code is plain
  POSIX (mkstemp, fork, waitpid) that main.c already uses elsewhere.
- If the app kills the helper while apt runs (signals are SIG_DFL), the temp file stays in etc/apt. apt never
  reads it there, and the next run makes a new name, so it is litter, not a bug. Not handled.
