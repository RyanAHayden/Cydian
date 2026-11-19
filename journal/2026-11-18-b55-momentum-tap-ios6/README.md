# B55 Tap during momentum: back to iOS 6 (remove F153)

User 2026-11-18 (replaces B53): a tap while a list coasts only stops it, as on iOS 6; the next tap opens.

## What I did

- Deleted `native/Sources/MomentumTap.swift` and its `MomentumTap.attach(to: w)` line in `native/Sources/App.swift`.
  `native/build.sh` compiles `Sources/*.swift` by glob, so there is no build list to edit.
- Deleted `web/app/nav/momentum-tap.js` and `web/app/nav/momentum-tap.test.js`.
- `web/app/app.js`: removed the import, the `initMomentumTap()` call, and the `heldTap()` exception in the
  capture-phase scroll listener (back to its pre-F153 form: any scroll lets go of a pressed row; the `lastPress = null`
  added since F153 is kept).
- No new guard, per the brief: WebKit gets no event for a tap during deceleration (B53, F153 journals), so the
  stopping tap never reaches the page and cannot open anything.
- `grep -rni "momentum-tap\|MomentumTap\|heldTap"` outside `journal/` and `plan/` finds nothing. (Old journals and
  `plan/DONE.md` keep their history mentions on purpose.)

## Device check (iPhone 7)

Built `native/build.sh deb` (0.9.7-1406), installed with `apt-get install` on the 7. The running iFizBox process
started after the install, so the test ran on the new build. Under the `tools/ui-7.sh` lock, on the Installed tab
(scrolled to the top with a status bar tap, F167, before each run), I used the same flick every time
(`swipe 375 1050 375 450 0.08`). Screenshots are in `ref/7/screens/b55-*.png` (not committed, ref/ is gitignored).

- Control, no tap: the list coasts to the libedit0/libffi8 rows (L).
- Flick, then `tap 300 700` straight after: the list stops early (file-cmds in run 1, findutils in run 2) and **nothing
  opens**. So the tap landed mid-coast and only stopped the list.
- Second `tap 300 700` on the stopped list: the row under it opens (havoc-keyring). An earlier tap on a list that had
  stopped opened libkrw0 the same way.

So the app is back to the iOS 6 behaviour.

## What failed

Nothing. (My `ln -s .../ref ref` from the AGENTS.md recipe reported "File exists": the worktree already had the link.)

## Not verified

- On iOS versions other than 15.8.8 (the 7 is the only modern test phone).
- Taps at other speeds: phonectl taps are quick (well under 300 ms). A slow press during a coast was not tried, but it
  is the same: WebKit gets no touch while the scroll view decelerates, with or without F153's code.
