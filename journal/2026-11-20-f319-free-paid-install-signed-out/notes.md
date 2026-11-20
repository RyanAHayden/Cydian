# F319: jailbreak app, free commercial tweak installs signed out

## What I did
- `screens/extras.js`: `freeSignedOut(info)` (available + purchased + price FREE) and `authorizeFree(client, id, ask,
  { signIn, alert, vendorName })`: `client.authorizeDownload(id, { ...ask, tokenless: true })` (core/payment.js, F318);
  any refusal shows an alert "Download & Install" with Cancel / Sign In, Sign In runs the Purchase group's sign-in
  (busy action: HUD, then the page drawn again); answers the URL or null.
- `paidNav` takes an optional `freeInstall`: signed out and `freeSignedOut`, it answers label Install, `install:
  freeInstall`, actions [Download & Install, Sign In to <vendor>] (Sign In kept so the user can still sign in). Without
  `freeInstall` it behaves as before (paidnav.test.js's "still needs Sign In" case is unchanged and passes).
- `drawApp` passes `freeInstall` = `downloadAndInstall(..., { free: { signIn, vendorName } })`; `downloadAndInstall`
  with `free` uses `authorizeFree` (the Authorizing HUD comes down before the alert) and returns quietly when there
  is no URL, else the same paid.install console run as before.
- Decision (unattended): the fallback is an alert offering Sign In rather than opening the vendor sheet unasked, so
  the user sees why the install didn't start.
- Tests: four F319 cases in `screens/extras.test.js`.

## Not verified
- On the iPhone 7 against Chariz betterAlarm: the task says nothing about touching the phone, and the tokenless
  authorize itself was checked live by F318 (2026-11-20). The UI path (row, nav bar sheet, alert, console) is
  unit-tested only through paidNav/authorizeFree, not drawn in a browser.
