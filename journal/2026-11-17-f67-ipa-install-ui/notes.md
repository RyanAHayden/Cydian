# F67: Install IPA in the jailbreak build's web UI

## What was done

- **`web/app/core/ipainstall.js`** (pure): `ipaUrl` (http/https only, `https://` added to a bare host), `looksLikeIpa`,
  `ipaName`, `ipaStatus` (status fd: `dlstatus` fills the bar's first fifth, installd's `pmstatus` percent the rest,
  `pmerror` red), `ipaError` (title, message, the shell's words, help lines for every F59 error code), and the words
  `NO_ADHOC_HELP` / `IPA_FOOTER`. `no_adhoc` says: install AppSync Unified (its repo), or ldid (Cydian then signs ad hoc),
  or sign the IPA for the phone first.
- **`web/app/ipa-install.js`**: `installIpa(url, onEvent)` calls `cydianNative.call('ipa.install', {url, stream})`
  directly (like signing-client.js), because backend-native.js's error mapping folds unknown codes (no_adhoc, bad_ipa)
  into "network". `runIpaInstall` is the console's logic without the DOM (view.line/status/progress), so it is tested
  on the fake bridge + fake helper.
- **`web/app/screens/ipa-install.js`**: the console sheet (the queue console's `modal` and `.console` CSS: streamed
  lines, white status, red errors, bar, Return to Cydian; one status line per change, not per percent; the helper's own
  `cydian-helper:` error line isn't repeated), an alert after a failure (no_adhoc explained), the run saved in Console
  Logs. Ways in:
  - Settings > Install IPA > Install from URL (alert with URL field + Paste; asks again on a non-link);
  - AltStore app pages and the package page's action sheet: `installRows` puts **Install** ("With the jailbreak") first
    in the jailbreak build (labelled "Install IPA" when the source also has a signed itms link); footer/sheet title say
    how it installs;
  - a tapped link to an `.ipa` anywhere (capture-phase click listener, `initIpaLinks` from app.js): action sheet
    Install IPA / Open Link.
- Sideload build and site untouched: `ipaInstallAvailable()` is jailbreak-mode only; signing.install paths unchanged.
- Small touches outside new files: `screens/queue.js` `modal` exported (one word); `installRows` got a 6th `name`
  parameter; one line each in settings.js (section), browse.js (sheet title), app.js (init).
- Tests: `web/app/ipa-install.test.js` (9).
- Checked in headless Chromium (harness page with a stub bridge, deleted after): success and no_adhoc consoles render
  with the right colours; that's how the duplicate red line and repeated "Installing" lines were found and fixed.

## Decisions (unattended)

- No confirm alert before installing from an Install row: the tap is the intent (like Cydia's Install). The URL alert
  and the link sheet are their own confirm.
- The IPA console is separate from the apt queue's (its own `running` guard), so an IPA can install while the queue
  holds packages; the helper serialises its own work.

## Not verified

- Nothing ran on a phone: no jailbroken modern iPhone here, and F59's helper side never ran on one either. Whether real
  installd pmstatus lines look like the fake's (text, percent steps) is unknown.
- Settings section and the AltStore Install row were not rendered in a browser (only the console was); they use the
  existing `grouped` rows.
- The link interception wasn't exercised in the app's WKWebView (only reasoning: capture-phase click on `a[href]`).
- AppSync Unified's repo URL (cydia.akemi.ai) is from memory, not checked online.
