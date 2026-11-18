# F132: a longer early-link window for website installs

R14 saw iOS's installer keep retrying a held `app.ipa` for at least 5 minutes, so the 110 s `EARLY_WINDOW` in
`web/app/signing-client.js` was too short: a sign/upload slower than that showed Ready to Install and opened a
second itms link while iOS was still waiting on the first.

## What I did
- `EARLY_WINDOW` is now 8 minutes (480 s). That's under the upload's TTL (600 s from the reservation made at the
  tap, `worker/src/index.js`), so the token is still there for iOS's retries. The comment says why.
- docs/signing.md: changed "110 s" to 8 minutes.
- New test in `signing-client-early.test.js`: no alert when the upload finishes at 111 s, 5 min or the window minus
  1 ms, and the alert at the window. The window must also be between 5 and 10 minutes. I checked that the test fails
  with the old 110 s value (1 failure) and passes with the new one.

## Decisions
- 8 min instead of the full 600 s TTL. That leaves 2 minutes for iOS's last retry, which can be held up to the
  Worker's 2-minute IPA_WAIT, to still find the upload before KV drops it.

## Not verified
- No retest on the iPhone 7 with a real sign/upload slower than 110 s. The task asked for the unit test only, and
  the phone is only for tasks that say so. R14's tail showed iOS still retrying at 5 minutes, but nobody has
  measured how long it really keeps trying beyond that, so the 5 to 8 minute range is unchecked.
