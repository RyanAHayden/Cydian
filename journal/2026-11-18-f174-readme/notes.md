# F174: README rewritten with the readme skill, screenshots in the iPhone 5 frame

## What I did

- **readme skill, `--mode direct`** (no interview, as the brief says). Phases 0–3 as the skill lays them out:
  read the old README (kept its narrative: the Cydia/SaurikIT note, the Worker section, the licence line), code
  analysis (brand.js/brand.env, worker/src/index.js routes, wrangler.toml, native/build.sh, docs/signing.md,
  account.md, release.md, shortcuts.md, worker/README.md, home.js install tiles), then the draft and a
  cross-check of every claim against the code. Departures, on purpose: the checkpoint files went to the session
  scratchpad, not the repo (they'd be committed otherwise); Phase 4 (user review) can't happen unattended, so the
  README is written straight to README.md (the task is a rewrite); no translations (direct mode). Sections follow
  the skill (centred badges, TOC, intro, install, usage = how it works/build, contributing, licence, a mermaid
  graph marked experimental, an alert, collapsed sections), in the style of the user's other READMEs (opentennis).
- **Cross-check corrections** made while drafting: the jailbreak app does *not* sign (docs/signing.md: the helper
  installs IPAs directly, `signing.*` answers `jailbreak`), so the README says only the website and the sideload
  app sign. The Worker's route table lists what index.js actually routes (incl. /api/applookup, /api/ipainfo,
  /repo/, /api/account, /reviews), not only the four the old README named.
- **Screenshots** (12, docs/img/, 464x962, 140–335 KB each, ~2.8 MB total):
  - Website (`web-*`): `node worker/node.mjs` on 127.0.0.1, headless Chromium driven over CDP by `capture.mjs`
    (here) with `website-shots.json`: 320x548 CSS px at DPR 2, mobile, iPhone UA. Live default sources.
    Before capturing, the script sets `ifizbox.firstVisit=later` (the state after "Browse Anyway", so the tabs
    aren't padlocked) and deletes four default AltStore sources (apptesters, ryuksign, crystall1ne, unbound)
    from IndexedDB, because their Changes rows read "Injected with Subscription Unlocked" (tweaked paid apps):
    not what a README should show. Run: `node capture.mjs http://127.0.0.1:8794/ <outdir> website-shots.json`.
  - Jailbreak app (`jb-*`): the iPhone 7 (0.9.4-1208 installed), `tools/ui-7.sh` under lock F174: Home, Sources,
    ElleKit's package page, and the install log of a real install of `figlet` (Procursus, no new deps). figlet
    was removed afterwards (`apt-get remove`, `dpkg-query` confirms it's gone); lock released.
- **`tools/readme_shots.py`**: frames a folder of captures in the Teehan+Lax iOS 6 kit's "iPhone 5 Portrait"
  (img-hd/04 base phone, screen at 66,237, earphone 35, camera 36, shadow 03, the "Screen glare" path shape_14
  with its img/34 mask and gradient_9, opacity .35). It takes 640x1136 as is, draws an iOS 6 status bar (black,
  Helvetica Neue Bold, plain shapes like tools/og.html, no Apple glyphs) above 640x1096 captures, and for 750x1334
  iPhone 7 shots replaces the iOS 15 status bar the same way and fits the rest to 640x1096 (both 16:9-ish, <1%
  squeeze). Default output scale 0.6. Pillow, like the other local reference tools; the gate doesn't run it.
- **`tools/test_readme.py`** (the brief's test): every image and local link in README.md exists; nothing links ref/.

## What failed / was changed on the way

- The worktree's `ref` symlink pointed at the old main-checkout path (`~/repos/<old name>/ref`, gone after the
  rename); relinked it to `~/repos/iFizBox/ref` (gitignored, local only).
- First captures: `nav: ""` was skipped as falsy and hash-only navigations don't reload, so the "Browse Anyway"
  state never applied and pages stacked on each other's tabs. Fixed with a `?r=N` cache-buster per load.
- A crashed capture run left its headless Chromium running; I closed it by its pid (2910207, my `/tmp/cdp-*`
  profile) after reading its command line, leaving two other sessions' Chromiums alone. The driver now keeps its
  profile in the cwd and kills Chromium on exit. Three empty `/tmp/cdp-*` profile dirs from those runs are left in
  /tmp (outside the worktree, so not deleted by me).
- Quantising to 256 colours made the set 8x smaller (392 KB total) but banded the icon reflections and made the
  phone's edges jagged; kept full colour at scale 0.6.
- **No Cydia artwork**: the jailbreak Installed list and the bash/figlet package pages show Cydia's section icons
  (web/app/icons/sections, copied from Cydia's GPLv3 source) for packages with no Icon field, which the brief rules
  out. Installed's Tweaks/Apps filters are empty on the 7. So: the package page is ElleKit (its own icon), and
  Installed comes from the website (its empty state + Choose Status File). The grey "?" beside names is iFizBox's
  own SVG compatibility mark (packages.css), not a Cydia purpose badge.

## Not verified

- **How the README renders on GitHub** (mermaid graph, `> [!NOTE]`, centred badges, the 24%-width image rows):
  nothing here renders GitHub Markdown; checked the source only. The shields.io badges and the Deploy button are
  external images, not fetched.
- **The sideload LITE build in a screenshot**: no sideloaded install was available to capture (the 7 runs the
  jailbreak build); the README shows its icon only.
- **Settings > Signing with a certificate loaded**: captured empty (no test certificate used, so nothing
  personal shows).
- The README's install steps for Sileo/Zebra, AltStore/SideStore/Feather and the Docker/wrangler commands were
  checked against the code and docs, not run end to end (no fresh phone, no Cloudflare login in an unattended run).
- The glare matches the kit by eye (diagonal edge from the top right, fading down); not compared pixel for pixel,
  because original-2x.png isn't at the sheet's scale.
