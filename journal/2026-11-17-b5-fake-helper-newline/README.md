# B5: fake helper refuses package names with a newline

**What:** `native/fake/cydian-helper` checked package names with `printf | grep -Eqx`, which matches line by
line, so `"ab\n--force-yes"` passed the allowlist (the real helper refuses it). The check now calls the existing
`one_line()` (F33) first, like `addsource`/`removesource` do.

**Checked by hand** (fixture prefix with package `ab` in dpkg status, verb `remove`):
- old fake: `"ab\n--force-yes"` → exit 0, "Setting up ab\n--force-yes (fake)" (the bug)
- new fake: `"ab\n--force-yes"` → exit 64; `"ab\n"` → 64; `AB` → 64; `ab` → exit 0 as before.

**Tried that failed:** nothing.

**Not verified:** no automated test added for the newline case: the task's file list is only the fake itself,
and the fake's tests live in `web/app/backend-native.test.js` (another task's file), so it was checked by hand
as above. The gate (`tools/check.sh`) runs at `done`.
