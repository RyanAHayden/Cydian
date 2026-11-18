# B12: cancelling the vendor sign-in sheet is silent

## What I did
- `web/app/screens/extras.js`: drawApp's `busy` is now `busyAction(label, job, { hud, fail, refresh })` (exported).
  A job that returns the new `CANCELLED` symbol only takes the HUD down: no alert and no redraw, because nothing
  changed. Sign In is now `vendorSignIn(client, call = shell)` (exported). When `auth.session` replies null or
  undefined (Paid.swift replies `nil` on `ASWebAuthenticationSessionError.canceledLogin`), it returns CANCELLED
  without asking finishSignIn. A non-null callback that finishSignIn rejects still throws, so the Purchase alert
  still shows. Its message changed to "The vendor sent nothing back that Cydian could read.", because a cancel
  no longer gets there.
- `web/app/screens/extras.test.js` (new): covers cancel (HUD on and off, no alert, no refresh, finishSignIn not
  called), an unreadable callback (alert) and a good sign-in (refresh).

## Decisions
- No redraw on cancel: the page is already right, and a redraw would just repeat the vendor calls.
- I left the Buy row's `auth.session` (status "action") alone. A cancel there already makes no alert (the reply
  is ignored), and it is outside B12's scope.

## Not verified
- On the iPhone 7 with Havoc/Chariz: B12 does not ask for the phone, and its screen goes through ui-7.sh under
  a lock that other tasks use. The fix depends on Paid.swift replying null on cancel. Paid.swift:253 does that,
  and the R10 journal saw that reply.
