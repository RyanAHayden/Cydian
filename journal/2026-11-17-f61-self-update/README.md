# F61: Cydian updates itself

User 2026-11-17: "like a popup for install when github has gotten better".

## What was done

- `web/app/core/selfupdate.js` (pure; every side effect injected):
  - `parseVersion` / `compareVersions` / `isNewer` (vX.Y.Z, numeric parts, missing parts 0, an unreadable tag never
    counts as newer).
  - `parseRelease` turns GitHub's `releases/latest` JSON into `{ version, tag, notes, url, ipa, debs }`. It returns null for
    drafts, rate-limit answers and tags that aren't versions. `noteLines` keeps the first 4 lines of the notes,
    with the Markdown taken off.
  - `debFor(release, arch)`: an asset ending `_<arch>.deb` / `-<arch>.deb`, else the plain `Cydian.deb`. The plain one only
    counts for `iphoneos-arm64`, because native/build.sh builds it rootless.
  - State in localStorage `cydian.selfupdate`: `lastCheck` (the once-a-day gate), `laterAt`/`laterVersion`, `skip`,
    `latest`, `current`.
  - `checkForUpdates(deps, { manual })`. Automatic: does nothing unless a day has passed since the last check, stays
    silent on failure, and doesn't set the gate on failure, so the next launch retries. It doesn't offer a skipped
    version, or one put off with Later in the last 24 hours. Manual (Check for Updates): always asks GitHub and
    says "Cydian Is Up to Date" or "Couldn't Check for Updates". It offers the release even if it was skipped or
    put off.
  - `runInstall(release, mode, deps)`:
    - sideload: `signing.status` has no identity → "No Certificate" alert, then Settings > Signing. With one →
      F58's `installOnDevice({ url: Cydian.ipa })`, which handles its own errors (untrusted → Settings > Signing).
    - jailbreak: `selfupdate.download` → `cydian-helper selfupdate <path>` → "Cydian Updated" with Later /
      Close Cydian (`app.quit`).
- `web/app/screens/settings.js`: `checkUpdates({ manual })` binds the core to the bridge, the signer, showAlert and
  a HUD that can change its label. Manual checks show a Checking HUD until the first alert. Only one check runs at
  a time. The **About** group (app builds only, last on the root page) shows Version, Check for Updates and, once a
  newer release is known, a checkable **Skip This Version** row (subtitle "Cydian X.Y.Z").
- `web/app/app.js`: in the app, `checkUpdates()` runs 2 s after launch.
- `native/Sources/Bridge.swift`: `SelfUpdate`:
  - `selfupdate.download {url}` (https only) uses Apt.get, which follows redirects and caps at 64 MB. It checks the
    `!<arch>\n` magic and writes `<tmp>/Cydian-update.deb`, returning `{ path, bytes }`.
  - `app.quit` suspends to the Home Screen and then `exit(0)`, like Cydia's "Close Cydia" after `finish:reopen`.
- **Outside the brief's file list:** native/helper (policy.c/.h, main.c header, README, test_helper.py) gets a new verb,
  `selfupdate <path.deb>`. It runs `dpkg --force-confdef --force-confold [--status-fd 3] -i <path>`. The brief says
  "install it through the N2 helper (dpkg -i)", but the helper had no verb that takes a file: `install` only takes known
  package names, and the name check rejects paths. The path must be absolute, `[A-Za-z0-9._/-]`, have no `.`/`..`
  segment, end in `.deb`, be at most 1024 bytes, and be a regular file (lstat, so not a symlink). Any .deb is accepted.
  The caller check is the boundary, and Cydian can already install any package through addsource + install.
  The new verb is purely additive: one new branch in `helper_plan`, a new function, and one row in the README.

## Decisions

- "Offer to relaunch": iOS gives an app no way to start itself again. The button is **Close Cydian**, Cydia's own
  wording for `finish:reopen`. It goes to the Home Screen and ends the process, so the next tap on the icon runs the new
  binary. The message says to open it again.
- Later sets `laterAt`. The once-a-day check already spaces out the asking, and `laterAt` also covers a cleared gate or a
  failed check, so Later always means "not within 24 h".
- Check for Updates ignores Skip and Later, because the user asked for it. The About footer says so.
- The release is read through the shell's `net.fetch`: no CORS, and GitHub's API wants a User-Agent, which Apt.session
  sends as `Cydian/<version>`. No token, so the limit is 60 requests an hour per IP, and once a day is far below that.

## Tried and failed

- First test run: a "Later" test expected an install a day after Later, but the second check that day had moved
  `lastCheck`. The code was right (that check counts as the day's check); the test was fixed.

## Verified

- `node --test web/app`: 448 pass, including the 22 tests in `core/selfupdate.test.js`. They cover the version
  compare, the release parse, the once-a-day gate, Later, Skip This Version, manual vs automatic, and which path each
  mode takes. That includes no certificate → Settings > Signing, and the jailbreak path never calling the signer.
- `python3 -m unittest native.helper.test_helper`: 26 pass, including the new `test_selfupdate_plan` (the exact
  argv, with and without a status fd, and 12 refusals).
- `make -C native package` builds Cydian.deb and Cydian.ipa with the new Swift (the Swift compiles for iOS).
- Follow-up filed: T6, a release script that publishes the assets under the names this code looks for.

## Not verified

- **On a phone, from an older release (the brief's last check).** There is no newer GitHub release than v0.1.0 to update
  to, and AGENTS.md says to touch the 4S only when the task says so. That check is the user's, once a v0.2.0+ release with
  Cydian.ipa (and the .deb) is published.
- **The release asset names.** Nothing publishes releases from this repo yet, so I can't see what the assets will be
  called. `debFor` looks for `Cydian.deb` (rootless) or `*_<arch>.deb`, and `Cydian.ipa` (falling back to any .ipa).
  If releases use other names, the jailbreak path will say "no .deb for <arch>".
- **`dpkg -i` replacing the running app on a real jailbreak** (does the postinst uicache or kill the app before the
  "Cydian Updated" alert shows?). Only the helper's plan and refusals are tested, on Linux. `selfupdate.download`'s temp
  path must pass the helper's path rule. For a rootless app the path is `/var/mobile/...` or a container UUID path, which
  should pass, but I have not seen it on a device.
- **`app.quit`** (`NSXPCConnection.suspend` + `exit`) has not been run on a device. It only compiled.
- **Sideload install over the running app keeps the data.** That rests on F58/I6: same bundle ID, an install over the
  app. Not exercised here.
