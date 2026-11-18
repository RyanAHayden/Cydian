# F73: signing.export for Cydian's own update

## What I did
- `native/Sources/SignStore.swift`: `signing.import` now also keeps the `.p12` as picked and its password as one
  Keychain generic-password item (service `com.ryha.cydian.signing.p12`, account `identity`,
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). The value is a binary plist `{p12, password, cert}`, where
  `cert` is the certificate's SHA-256. `exportP12()` hands the item out only while that hash matches the identity in
  use (`certKey`), so an old item can never go out with a different certificate. `removeIdentity()` (signing.remove,
  and the start of every import) deletes the item.
- `native/Sources/SignBridge.swift`: `signing.export` -> `{p12, profile, password}` (base64), or `null` when there's
  no readable identity, no profile file, or no kept item. I picked `null` over an error because
  `essential-ui.js exportIdentity` already treats a missing p12 as "fall back to cydian.dev", and a certificate
  imported before F73 isn't really an error. The user re-imports it to get server signing.
- No extra prompt on the native side: F72's `installSelf` already asks the user (and says the key goes to the
  server) before it calls `exportIdentity`.
- `docs/signing.md`: the import step says the `.p12` and password are kept; a new section, "What leaves the phone,
  and when (F73)"; and a note under Tests.
- `native/test_sign.py`: `BridgeSourceTest` reads the sources. It checks that the handler is registered and answers
  the three fields from `exportP12()`/`NSNull()`, that the item is `...ThisDeviceOnly`, that import writes it and
  that remove deletes it.

## Tried and failed
- Nothing failed. When run with the system python3, `test_sign.SignTest` skips because `cryptography` is missing.
  The gate runs it from `.venv`.

## Not verified
- On the iPhone: importing a certificate, then Essential Only signing on cydian.dev and installing. There's no
  device in this unattended run. Someone needs to run it by hand on a sideload build: import a .p12 again, then
  Changes > Cydian or Essential Only, accept the prompt, and Cydian should be reinstalled from the server.
- Keychain behaviour (SecItemAdd/CopyMatching for the generic-password item) runs only on iOS. On Linux the Swift
  is only compiled by the gate's native build, when the iOS toolchain is there.
