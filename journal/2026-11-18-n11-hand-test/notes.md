# N11: N6's hand test on the iPhone 7, finished with root

`ssh 7 'sudo -n true'` returned 0, so root was there and the whole list ran. Cydian 0.3.8-791 from this branch
(`native/build.sh deb`, scp, `sudo dpkg -i`, uicache by the uikittools trigger). The screen was driven through
`tools/ui-7.sh` under its lock (I waited about 5 minutes for R14 to release it). Screenshots: `shots/` (halved
JPEGs). The full-size PNGs are in `ref/7/screens/n11-*.png` (main checkout, gitignored).

## Each step, and what it showed
- **Helper runs as root after N6's rootless fix:** `sudo cydian-helper` now gets as far as its caller check
  ("the calling process isn't Cydian") instead of SIGKILL. Every install and remove below went through it.
- **Install from the app:** Search > `tree` > Install > Confirm. The console ends "Installed tree", Done, Return to
  Cydian (`07-install-done`). `dpkg -s tree`: install ok installed 2.0.1.
- **Upgrade:** repacked tree as 2.0.0 and installed it by hand with `sudo dpkg -i`. Changes needed a Refresh to see it
  (the app was in front during the out-of-app downgrade, and Cydia behaves the same). Then: tree 2.0.1 under
  Available Upgrades, badge 1, Upgrade (1) > Confirm, "Unpacking tree (2.0.1) over (2.0.0)" (`11-upgrade-done`).
- **The daemon's count:** `sudo cydian-upgrades --force --no-update --dry-run` said "1 upgrades" with 2.0.0 installed
  (apt's 14 same-version reinstalls are not counted) and "0 upgrades" after the app's upgrade.
- **Remove:** tree > Modify > Remove > Confirm (`15-remove-done`). dpkg doesn't know tree any more, and
  `/var/jb/usr/bin/tree` is gone.
- **Add a source from the app:** Sources > Add, typed `ios.jjolano.me` (`19-typed`), Add Source. The stanza is in
  `cydian.sources`, and jjolano is listed with 23 packages (`20-source-added`).
- **`cydian://package?id=<free tweak>`:** Oneko (Chariz, free, iOS 15+). Warm and cold launch (process killed
  first) both open Oneko's page (`22-package-link-cold`). Install > Confirm installed it from repo.chariz.com, and
  the console offers Restart SpringBoard (`24-oneko-done`; I didn't respring). `dpkg -s`: installed 1.0.0.
- **The website's Install Full Cydian sheet** (cydian.dev in Safari): the purple tile opens the sheet
  (`39-full-cydian-sheet`). Add to Zebra goes through Safari's "Open in Zebra?" prompt (`40-safari-open-zebra`).
  Coming back through the status bar's ◀ Safari brings up "Open Cydian in Zebra?" (`44-return-safari`), and its
  button opens `zbra://packages/com.ryha.cydian` in Zebra. A return made by `uiopen https://cydian.dev/` reloads the
  page instead, so that alert never comes.
- **`sileo://package/com.ryha.cydian`:** "Couldn't find the package" (`25-sileo-package`), because Sileo couldn't
  read Cydian's repo: bug 1.
- **`zbra://packages/com.ryha.cydian`:** Zebra 1.1.36 (installed from Procursus for this test) opens Cydian's page,
  but only from its "Local Repository", meaning the installed copy (`35-zebra-package-live`). Zebra can't read the
  GitHub-hosted repo either, for a different reason: B17 below.

## Bugs found
1. **Sileo refused Cydian's own APT repo** ("Error: Could not parse release file. Could not find release file for
   https://github.com/ryanahayden/cydian/releases/latest/download/", `27-sileo-added`). Sileo 2.5's RepoManager.swift
   drops any Release without a `Components` field (`guard ["components"].allSatisfy(releaseDict.keys.contains)`),
   flat repo or not. `tools/selfrepo.py` wrote none. **Fixed:** `Components: main` (Chariz, a flat repo, sends the
   same). Test: `tools/test_selfrepo.py` (new). On the phone, a repo built by the fixed selfrepo.py and served from
   this machine (through `ssh -R 8711:127.0.0.1:8711 7`, because the desktop's firewall blocks the LAN) is accepted
   by Sileo as "Cydian" with no error (`29-sileo-fixed-refresh`). `sileo://package/com.ryha.cydian` then opens
   Cydian's page with GET (`30-sileo-package-fixed`). Takes effect for real users with the next `tools/release.sh`.
2. **A package page left open under the console showed the old state.** After installing tree its nav bar button
   still said Install (`12-search-again`), and after removing it, Modify, until the page was opened again
   (`13-tree-reopened`). Modify's sheet reads the same stale history. `queue.js` already calls
   `catalog.reloadInstalled()`, which fires `catalog.onChange`, but package pages didn't listen. **Fixed:**
   `refreshPackagePages` in `web/app/screens/browse.js`, hooked to `catalog.onChange`: each APT page on screen asks
   for its Version History again and sets Install/Modify. The page now also remembers its source key. Test:
   `web/app/screens/pagerefresh.test.js` (new). Checked on the phone with a rebuilt .deb: Modify right after the
   install (`51-…`) and Install right after the remove (`52-…`), without leaving the page.

## Filed, not fixed here
- **B17** (normal): Zebra can't read the GitHub-hosted repo. GitHub redirects each file to a
  `release-assets.githubusercontent.com/...?sig=…&jwt=…` URL, and Zebra names its cache file after that final URL:
  "The item couldn't be saved because the file name … is invalid" (`34-zebra-added`). The same files served without
  the redirect load fine in Zebra (`37-zebra-local-added`), and after that `zbra://packages/com.ryha.cydian` shows
  Source: Cydian, 4.1 MB (`48-zebra-package`). The fix is to host the repo somewhere that doesn't redirect (Worker),
  which touches worker/, release.sh and the built-in source, so it's outside this task's files.
- **B18** (low): a Sileo `DepictionButtonView` with `isLink` and a nested `view` draws as an empty orange bar
  (Oneko's "Version History" link, `22-package-link-cold`).

## Phone left as found
Removed tree, Oneko and Zebra (plus Zebra's Application Support folder), the jjolano stanza from
`cydian.sources`, and the two stanzas I added to `sileo.sources` (the GitHub repo and 127.0.0.1:8711). Also
deleted `/tmp/n11*`. Stopped my tunnel and http.server by pid. Cydian 0.3.8-791 (this branch) stays installed.

## Not verified
- **Sileo against the published GitHub repo with the fix:** the fix only reaches GitHub with the next release
  (publishing isn't part of this task). I checked it with the same files served locally without redirects. Sileo got
  past GitHub's redirects for Release, since it parsed that file far enough to reach the Components check, but its
  download of Packages through the redirect was never exercised.
- **The "Install in Cydian" row on a website app page:** that row exists only on AltStore app pages, and the
  brief's target was a tweak. I opened the same `cydian://package?id=` link with `uiopen` (iOS's openURL, the call
  Safari makes after its "Open in Cydian?" prompt) rather than tapping the row in Safari.
- **The "Add to Sileo" button on the website:** only Add to Zebra was tapped through Safari. The Sileo links were
  opened with `uiopen`. Both buttons run the same code path (`offerPackageOnReturn`).
- **Oneko actually running:** no respring, so the tweak was installed but never loaded.
- **The rest of the package page after a run** (the "Installed" group and rollback slot): the fix updates the button
  and the history Modify uses, not those groups. They catch up when the page is reopened, as before.
