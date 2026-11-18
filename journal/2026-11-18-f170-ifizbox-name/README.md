# F170: iFizBox rename 1/3: one source for the name, every visible name, the new icon

The user renamed the project from Cydian to iFizBox ("Cydia" is SaurikIT's registered trademark, and "Cydian" is one
letter off it). This task covers the name itself. The IDs, storage keys and paths move in F171, the domain and
GitHub repo in F172.

## What was done

**One brand source**
- `web/app/brand.js`: `NAME` "iFizBox", `DOMAIN` ifizbox.com, `SIGN_HOST`, `BUNDLE_ID`/`PACKAGE`
  com.ryha.ifizbox, `GITHUB_REPO` RyanAHayden/iFizBox. The frontend (66 modules) and `worker/src/index.js` import
  `NAME`. Only `NAME` is wired in so far. The other constants are there for F171/F172 to use, and nothing reads them
  yet.
- `native/brand.env` holds the same values as `BRAND_*` lines that a shell can source. `native/brand.py` reads it
  for Python (`from brand import NAME`), and `python3 native/brand.py sync` regenerates everything that can't import
  brand.js:
  - `native/sign/Brand.swift` (`Brand.name`). It lives in `sign/` so every build and Swift test harness that
    compiles `sign/*.swift` picks it up. The share and intents harnesses, `widget/build.sh` and the share extension
    build list it by hand.
  - `web/app/index.html`: the title and Open Graph names, which crawlers read without running JS.
  - `web/app/manifest.json`.
  - `web/app/source.json`: the top-level and app names and descriptions, through the new `tools/altsource.py
    rebrand`. Older versions' release notes keep the name they shipped under.
- `native/build.sh` sources brand.env and substitutes `$(BRAND_NAME)` in Info.plist (CFBundleName and
  CFBundleDisplayName), the share and widget plists, and deb/control (Name, Maintainer, Author).
- These tools read brand.env:
  - `tools/selfrepo.py`: the APT Release file's Origin, Label and Description.
  - `tools/altsource.py`.
  - `tools/release.sh` and `tools/publish.sh`: the release title, notes and commit message.
  - `tools/launch_images.py`.
  - `tools/og.html` imports brand.js.

**Renamed to iFizBox (everything a person reads)**
- Web: every alert, title, banner, footer, Home's welcome line, the tiles, About, Credits, Guides, Settings, Account,
  the queue's Return to/Close, the error messages, the page title and the manifest. The About credit stays as it was:
  "Inspired by Cydia by Jay Freeman (saurik) / Not affiliated with SaurikIT". Credits keep "For Cydia, whose look…"
  and "… is not affiliated with SaurikIT".
- Worker: the /repo text, not_allowed and not_found messages.
- Native: the display names of the app, share extension and widget; deb Name, Maintainer and Author; every Swift
  alert, label and intent failure (as `Brand.name`); the widget text; the backup file name ("iFizBox Packages
  <date>.json").
  - The App Intents descriptions no longer name the product ("Refreshes your sources…"). They are build-time
    constants (const values for Metadata.appintents), so an interpolated `Brand.name` would break the metadata
    extraction.
  - The helper's refusals now say "the app" / "isn't the installed app". They are C, and only the error text
    changed; the logic is the same.
- Images: the launch images for the home-screen web app (`web/app/icons/launch/*`, nav bar titled iFizBox) and the
  link card `web/app/icons/og.png` (iFizBox, ifizbox.com; `og:image` cache key bumped to v=3) were redrawn with
  headless Chromium.
- Docs: `docs/*.md` (not `docs/concepts`), README.md (plus an "inspired by Cydia, not affiliated" line), AGENTS.md
  (plus a short rule: the name comes from brand.js / brand.env), the native/worker/helper READMEs and the code
  comments. runner.toml has no visible "Cydian" left (its `tmux -s cydian` is an ID).

**Icon**: merged `origin/ifizbox-icon` (the approved blue starburst + globe icon, the native app icons and
`docs/concepts/icon`).

**Test** (`native/test_brand.py`, in the gate):
- brand.js equals brand.env.
- Brand.swift, index.html, manifest.json and source.json are synced.
- The plist and control templates use `$(BRAND_NAME)`.
- A scanner over the JS string literals in `web/app` and `worker/` (tests excluded) and the Swift string literals
  checks that none says Cydian and none spells iFizBox outside brand.js and Brand.swift. Checked by mutation: a
  literal "Welcome to Cydian" or "Welcome to iFizBox" in home.js fails it.

## Left on purpose (F171 / F172)
These still use the old spelling, and the brand test's grep skips them:
- `com.ryha.cydian*`, the `cydian://` scheme, `cydianNative`, the storage keys, `cydian-helper`.
- `Cydian.app`, `Cydian.ipa` and `Cydian.deb` (the executable, module and asset names; `mkdeb`/`mkipa` check
  `CFBundleExecutable` "Cydian").
- The `X-Cydian-Minimum-Version` field and the `CYDIAN_*` env names.
- The keychain labels ("Cydian signing identity"…: renaming them would orphan stored certificates) and the
  User-Agent.
- cydian.dev and the `RyanAHayden/Cydian` URLs (GitHub redirects the old repo name).
- Function names such as `markCydianInstalled`/`installCydian`.
- `testrepo/`, the test fixtures (the binary profile "Cydian Test Profile", tiny-cydian.ipa's "Tiny Cydian"),
  `native/spike`, `journal/` and `plan/` (history).

## Tried and changed
- A first og.png render showed a directory listing in the phone. index.html's deep-path script sends the iframe at
  `/web/app/index.html` to `/`, and `http.server` at the repo root lists the folder there. A small handler that
  answers `/` and missing paths from `web/app/` fixed it. og.html's comment now says so.
- The `ref` symlink in this worktree pointed at the old `~/repos/Cydian` path. I re-linked it, as AGENTS.md says
  (it is gitignored).

- The second gate run failed in the native build with "precompiled file … was compiled with module cache path
  '/home/ryha/runs/Cydian/s1/native/build/modules'": the gitignored clang module cache in `native/build/` dates from
  before the folder rename. Every slot that built before then would fail the same way, so `native/build.sh` now
  writes its path to `build/modules/.path` and starts the cache again when the path differs. After that,
  `make -C native package` passed. The built Info.plists (app, share, widget) say iFizBox, and so do the .deb's Name,
  Maintainer and Author.

## Not verified
- The app on a phone: F170 does not touch the iPhone 7, and F171 installs the renamed build there. The native
  builds compile and pass mkdeb/mkipa's checks in the gate, but nobody has looked at the home-screen name, alerts
  or widget on a device.
- How Sileo/Zebra show the APT repo's new Origin and Label: no release has been published (F173).
- Link previews of og.png in chat apps: not deployed, and deploying is not part of this task.
