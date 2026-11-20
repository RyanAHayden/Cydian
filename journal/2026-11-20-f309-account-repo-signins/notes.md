# F309: iFizBox Account carries repo sign-ins

## What changed

- `web/app/core/account.js`: a new payload field `repoLogins: { "<vendor base>": { token, at } }` (token `null` is
  a sign-out, kept so it travels). `mergeLogins()` merges per repo, last write wins against "seen" (which keeps
  `loginPrint(token)`, a fingerprint, never the token). A repo the account doesn't name (an older build wrote it)
  keeps what the device has. Left out while empty, so older payloads and summaries compare equal. `changesFor()` adds
  `adoptLogins` / `dropLogins` only when non-empty. `syncOnce()`'s "seen" counts a sign-in this device kept against
  the account's as seen (same trick as the certificate), so it doesn't write its own token back.
- `web/app/core/payment.js`: `createCredentialStore()` gains `logins()`, `adopt()`, `drop()`, `decline()`. Record is
  `{ token, synced?, declined? }`. A `synced` token (the account brought it) has no payment secret; `purchase()` with
  one declines it and throws an `invalidate` PaymentError ("Sign in again on this iPhone to buy"), so the screens
  (which already refresh on `invalidate`) show Sign In. A synced token answered 401/403, or any `invalidate`, is
  declined: load() reads signed out, but logins() still reports it, so the account doesn't see a sign-out and the
  other devices keep theirs; adopt() won't bring the same token back (no loop). A different token from the account
  (a new sign-in elsewhere) is adopted. A device that signed in itself keeps its own token (adopt refuses).
- `web/app/screens/account.js`: collectHere/applyHere read and write the store (this origin's localStorage, the
  same keys screens/extras.js and screens/tweaks.js use). Signed-out footer split per the hint-style concept item 6:
  Create Account ("Keeps your sources, settings and certificate … Repo sign-ins come too; payment details stay on
  each iPhone.") and Sign In With Key ("No email or password: …") in separate groups. Delete alert names repo sign-ins.
- `screens/why.js`: builds group line "One account keeps your sources, certificate and repo sign-ins." (tweaks group
  is at the test's 5-line cap). README and docs/account.md say it.
- `native/Sources/Paid.swift`: no change needed. The secret is already a Keychain item
  `WhenPasscodeSetThisDeviceOnly` / `.userPresence`, so it never leaves the device; only the token (in localStorage)
  is read by the account.

## Decisions (unattended)

- Invalidate on an own token now declines instead of forgetting. Forgetting would read as a sign-out at the next
  save and sign every other device out because one vendor answer on one device. Explicit Sign Out still forgets
  and travels.
- "Last write wins" is by sync time (like settings), not by sign-in time.
- A device's own sign-in beats an incoming token, so a UDID-tied token from another iPhone never replaces a working
  one; a sign-out from any device still removes it.

## Tests

`web/app/core/account-f309.test.js`: merge add, older payload reads as none, sign-out travels, LWW, token only in
the sealed payload (ciphertext has neither token nor repo host), no secret collected, store adopt/decline/drop,
synced token turned down (one vendor call, then Sign In), buy with a synced token asks for Sign In, and two devices
end to end through collectHere/applyHere against the real Worker code.

## Not verified

- On the IPA: sign in to Chariz, restore the account on a second install, Chariz shows as signed in. No phone test
  in this unattended run (no device task, and the iPhone 7 test path for an IPA needs a person for signing);
  covered only by the two-device node test.
- The website: it keeps and passes on the tokens (localStorage), but the site never calls vendors (no CORS), so it
  has no "signed in to Chariz" display to check.
- Whether Chariz/Havoc actually refuse a token from another UDID, and with which answer (`invalidate`, 401 or 403):
  not checked live (needs real accounts). Both are handled.
- The new footers were not looked at rendered (no screenshot pass); text only.
