# C7: iPhone 7 sudo is passwordless (AGENTS.md, phonectl build.sh)

- AGENTS.md: the iPhone 7 line now says `sudo -n` works (passwordless since 2026-11-18); ask the user only if it fails.
- tools/phonectl/build.sh: install step checks `ssh HOST 'sudo -n true'`; if it works, installs with `sudo -n`.
  Otherwise uses `PHONE_SUDO_PASS` via `sudo -S` if set, else exits 1 with a message. Checking first (rather than
  retrying the install) keeps the install from running twice.
- docs/iphone7.md: also fixed the "Rebuild and reinstall" bullet, which said the script still insists on
  PHONE_SUDO_PASS. That's outside the task's file list, but the bullet described the exact behaviour this task
  changes, so leaving it would have made it wrong; it's a 3-line edit.
- Tested the install part with fake `ssh`/`scp` on PATH: all three branches (sudo -n ok / fallback with pass /
  neither) build a remote command that `sh -n` parses, pipe the password only in the fallback, and fail cleanly
  in the third.

**Not verified**
- A real build + install on the phone: the task doesn't ask to touch the iPhone 7 (AGENTS.md: only when the task
  says so), and building needs IOS_SDK. The first real `tools/phonectl/build.sh` run will confirm it.
