# B85: IPA multi-app reinstall run: one prompt per app, dismissed prompt doesn't hang, tap to re-prompt

## The cause, as far as the code shows

No log of the user's run exists, so the cause comes from reading the code path (followHandoff / run.away in
screens/apprun.js, openPrepared, signing.open -> Sideload.serveChecked, signing.progress -> Sideload.watch):

- `serveChecked` called `UIApplication.shared.open(itms-services link)` with no completion and no regard for
  iFizBox's state. iOS drops an itms-services open made while the app isn't active (the previous app's prompt is
  still up or just answered, iFizBox in the background), and the result was never looked at. That app's watch then
  saw nothing (no prompt, no IPA request, no progress) and ended `installed: false` after `ask` (600 s, or 30 s after
  a full fetch) -> "Failed: iOS didn't install it" with iFizBox in front, or "Sent to iOS" (B76) if iFizBox had gone
  to the background. That is the "only one prompt" half.
- A dismissed prompt looks, to the install server, exactly like one still waiting: no IPA request. The watch had no
  way to tell, so it waited `ask` = 600 s: the "stuck on waiting forever" half.
- The run's row in "asking" only opened the Log; nothing could show the prompt again.

## What changed

- `native/Sources/InstallPrompt.swift` (new): per bundle ID on the main queue. `open` waits for iFizBox to be active
  and settled (1 s after it came back), opens with a completion, retries a refused open (3 tries, 1.5 s apart) and
  opens once more if iFizBox never went inactive within 8 s (no prompt). It sees the prompt through iFizBox's own
  state (willResignActive after an open = shown, didBecomeActive after = answered) and the install server's route
  lines (`heard` = iOS asked for the IPA = Install tapped). `dismissed` = shown, answered, then 20 s in front with no
  IPA request. `reprompt` opens the link again while the IPA is still served. Every step goes to InstallLog, which
  signing.progress streams to the page's console, so a row that ends wrong now says what was seen.
- `Sideload.swift`: serveChecked opens through InstallPrompt (and answers cancelled if the job was cancelled while
  waiting for iFizBox to be in front), marks `heard`/`end`; watch ends on `dismissed`; progress answers
  `dismissed: true` (not handed off), cancels that tag's serving, and logs a summary line ("Install watch ended:
  installed false (prompt dismissed); link opened 1x, prompt seen yes, answered yes, IPA asked for no, IPA fetched in
  full no"); new `signing.reprompt {bundleId}`.
- `signing-client.js`: openPrepared passes `dismissed`; new `repromptPrepared`.
- `core/apprun.js`: `dismissed` ends the row Cancelled ("Cancelled on the iOS prompt", retryable, still queued) and the
  next app goes on; `run.reprompt(id)` for the asking row (logged), only while that app is with iOS.
- `screens/apprun.js`: phoneLanes' `reprompt`; a tap on a "Tap Install on the iOS prompt" row re-prompts instead of
  opening the Log.

Signing.install (single installs) and My IPAs' library.install share serveChecked, so they get the same open-when-in-
front and the extra log lines; their own pages don't read `dismissed`.

## Tests

- core/apprun.test.js: dismissed first app -> second still prompts, run ends, retry works; dismissed last app ends the
  run, a plain refusal stays Failed; reprompt only for the asking row, logged, false without a lane.
- screens/apprun.test.js: tapping the asking row re-prompts (not the Log), dismissed -> row Cancelled, the next app goes
  to iOS, stays queued; openPrepared/repromptPrepared over a fake bridge.
- native/test_sideload.py: the InstallPrompt wiring (source checks; the phone half can't run here).
- Native build (jailbreak .deb + sideload IPA) compiles the new Swift.

## Not verified

- **On the phone.** The brief's phone check (2-app reinstall on the sideload build shows two prompts; dismissing one
  and tapping its row brings it back) was not done: the iPhone 7 runs the jailbreak .deb, where signing.* is refused,
  and putting the sideload IPA on it needs a signing certificate and the user's hands on the prompts (unattended run).
  The user's iPhone 15 Pro is where this should be tried, with the Log open: the new lines say whether iOS took the
  link, showed the prompt, and asked for the IPA.
- **That iOS's itms-services prompt makes the app inactive.** The prompt/answered detection relies on it (SpringBoard
  alerts do this as far as I know). If it doesn't, `dismissed` never fires and the old 600 s `ask` wait still ends the
  row, the 8 s "no prompt" re-open happens once (harmless while a prompt is up: iOS drops it), and the row tap still
  re-prompts.
- **The 20 s dismissal quiet.** If iOS takes longer than 20 s after Install to ask for the IPA (slow manifest fetch),
  the row would read Cancelled while iOS installs it anyway. Not measured.
- **That the dropped open was the user's actual cause.** No device log of their run; the new log lines are there to
  confirm it on the next run.
