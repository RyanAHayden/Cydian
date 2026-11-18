# F183: iFizBox's own update check runs silently on every reload; no About page

## What I did
- **Settings > About is gone**: aboutRow/aboutPage, the `about` route and its TITLES entry, checkUpdates (the manual
  HUD path), Check for Updates and Skip This Version. `nav({ path: ["about"] })` now falls through to "Settings".
- **core/selfupdate.js**: removed dueForCheck, shouldOffer, setSkip, offerAlert, DAY, the alert branches of
  checkForUpdates and runInstall with its sideload/jailbreak install paths (nothing reached them once the alert was
  gone). checkForUpdates is now silent: it fetches GitHub's latest release every call, keeps it (`latest`), and
  answers "newer" / "current" / "error" / "site". New `newerRelease(storage, current)`. Kept: the version compare,
  parseRelease, debFor (Home's Install offers and tools/test_release.py use them), fetchRelease, the state.
- **core/essential.js**: removed the Essential Upgrade alert (runEssential, essentialAlert and its constants,
  queueEssential, belowMinimum, essentialIds/essentialUpgrades). Added `selfInfoWith(sourceInfo, release)` (the newer
  of iFizBox's AltStore source and GitHub's release, GitHub only when it has an IPA) and `lookForSelfUpdate(deps)`
  (reads the source in the sideload build and GitHub's release, side by side, silent on failure, then `changed()`).
- **essential-ui.js**: startEssential, the banner, the forced lock and the queue buttons are gone; `lookForUpdates()`
  binds lookForSelfUpdate and fires `cydian:self-info` so Changes (which already listens) reloads its rows and badge.
  `upgradesWithSelf` builds iFizBox's row from selfInfoWith, so a GitHub release newer than source.json shows too.
- **app.js**: launch (2 s), Home's Reload (`cydian:reloaded`) and returns call lookForUpdates; no once-a-day wait,
  no alert.
- **Version line in Settings**: new `screens/version-foot.js` holds footLine, buildInfo and `versionLines()` (the
  `.home-version` line plus the commit line). Home uses it (re-exports footLine for its tests) and Settings' root
  appends it last, so the text and style are the same on the website and both app builds.
- Docs: release.md, settings.md, signing.md and tools/release.sh's `--minimum` comment.
- Follow-up filed: C8 (whenConfirmEnds, essentialqueue.test.js, the shell's selfupdate.download and the helper's
  selfupdate command are now unused).

## Decisions
- **"Updated to X" banner dropped.** It is the iOS 6 notification banner sliding over the screen: a popup in the
  user's sense ("not notify with a popup"). The icon-badge reset after a self-update stays; the new version shows in
  the version line at the bottom of Home and Settings.
- **Jailbreak build adds no row from GitHub.** Its iFizBox row is apt's, from the built-in repo, which is served from
  the same release; a GitHub-only row couldn't go through apt's queue. GitHub's release is still fetched and kept.
- **The source's minimum version no longer blocks.** The brief says no Essential Upgrade popup; the lock was that
  popup's forced form. minimumOf still parses the field; release.sh still writes it.
- The sideload Update Alerts section (background check, badges) stays: it serves Changes' app badges, not About.
- Home's own "About" nav button (credits, Cydia's) is a different thing and stays.

## Tests
- selfupdate.test.js: check never alerts, asks GitHub every call, errors silent, old exports gone.
- essential.test.js: a reload with a newer release calls no alert and puts the iFizBox row on top of Changes;
  selfInfoWith; lookForSelfUpdate per build; app.js/essential-ui.js wiring has no popup left.
- settings.test.js: the about route is gone, the rendered root (fake DOM) ends with the two version lines, no
  About/Check for Updates/Skip text in settings.js.
- Headless Chromium screenshot of the website's `#/home/settings`: the line sits under the last group, same grey
  embossed text as Home.

## Not verified
- The two app builds on a phone (no device task here; the iPhone 7 is only for tasks that say so): the version line
  in the app's Settings with app.info's machine/version, and the Changes row appearing after Reload with a real
  newer release. Covered only by node tests with fakes.
- The jailbreak build's iFizBox row depends on apt refreshing the built-in repo (Refresh on Launch / Reload); not
  run.
