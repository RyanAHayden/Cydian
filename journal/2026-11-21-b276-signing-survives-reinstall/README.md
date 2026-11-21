# B276 Lite: the signing certificate survives deleting and reinstalling the app

R55 on the iPhone 15 Pro: after delete + reinstall, Signing showed Needs Setup although the identity was still in
the Keychain. `SignStore.identity()` picks the identity by its certificate's SHA-256 in UserDefaults (`certKey`),
and the profile is a file in Application Support; both go with the container.

## What I did

- `native/Sources/SignStore.swift`: the SHA-256 and the profile are also kept as two generic-password items
  (service `com.ryha.ifizbox.signing.setup`, accounts `cert` and `profile`), `AfterFirstUnlockThisDeviceOnly`, in
  iFizBox's own group (`OwnKeychain.scoped`), the same shape as B218's `TailscaleKeep`. Neither is a secret.
- `SignStore.restored` runs once per launch, before `identity()`, `profile()` and `exportP12()` first look:
  - fresh container: `certKey` comes back from the kept item, or from the F73 `.p12` item's `cert` field (so a phone
    that imported before this build, such as the 15 Pro, also comes back with its certificate); the profile file
    comes back from the kept item when it parses.
  - container that has them but no kept items (imported before this build): they are written to the Keychain, so
    the next reinstall keeps them.
- `importIdentity` writes both; `removeIdentity` (Remove Certificate) deletes both, so nothing comes back after it.
- `docs/signing.md`: the paragraph on what survives a reinstall and what Remove Certificate deletes.
- `native/test_sign_keep.py`: source checks for the above (restore before lookup, import keeps, remove deletes, own
  group, this device only).

## Decisions

- Kept a separate item rather than only reading the `.p12` item's `cert`: the `.p12` item is missing for identities
  imported before F73, and it holds no profile. The `.p12` fallback is still read, as it costs nothing.
- No change to `OwnKeychain.moveAll`: older builds never wrote these items, and new ones are written into our group.

## Not verified

- Delete + reinstall on the iPhone 15 Pro (the task's Check): not run in this unattended session. It needs a fresh
  container on the phone (deleting the app) and the imported identity on it; the 15 Pro's present Keychain state is
  unknown here, and deleting the app on the owner's test phone also drops anything else in its container. The
  gate builds the Swift and runs the source test only. A follow-up device check is filed (see commit).
- A reinstall signed by a different team: the Keychain items of the old team's group are not readable then, so it
  starts at Needs Setup as before (by design, not checked on a phone).
