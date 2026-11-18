# B38: `ui-7.sh open ifizbox://<tab>` with iFizBox not running

B31 saw `tools/ui-7.sh open ifizbox://…` show the launch zoom and drop back to the Home Screen twice, with iFizBox
not running. The question: does the app die on a cold URL launch, or are ui-7.sh/uiopen at fault?

## Findings (iPhone 7, iOS 15.8.8, 0.9.4-1239 and a fresh 0.9.4-1250 from this branch)

- **No iFizBox crash log.** `/var/mobile/Library/Logs/CrashReporter` has none for the app (only iFizBoxWidget `.ips`
  files, the widget extension: not this task). An app crash or a watchdog kill at launch would have left one.
- **Could not reproduce it.** I ran 7 cold `uiopen ifizbox://<tab>` launches, and each opened iFizBox on that tab
  (screenshots `ref/7/screens/b38-*.png`):
  1. after `kill` (SIGTERM), 2 s pause (`b38-after`, Sources)
  2. after `kill -9` (`b38-kill9`, Changes)
  3. right after `apt-get install --reinstall` of the same build (`b38-reinstall`)
  4. `kill`, then `uiopen` with no pause (`b38-fast`)
  5. the first launch of a new build, 0.9.4-1250, just installed with apt (`b38-newbuild`, Installed)
  6. with the screen locked by the side button (`b38-locked`)
  7. after quitting it from the app switcher (double Home, swipe the card up) (`b38-afterswipe`)
- R16a saw the same thing with Sileo (`journal/2026-11-18-r16a-repo-phone-checks/notes.md`: "from the home screen
  the first open did nothing"). So it isn't iFizBox's code. SpringBoard now and then drops a launch that uiopen
  asks for, and the app never runs.

Conclusion: the app doesn't die. Nothing in `native/Sources` changed (the cold path, `SceneDelegate.willConnectTo` →
`Incoming.receive`, works in every case above).

## Fix

`tools/ui-7.sh open` with an `ifizbox:` URL now checks, 3 s after uiopen, that
`UIKitApplication:<BRAND_BUNDLE_ID>[…]` is in `launchctl list`. If it isn't, it says so on stderr and opens the link
once more. If the app still isn't running 3 s later, `open` exits 1 with a message, so a test notices instead of
taking a Home Screen screenshot. Other URLs (sileo://, https://) are opened as before, without the check.

Checked: cold `open ifizbox://installed` (4 s, no retry needed), and warm `open ifizbox://sources`
(`b38-final`). I checked the retry and failure branch by running the same remote snippet with a bundle ID that never
runs: it printed "opening again" and failed. I checked the match with the real ID against the running app.

The phone is left on 0.9.4-1250 (built from this branch at main 34dbc4b; no app code changed).

## Not verified

- **The retry when SpringBoard really drops a launch:** I couldn't make the drop happen again (7 tries above). The
  retry branch was only run with a made-up bundle ID, not after a real dropped launch.
- **What SpringBoard did in B31's two misses:** `log` on the phone is zsh's builtin (no oslog CLI is installed), so I
  couldn't read SpringBoard's or runningboardd's log for B31's time.
