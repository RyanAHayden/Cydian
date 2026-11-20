# B133: a spinner on every wait in This iPhone's setup

## What waited with nothing moving

Read through `screens/installroute.js` for every bridge call the user waits on:

| Step | Before | Now |
|---|---|---|
| Installation & Signing, status being read | Pairing "Not Paired", VPN "Unknown" | Pairing "Checking…" + grey spinner, VPN "Checking…" |
| Developer Mode being read | no row until it answered | row "Checking…" + spinner (goes if there's no answer) |
| Tailscale Sign In under way (both pages) | "Signing In…" row, still | same row + spinner |
| Connect With pick, Sign Out, Test Connection | nothing | HUD "Switching" / "Signing Out" / "Testing Connection" |
| Open LocalDevVPN / Tailscale / App Store | nothing | HUD "Opening …" |
| Pair page: VPN off, polling for it | footer only | a "Waiting for LocalDevVPN…" (or Tailscale, once signed in) spinner line |
| Pairing started, no code yet | "––– –––" | "Getting the Code…" spinner in the code's place |
| Code shown, iPhone connecting / pairing | plain footer line | the same line with the spinner (a failed try: plain, it waits on a tap) |
| Check Connection | nothing until the alert | HUD "Checking Connection", then the alert |
| Forget Pairing / Pair Again | the old page stayed up while it re-read | HUD "Forgetting Pairing", then the page draws Checking… |
| Import Pairing File | nothing | HUD "Importing", then Checking… |

- One-off actions use the existing HUD (`nav/hud.js`, the large white spinner with a label, as extras.js's
  `busyAction` labels: no ellipsis). `busy()` shows it only once the call has taken 250 ms
  (`hudHooks.delay`), so a quick reply doesn't flash it. The HUD's scrim also stops a second tap.
- Waits inside a page use the grey `loading-spinner` (packages.css): a row's `spin` (new `spinRows`, appended at the
  row's right end) or a group's `spinner` line. New `.loading.pair-wait` in settings.css lays the line out left-aligned
  in the footer's place inside a group with a header.
- `core/installroute.js` needed no change (`vpnWaitText` was already there).

## Checked

- `node --test` on the installroute tests: new `screens/installroute-busy.test.js` (HUD delay and hide, main page
  and Developer Mode spinners, the code/step spinners through a fake idevice.pair, Check Connection and Forget under
  the HUD and the Checking… redraw); three existing expectations updated for the new spinners.
- Chromium, fake sideload bridge with **every reply slowed 2.5 s** (`shot.mjs`; serve web/app with
  `python3 -m http.server`): each step printed what spun, and I looked at the shots:
  `1-main-status PairingChecking…`, `2-main-devmode Developer ModeChecking…`, `4-pair-checking Checking…`,
  `6-check-hud HUD Checking Connection`, `8-forget-hud HUD Forgetting Pairing`, `9-forget-rechecks Checking…`,
  `10-vpn-wait Waiting for LocalDevVPN…`, `11 Getting the Code… | Starting…`, `12 Starting…`,
  `13 Waiting for the iPhone to connect (port 49152).`
- Seen there and not part of this task: Settings rebuilds the whole Installation & Signing page when its other
  slow calls answer, so This iPhone's rows go back to Checking… a few times before they settle. Filed as B140 (low).

## Mistake

- One edit went through a `python3` heredoc (adding the hud import) before I switched to the Edit tool. The result
  is the one intended line.

## Not verified

- On a phone (iPhone 18 Pro, the user's): not reachable from this unattended run. The spinners and HUD are checked
  only in Chromium with the fake bridge.
- Tailscale's Sign In spinner and the Test Connection / Sign Out / Open … HUDs in Chromium: covered by the code
  paths and the shared `busy()` test, not shot one by one.
- Import Pairing File (older iOS): needs a file picker; not driven in Chromium.
