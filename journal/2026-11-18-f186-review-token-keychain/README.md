# F186: review token in the Keychain

- `native/Sources/Account.swift`: new `ReviewToken` (`reviews.token.get` -> token | null, `reviews.token.set {token}`),
  Keychain generic password, service `com.ryha.cydian.reviews`, account `token`,
  `AfterFirstUnlockThisDeviceOnly` like the account key. `set` checks the token is the shape the Worker takes
  (32-128 of `[A-Za-z0-9_-]`, as `core/reviews.js` TOKEN) and replaces any old one.
- Registered from `AccountKey.register`, so `Bridge.swift` (not this task's file) is untouched.
- `web/app/core/reviews.js deviceToken` already calls both and falls back to localStorage; no JS change.
  It reads `v` as a string or `v.token`; get returns the bare string.

## Not verified
- On a phone: the handlers compile in the gate's native build, but nobody ran them on the iPhone 7 (task didn't
  say to touch it). The claim "a reinstall keeps the same review" rests on iOS keeping Keychain items across an
  app delete, which it does today for generic passwords; untested here.
