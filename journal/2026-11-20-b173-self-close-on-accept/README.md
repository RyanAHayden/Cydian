# B173: self-update over This iPhone (Tailscale) still hung at "iOS is installing it"

## What was reported

Updating 0.15.0 → 0.16.0 over the This iPhone route through Tailscale (the phone's own tailnet, no Signing Server)
hung at "iOS is installing it". The user had to swipe the app away, and then the install finished. 0.15.0 already
contained B159's self-close (`git merge-base --is-ancestor 9c52ab09 v0.15.0`), and its line "it closes once iOS has
the new one" was shown, so `isSelf` was true and HereClose existed. It just never closed the app.

## Why (worked out from the code; no device log of the run was available)

B159's close depended on a chain where any link can fail without leaving a trace:

1. **The rule waited for installd to stand still.** It closed only once installd's percentage had stopped moving
   for 5 s (or after 10 s with no percentage at all). The close never depended on installation_proxy's Complete, so
   the brief's first guess is wrong for 0.15.0. But a stream that keeps sending new percentages, or a tunnel that
   delivers statuses in bursts, kept pushing the close back.
2. **Everything ran on the main queue.** The clock, its timer, `hereReady` and the `exit(0)` all did. Anything that
   held the main queue (WKWebView, the Tailscale node's start and stop, `Tailscale.start()` is synchronous) or a
   suspended app delayed or swallowed the close.
3. **`hereReady` needed `state == .waiting`.** Any other state silently did nothing, but the call was still answered,
   so the page just waited.
4. **`exit(0)` only ran inside `UNUserNotificationCenter.add`'s completion handler.** If that handler never came,
   nothing exited.

There was also no log at any of these steps, so the user's run left no evidence of which one failed. The fix
removes all four.

## What changed

- `native/sign/SelfCloseClock.swift`: new rule. installd's **first status** (any percentage, 0% included) means it
  accepted the install. iFizBox closes `accepted` (1 s) later. Later percentages change nothing. If installd sends no
  status, it closes `firstQuiet` (10 s) after the copy ended. A `reason` string goes to the logs.
- `native/Sources/Sideload.swift`:
  - `HereClose` runs the clock and its timer on a serial queue of its own (`ifizbox.hereclose`), not the main queue.
    It logs the copy's end, installd accepting, a cancelled job that keeps the app open, and the reason it fires.
  - The fire block answers the install call, dispatches `CloseForUpdate.hereReady()` to main, and arms
    `CloseForUpdate.exitBackstop` (exit(0) from a global queue 4 s later, whatever the main queue is doing).
  - `hereReady` closes from any state except `finished`, and logs when the state wasn't `waiting`. `hereExit` went
    from 2.5 s to 2 s, so the app exits about 3 s after installd's first status.
  - `closeWith` (used by every route: This iPhone, and the Signing Server's `finish` and `guess`) logs and arms
    the backstop too, so the exit never depends on the notification's completion handler.
- `web/app/core/apprun.js`: `SELF_CLOSING = "Closing so iOS can finish"`. `SELF_RESTART` (still imported by
  signing-client.js) is now an alias for it. `selfClosing(row)` is true for iFizBox's own row on This iPhone once
  installd has it (state and phase "installing", any percentage). The row status and the run status say it from the
  first percentage, not only at 100%, and the log says it once. The single-install HUD (signing-client.js) shows the
  same text through the alias.

## Routes

- LocalDevVPN and Tailscale both go through `installHere` → HereClose, so both get the new rule.
- Signing Server (hosted, iOS's prompt): `CloseForUpdate.finish()` already closes once the server reports that iOS
  downloaded the whole IPA. The only change is the backstop in `closeWith`.

## Decisions (unattended)

- I close on installd's first status instead of trying to tell "installd waiting" apart from "installd working".
  The user's two reports (B159, B173) show installd finishes once the app is gone. On iOS 15 lockdown (the iPhone 7)
  installd ends the app anyway.
- A cancelled job still keeps the app open: Cancel is the user's explicit choice.
- `native/sign/**`, `native/sign/tests/**`, `native/test_selfupdate_here.py` and
  `web/app/install-here-progress.test.js` are outside the task's file list. The decision logic lives in
  `native/sign`, and those are its tests.
- `screens/apprun.js` didn't need a change. `followHere` already locks on "Closing iFizBox" once the call answers.

## Tests

- Swift (`native/test_sideload.py`, passed): the clock closes `accepted` after the first status, later percentages
  never push the close back, a 0% status counts, the silent-installd fallback applies, and `reason` is filled in.
- `native/test_selfupdate_here.py` (text): the fire answers the call before `hereReady`, the backstop is armed, it
  logs, HereClose never touches `DispatchQueue.main`, `hereReady` guards only on `.finished`, and `closeWith` arms a
  global-queue backstop.
- `web/app/install-here-progress.test.js`: the self row reads "Closing so iOS can finish" from installd's first
  percentage (not while copying), it is said once, and the `selfClosing` cases are covered.

## Not verified

- **On a phone.** I drove no phone. The bug is on iOS 17.4+ RemotePairing over Tailscale, the user's iPhone 15 is
  read-only, and the iPhone 7 (iOS 15, lockdown) never runs this branch of the close. Not confirmed:
  - that installd keeps installing when iFizBox exits about 3 s after its first status (it did after a swipe-away
    later in the install, per the user);
  - which of the four causes above actually stopped 0.15.0. There was no device log; the new `self-close:` lines in
    the install log (`IDevice.ilog`) will show it next time.
- The Swift in Sideload.swift compiles only in the gate's iOS native build. Check the gate output for "native build
  skipped".
- The staged IPA's removal (`afc_remove_path` after Complete) never runs for the self update now. installd normally
  deletes its staging copy itself. I did not check this on a phone.
