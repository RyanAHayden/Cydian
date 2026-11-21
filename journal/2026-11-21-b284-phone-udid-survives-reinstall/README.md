# B284 Lite: This iPhone knows the phone's UDID after a delete + reinstall

R59 on the iPhone 15 Pro: after delete + reinstall the identity, profile and pairing came back from the Keychain,
but Signing > Certificate > This iPhone read Unknown until the kept pairing was used. `PhoneID` kept the UDID
lockdown gave (`ifizbox.phone.udid`) only in UserDefaults, which goes with the container.

## What I did

- `native/Sources/PhoneID.swift`: `remember` also writes the UDID to a generic-password item (service
  `com.ryha.ifizbox.phone`, account `udid`), `AfterFirstUnlockThisDeviceOnly`, in iFizBox's own group
  (`OwnKeychain.scoped`), the same shape as B276's signing items. Not a secret.
- `read()` (sideload build): UserDefaults first, and if the Keychain lacks it (paired before this build) it is
  written there; on a fresh container the kept item is read back into UserDefaults, before the embedded profile's
  guess. `source` then reads "lockdown" as before.
- `native/test_phone_keep.py`: source checks for the above.

## Decisions

- Keychain rather than learning it from the kept pairing at launch: reading it over lockdown needs the VPN/tunnel
  up and a network round trip at every launch, while the Keychain read is local and works offline. The pairing
  record itself does not hold the UDID.
- Remove Certificate does not delete it: the UDID belongs to the phone, not to the certificate, and UserDefaults'
  copy was never removed by it either.

## Not verified

- Delete + reinstall on the iPhone 15 Pro (the task's Check): not run in this unattended session. It means deleting
  the app on the owner's test phone (its container, signed records and probe files go too; R59 had to put them
  back by hand) and the 15 Pro may be in use by other slots. The gate builds the Swift and runs the source test. A
  device check is filed as a follow-up R task (see commit).
