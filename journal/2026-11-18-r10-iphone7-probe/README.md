# R10, second run (2026-11-18): what the iPhone 7 could check without root or an account

The checklist for a person is still in `journal/2026-11-17-r10-paid-device-check/README.md`. This run had the
test phone (`ssh 7`: iPhone9,1, iOS 15.8.8, palera1n rootless) but no sudo password and no Havoc/Chariz
sign-in, so Cydian itself could not be installed: `sudo -n true` says "a password is required", and installing
needs root (`dpkg -i`, `/var/jb/Applications` belongs to root). I didn't use Sileo's setuid helper to get
around the sudo password, because that would sidestep the user's access control. Nothing was bought.

What I could check runs as `mobile`. I built two small C probes on Linux with the same clang, SDK and ld64.lld
as `native/build.sh` (`probe.c`, `la.c` in this folder), copied them to `/var/mobile/r10`, signed them on the
phone with `ldid -S native/entitlements.plist` (the jailbreak build's entitlements), ran them, then deleted the folder.
securityd and MobileGestalt check a caller's entitlements the same way for an app or a CLI binary, so the
results carry over to Cydian. The UI parts (prompt, sheet) do not: those need the app.

## Findings

1. **device.info / UDID works.** `MGCopyAnswer("UniqueDeviceID")` returns the 40-hex UDID
   (`cb21a7f0…`). It does this even with `com.apple.private.MobileGestalt.AllowedProtectedKeys` removed
   (a `platform-application` binary on palera1n gets it anyway), so the entitlement does no harm but isn't what
   makes it work here. Paid.swift reads it the same way (dlopen + MGCopyAnswer).
2. **keychain-access-groups is accepted: no -34018.** SecItemAdd / CopyMatching / Delete of a generic password
   under service `com.ryha.cydian.payment` all return 0, both with `kSecAttrAccessGroup = com.ryha.cydian` and
   without it. Sileo ships the same kind of bare group with no team ID (`org.coolstar.Sileo`, from `ldid -e`), so the
   worry in the first run's step 2 doesn't apply. (`application-identifier = com.ryha.cydian` grants the same
   group by itself: a build without `keychain-access-groups` also passed.)
3. **This phone has no passcode, so it can't show the passcode/Touch ID prompt.**
   `LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)` = false, error -5 (passcodeNotSet). Biometrics:
   error -7 (not enrolled), biometryType 1 = Touch ID. On this phone, adding the item the passcode-protected way
   (`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` + `.userPresence`) fails with -25291 (errSecNotAvailable).
   That's the case `Keychain.set` already handles: when canEvaluatePolicy is false it stores the item
   `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` without an access control. The probe stored, read and removed
   an item exactly that way: 0/0/0. So on this phone payment secrets get stored, without a prompt, as designed. No bug.
4. **The vendors are live and answer GET `<endpoint>/info` in the spec's shape** (from the phone):
   `havoc.app/payment_endpoint` → `https://havoc.app/api/sileo/` (name Havoc, banner "Sign In"),
   `repo.chariz.com/payment_endpoint` → `https://chariz.com/api/sileo/` (name Chariz, banner "Log In").
   The phone already has both sources and their keyrings (`havoc-keyring`, `chariz-keyring`).

No bugs filed: nothing checked was broken.

## Tried and dropped

- First `clang -fuse-ld=lld` failed ("invalid linker name"): it needs `--ld-path=<ld64.lld>` as in build.sh.
- I first POSTed to `<endpoint>/info` and got "not found" (Havoc) and an HTML error page (Chariz). The spec and
  core/payment.js use GET for `info`. With GET both answer.

## Not verified

- **Sign In sheet and the `sileo://authentication_success` return.** Why: Cydian can't be installed without the
  sudo password, and there is no vendor account to sign in with.
- **The passcode/Touch ID prompt on keychain.get.** Why: the phone has no passcode and no Touch ID enrolled. To check
  it, set a passcode on the phone (if palera1n allows it on this setup) and repeat the first run's step 2.
- **device.info inside the app** (only the same call in a probe binary was checked) and that the vendor accepts
  the UDID. Why: no install, no account.
- **Buying a tweak, and Download & Install through `cydian-helper install-paid`.** Why: no account, buying needs
  the user's approval and money, and install-paid needs root.
