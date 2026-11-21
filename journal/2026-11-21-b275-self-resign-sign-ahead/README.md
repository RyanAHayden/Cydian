# B275: Re-sign of iFizBox from the queue

Installed > iFizBox > Modify > Re-sign failed at once with "iFizBox: Not an http(s) URL". The sideload app's queue
run (screens/apprun.js) signs ahead: signing.prepare {record: com.ryha.ifizbox}. SignAhead.prepare took the record's
url as the source and only knew My IPAs files and http(s) links; iFizBox's own record has url `self:bundle`
(SelfIPA.url, signed from its own bundle), so it answered bad_url.

## What changed

- `native/Sources/SignAhead.swift`: a record whose url is SelfIPA.url signs from the running bundle
  (SelfIPA.make into SignBridge.work, then the same signThat), as signing.resign already does, before the http(s)
  check. The hand-off was already right: the run page opens iFizBox's row with `host` (core/apprun.js isSelf), and
  signing.open with host or the This iPhone route installs it.
- `native/test_sign_ahead_self.py`: source test that the branch is there, before the http(s) check.

Chose teaching sign-ahead `self:bundle` over sending the row down queue.js's SELF_ID signing.resign path: the run
page (rows, Cancel, KeepAlive, This iPhone route) stays the same for every app, and the fix is one branch beside
the My IPAs one. queue.js needed no change.

## Not verified

- On the iPhone 15 Pro (Modify > Re-sign on iFizBox re-signs and relaunches): not tried from this unattended slot;
  it needs the new build installed on the phone and iFizBox replacing itself, which ends the running app. The
  native build in the gate compiles the change.
