# D5: docs/iphone7.md, passwordless sudo and installed Cydian

- Login row was already updated (passwordless, `/var/jb/etc/sudoers.d/mobile`) by an earlier commit; left as is.
- Install section: install command uses `sudo -n`; replaced the "sudo reads the password from stdin" line with
  the passwordless note; added that Cydian is installed.
- Checked on the phone (read-only, no screen lock needed): `sudo -n true` succeeds, and
  `dpkg-query -W com.ryha.cydian` gives **0.3.8-791**, not the 0.3.8-741 the brief named; the doc records 791,
  what the phone actually has.
- phonectl line: `tools/phonectl/build.sh` still aborts without `PHONE_SUDO_PASS`; noted any value works now.
  Fixing the script (and AGENTS.md, which still says sudo needs a password) is outside D5's files: filed as a
  low cleanup follow-up.

**Not verified**: did not run `tools/phonectl/build.sh` with a dummy `PHONE_SUDO_PASS` (it would reinstall the
setuid binary on the phone, outside a docs task); the claim that sudo ignores stdin under a NOPASSWD rule is
standard sudo behaviour, not tested here.
