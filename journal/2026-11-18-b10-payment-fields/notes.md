# B10: payment request fields

What R11 (docs/sileo-zebra.md) found: Sileo and Zebra send `udid` and `device` in every Payment Provider POST, and
the package's `architecture` in `authorize_download`; Cydian's `purchase` sent only `{token, payment_secret}` and its
`authorize_download` had no architecture.

## Done
- `web/app/core/payment.js`: `buildRequest("purchase")` now sends `{token, udid, device, payment_secret}` (udid/device
  left out when unknown, as everywhere else); `authorize_download` takes and sends `architecture` (left out when
  empty). The client's `purchase()` reuses `who()` (device + token) and adds the secret; `authorizeDownload()` takes
  `{ version, repo, architecture }`.
- `web/app/screens/extras.js`: Download & Install passes the stanza's `Architecture` (`st.architecture`), falling
  back to `getArch()` (the device's apt architecture) when a stanza has none.
- `web/app/core/payment.test.js`: request shape for purchase with udid/device, authorize_download with
  architecture, empty architecture left out; the fake-vendor test now checks both bodies end to end.

## Decisions
- `backend-native.js` is on the task's file list but needed no change: it makes no vendor calls; the payment
  client lives in `screens/extras.js` and sends through the shell's `net.request`. Left untouched.
- Zebra sends `token: "none"` and `payment_secret: null` when absent; Sileo leaves fields out. Kept Cydian's
  existing leave-it-out style (the spec marks them optional).
- `sign_out` still sends only `{token}` (unchanged; not in the brief).
- The "Cydian today" lines in docs/sileo-zebra.md (purchase without udid/device, no architecture) are now out of
  date; not edited because the file isn't on this task's line (merge safety).

## Not verified
- Against a real vendor (Chariz, Havoc): needs a modern jailbroken phone signed in to a vendor account, the same
  gap that blocks R10. Checked only against the fake vendor in payment.test.js.
- The UI path in extras.js (Download & Install) was not clicked: it only runs in the native shell; the change is
  one argument, reviewed by reading.
