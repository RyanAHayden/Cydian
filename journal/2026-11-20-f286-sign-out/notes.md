# F286: Sign Out on Settings > Account

## What changed
- `core/account.js`: `acct.signOut()`. Inside the controller's serial queue it writes unsaved changes the way
  `save()` decides (pending, never synced, or changed since `seen`). Any failure (offline, account deleted elsewhere,
  a 409 that would not settle) is swallowed. Then the key is removed and the sync state cleared. No server delete call. It returns whether
  it wrote. It doesn't call `save()`/`forget()`, because calling `serial()` from inside `serial()` would deadlock.
- `screens/account.js`: a "Sign Out" button above Delete Account, the action sheet's plain silver `.action-button`
  (not `.destructive`). `SIGN_OUT_ALERT` (exported for the test): "Sign Out?", "This iPhone stops syncing with your
  ${NAME} Account. What's on it stays. To sign in again you need your account key." Buttons are Cancel | Sign Out.
  `signOutFlow(el, {acct, ask, hud, draw})` shows the "Signing Out" HUD, hides the key again and redraws the page,
  which then shows Create Account / Sign In With Key.
- `account.css`: `.account-signout-wrap` (padding 10px 10px 0) stacks it over the delete wrap.
- Tests (`screens/account.test.js`): sign out writes the pending change, ends with key.remove, never calls remove, leaves
  the account on the server and clears the state. With nothing changed it only removes the key. Offline, it still signs out.
  The alert's wording and the flow's Cancel / Sign Out paths are also covered.

Choice: the message says "This iPhone" like the other alerts on this page, even on the website. This matches
ACCOUNT_FOOTER's wording.

## Not verified
- I didn't render it in a browser or check a 3x zoomed render. The button reuses the existing `.action-button` with no changes, and the
  layout copies the Delete Account wrap. A quick look at Settings > Account while signed in, in light and dark, would confirm the gap
  between the two buttons.
- I didn't test it on a phone (the task didn't ask for one).
