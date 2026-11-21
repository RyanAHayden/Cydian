# B243: Match Theme back on left the Home Screen on the Clear icon

Seen once on the iPhone 15 Pro (0.18.0, Lite) during B238: Light icon = Clear with Match Theme off, then Match
Theme back on; the Home Screen kept the Clear pair and iOS showed no "You have changed the icon" alert.

## Reading the code

The page's side is right for that sequence: turning Match Theme on fires `settings.onChange` → `applyTheme` →
`tellIcon(theme)`, the params change from `{clear, gunmetal, clear}` to `{classic, gunmetal, classic}`, so app.icon
goes out, and the shell's `setName` gives nil (the primary), which `apply` hands to `setAlternateIconName(nil)`
unless `alternateIconName` is already nil. No alert means that call never ran or iOS refused it. Two gaps fit:

- **The shell ran switches side by side.** A second app.icon that came while the last switch was still going (in
  the sideload build its completion waits for the alert) called `setAlternateIconName` again, and iOS refuses a
  call that comes while one is still in progress.
- **The page gave up after a refusal.** `tellIcon` only cleared `lastSent` on an error: nothing was sent again until
  the next theme or icon change, so a refused switch stayed refused.

## What changed

- `native/Sources/AppIcon.swift`: `switchTo` runs one switch at a time; a call that comes during one waits, only
  the latest waiting one runs, and the one it replaces answers unchanged. A 15 s guard frees the line if a
  completion never comes. Both app.icon paths (theme icons and own icons) use it.
- `web/app/appicon.js`: a reply of `failed: …` (iOS refused the switch) is sent again after 1 s, 3 s and 10 s; a
  newer change cancels the wait (it sends its own), and a stale reply no longer clears `lastSent` for a newer send.
  Other refusals (an older shell's unknown method, bad_params, resign_needed, missing) aren't retried.
- `web/app/appicon.test.js`: the B243 sequence with a shell that refuses twice, a newer change during a retry, and
  a non-iOS refusal.

`web/app/screens/settings.js` needed no change: its path to `tellIcon` was already right.

## Spec review

- Fixed: the retry never fired on a device. `native/bridge.js` `withCode` turns the shell's `failed: <text>` into
  an Error with `code` "failed" and message `<text>`, and the first `retryable` checked only the message. It now
  checks `code`, and the test's mock rejects the way the bridge does.
- Fixed: `whenActive` dropped a call that a later one replaced (app in the background) without answering it, so
  its promise never settled. A replaced call now answers unchanged.
- The guard that frees the switch line is now 60 s (15 s could free it while iOS's alert is still up; the page's
  retry covers what still goes wrong).
- Left as is: a replaced queued switch answers unchanged rather than with an error. The page already ignores a
  reply once a newer app.icon went out.

## Tried

- The iPhone 15 rig, to reproduce and then check the fix: `tools/ui-15.sh lock B243` answered "locked by B246"
  both times I tried, so no phone run.

## Not verified

- **No reproduction on a phone.** The rig was held by B246 for this whole session. Which of the two gaps caused
  the one sighting (or something else, such as iOS skipping the call) is inferred from the code, not seen. To
  check: on the 15 with this build, Theme > App Icon: Match Theme off, Light = Clear, dismiss the alert, Match
  Theme on: the alert comes and the Home Screen shows Classic/Gunmetal; then flip Match Theme twice quickly: the
  icon ends on the last state.
- The Swift change is checked by the gate's builds only, not run on a device.
- The jailbreak build's quiet switch (iPhone 7) with the queue: not run.
