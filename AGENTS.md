# Agent rules

Cydian: a package manager with the iOS 6 Cydia look, for modern iPhones. Three front doors, one brain:

1. `web/`: public site (Flask, one file until it hurts). Browse APT repos and AltStore sources, add sources,
   check for upgrades. No login. Visitors use modern Safari; the iOS 6 look is drawn in CSS, not images.
2. `native/`: jailbreak app (Theos) that installs `.deb`s through a root helper. Design: `docs/native.md` (R3).
3. `ipa/`: non-jailbroken app for on-device update checks and notifications, only if R4 decides the PWA can't
   do it.

Shortcuts recipes live in `docs/shortcuts.md`.

- Gate: `tools/check.sh` (every `test_*.py`). It must pass before `done`. Add the native and IPA builds to it once
  they exist.
- Python: stdlib first (`bz2`, `lzma`, `gzip`, `email`-style parsing), then what `web/requirements.txt` already
  has. Ask in the journal before adding a dependency.
- Look and feel reference: `~/repos/sidedrop/app.py` (its CSS already has the iOS 6 nav bar, tab bar, grouped
  tables and Reloading Data HUD). Cydia's behaviour: `docs/cydia.md` (R2) and Cydia's GPLv3 source at
  https://git.saurik.com/cydia.git.
- Never commit Apple artwork (UIKit `.artwork` extracts, system icons) or Cydia's logo. Pulled device files go in
  `ref/` (gitignored). Use them as a reference and redraw in CSS/SVG. Don't name the product or pages "Cydia".
- The server fetches URLs visitors type in. Every fetch goes through the SSRF guard (F3): no private, loopback or
  link-local addresses, size and time caps.
- The iPhone 4S (iOS 6, jailbroken) is the test device: `ssh 4s` (see R1). Only touch it when your task says so.
  Never run `apt-get upgrade`, `dpkg -i` or `rm` on it unless the task says so. It can't be re-jailbroken
  easily.
- Write findings worth keeping to `journal/<ID>/notes.md`.
