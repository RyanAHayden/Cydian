# F252: IPA install's Complete page, a short ending

## What changed

- `core/signing.js`: `likelyCauseText` is gone. `notLandedText(app, check)` keeps deciding *when* (state unknown or
  out; null for in, skip, no check) but now answers the short `NOT_LANDED_TEXT` "Not on the Home Screen?".
  New `SENT_TO_IOS` = "Sent to iOS. Press Home to watch it install.". `UDID_HOW` stays (Swift's test compares it).
- `nav/progress.js`: `page.help(text, { label = "Help", action })`, a grey line with a black-bar button at its
  right (goes through the log buffer like any line, kind "help"). Style in `progress.css` `.pl-help`.
- `signing-client.js`: `installSteps[2]` is `SENT_TO_IOS`; `watchInstall` puts `cause` under the last step with
  `page.help` (option `help`, default `openAppHelp`), on "installed" and on "timeout" as before. "not_asked" keeps
  its Retry (iOS never got the app there); the Complete page after iOS has the app has only Return.
- `signing-sheet.js`: `followInstall` says `SENT_TO_IOS` (was "Done"), same help line when the check couldn't run.
- `screens/guides.js`: FAQ "An app won't install" (id `app`) carries the UDID-in-profile explanation and
  `UDID_HOW` as steps. `APP_HELP`, `appHelpHref()`, `openAppHelp(page)` (closes the progress page, sets the hash to
  home/guides/faq/app).
- `docs/signing.md`: the "When nobody could check" line says the new ending (not in the task's files; one line).
- Tests: signing-client-status, signing-device (help line, no warning, no Retry, guide steps, Help's route),
  device-check, signing-sheet, signing-client-device, signing-client-web updated. `node --test web/app`: 1736 pass.

## Decisions

- 'out' (known not in profile) shows the same help line: the app's and the website's installs already refuse
  before signing when the UDID is known missing (device_not_in_profile / siteRefusal), so it rarely gets here, and
  the brief allows either.
- The concept artifact (claude.ai link) needs a login, so it wasn't opened; layout follows the brief's words.

## Render

`render.html` here (serve the repo root, open it): progressHUD with the website's steps, the help line, done.
`complete-3x.png`: Chromium headless at 3x, 375x667. Help bar button zoomed in matches the nav bar's Done button.

## Not verified

- On a phone (iPhone 7 app or Safari): the task didn't ask for a device test; render and unit tests only.
- The Help tap's navigation in the real app (closing the sheet, then Home's stack opening faq/app): covered by a
  unit test of `openAppHelp` with a fake `go`, not clicked in a browser.
- The concept artifact (screens 1 and 3): not reachable without a claude.ai login.
