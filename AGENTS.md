# Agent rules

Cydian: a package manager with the iOS 6 Cydia look, for modern iPhones. Two front doors, one brain:

1. `web/app/`: **the one frontend** (HTML, CSS, vanilla JS modules, no build step). It runs on the public site and
   inside the jailbreak app. `core/` is pure JS (parsing, versions, Changes, upgrades), tested with `node --test`.
   The UI only talks to a backend interface: `backend-http.js` on the site, `backend-native.js` in the app.
   cydian.dev is one Cloudflare Worker (`worker/`): `web/app/` as static assets, the fetch proxy (`/api/fetch`)
   and the install server (`/sign/*`). No server of our own: the app signs on the phone, the website in the browser
   (F93: zsign as WebAssembly, `web/app/vendor/zsign`, built by `tools/build-zsign-wasm.sh`).
2. `native/`: jailbreak app, a Swift shell around a WKWebView running `web/app/`, plus a root helper for apt.
   Rootless iOS 15+ up to the coming iOS 27 jailbreak. Shape and feel rules: `docs/native.md`. It must hold
   120 Hz: animate only transform/opacity, virtualise long lists, parse in a Web Worker.

There is no separate `ipa/`. R4 found a standalone non-jailbroken IPA not worth it (`docs/ipa.md`); the user then
chose one app, two builds: the `native/` shell also builds as a sideload IPA with no helper (plan section "IPA:
sideload management", I2-I4).

Shortcuts recipes live in `docs/shortcuts.md`.

- Gate: `tools/check.sh` (every `test_*.py`). It must pass before `done`. Add the `native/` builds (jailbreak and
  sideload) to it once they exist.
- Python: stdlib first (`bz2`, `lzma`, `gzip`, `email`-style parsing), then what `web/requirements.txt` already
  has. Ask in the journal before adding a dependency.
- Look and feel: **iOS 6 is the base style, 100%**. iOS 5 elements only where the user asks for one. Source of
  truth: the Teehan+Lax GUI PSDs, converted in `ref/teehanlax/ios6/` (and `ios5/`): `sheet.svg` (vector, layer
  names as `<title>`), `original-2x.png` (Photoshop's composite), `img/` (bitmaps) and `img-hd/` (bitmaps upscaled
  with 4xHDcube4). Take exact colours, gradients and sizes from the SVG. Text is real Helvetica Neue (the system
  font on iPhones); never use upscaled text. Artwork pulled off the 4S (`ref/4s/artwork/`, from `tools/artwork.py`) is the
  original for comparison only: use its HD counterpart from the kit (`ref/4s/hd/`, from `tools/kitmatch.py`;
  `ref/4s/kitmatch.html` flips HD/Original). Cydia's behaviour: `docs/cydia.md` (R2) and Cydia's GPLv3 source at
  https://git.saurik.com/cydia.git.
- Cydian is its own project, with its own patterns: don't copy or depend on the user's other projects (code,
  CSS, deploy scripts, signing or hosting). Sideload installs happen on the phone, Feather-style (docs/sideload.md, R5).
- Bundle ID and package name: `com.ryha.cydian` (extensions and spikes add a suffix: `com.ryha.cydian.share`).
- Drawing iOS 6 controls: take colours and shapes from the 4S's UIKit art (`ref/4s/artwork/Shared@2x/`, sample the
  pixels), pressed states from its `*Pressed` images. Never add highlights, glows or bottom lines the phone doesn't
  draw. A gradient on an element with a border needs `background-origin: border-box` (repeat it after any
  `background:` shorthand), or it tiles into the border and shows a light line at the bottom. The bar buttons, back
  arrow and switch in `web/app/ios6.css` are the reference: copy their approach for new controls, and check a 3x
  render zoomed in before calling it done.
- Never commit Apple artwork (UIKit `.artwork` extracts, system icons) or Cydia's logo. Pulled device files go in
  `ref/` (gitignored). Use them as a reference and redraw in CSS/SVG. Don't name the product or pages "Cydia".
  `ref/` exists only in the main checkout. In a worktree, link it first:
  `ln -s "$(git rev-parse --path-format=absolute --git-common-dir)/../ref" ref`.
- The server fetches URLs visitors type in. Every fetch goes through the SSRF guard (F3): no private, loopback or
  link-local addresses, size and time caps.
- The iPhone 4S (iOS 6, jailbroken) is a reference device only: `ssh 4s` (see R1). It shows how iOS 6 and Cydia look
  and behave. It will never run Cydian (the app or the site), so never test, benchmark or time Cydian on it.
  Only touch it when your task says so.
  Never run `apt-get upgrade`, `dpkg -i` or `rm` on it unless the task says so. It can't be re-jailbroken
  easily.
  Only one agent may drive its screen at a time. Taps, swipes, opening URLs and screenshots go through
  `tools/ui-4s.sh` under its lock: `lock <ID>` first, `unlock <ID>` when done (also after a failure). If it's
  locked, do other work and try later. Reading or pulling files over ssh needs no lock and can run alongside.
- The iPhone 7 (iOS 15.8.8, palera1n rootless) is the test phone for the jailbreak app (.deb): `ssh 7` (user
  `mobile`; `sudo` needs a password, so ask the user). Same rules as the 4S: touch it only when your task says so,
  drive its screen only through `tools/ui-7.sh` under its own lock (tap/swipe in screenshot pixels, 750x1334;
  `open URL`, `home`, `shot NAME` -> `ref/7/screens/`). `phonectl` on the phone does the touches and screenshots
  (source and installer: `tools/phonectl/`). The jailbreak is gone after a reboot: if `ssh 7` fails or
  `/var/jb` is missing, stop and ask the user to re-jailbreak it.
- License: GPL-3.0-or-later. Code taken from GPLv3 projects (Cydia) is fine; never copy code under a license GPLv3 can't include.
- Write findings worth keeping to `journal/<ID>/notes.md`.

## The main checkout

agent-runner merges every task into `~/repos/Cydian` (the main checkout). Don't leave uncommitted work there:
commit and push it, or work in a worktree or a clone of your own. Edits left in files a merge changes are moved to
a `wip/main-checkout-<time>` branch (and a stash) after 3 minutes so the merge can land (`runner.toml`
`land_edited = "wip"`); get them back with `git checkout wip/main-checkout-…` or `git stash pop`.
