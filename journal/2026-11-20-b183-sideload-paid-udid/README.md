# B183: Sideload IPA, paid packages show no price and Purchase fails on the UDID

## Cause

`device.info` (native/Sources/Paid.swift) only asked MobileGestalt for `UniqueDeviceID`. The sideload build has no
`com.apple.private.MobileGestalt.AllowedProtectedKeys` entitlement, so it always failed. core/payment.js calls
`device()` before every vendor request, `package_info` included, so the price lookup threw and the button kept
"Install" with no price.

## What changed

- `Paid.deviceUDID()`: MobileGestalt first, then `PhoneID.udid` (lockdown pairing's UDID, the website's Profile
  Service UDID, or the embedded profile's single device; in the jailbreak build the helper's). `device.info` uses it
  and only fails when neither has one. Its sideload error now says to pair this iPhone (Settings > Installation &
  Signing > This iPhone > Pairing), not "MobileGestalt refused". No recursion: PhoneID's jailbreak fallback calls
  `Paid.udid()` (MobileGestalt), not `deviceUDID()`. PhoneID.swift needed no change.
- core/payment.js: `packageInfo` asks the vendor even when `device()` fails (udid and device are optional in the spec
  for package_info) and then returns `deviceError` with the shell's message. Sign In, Buy and Download still need the
  UDID and still fail with that message in the Purchase alert.
- screens/extras.js drawApp: when `deviceError` is set, the Purchase footer adds it ("This iPhone's UDID isn't known:
  pair this iPhone …"), so the missing UDID is said, not silent.
- native/fake/fake-native.mjs: `phoneUdid` option models PhoneID's fallback in device.info; sideload-mode message
  matches the Swift one.
- Tests (web/app/backend-native-paid.test.js): the fallback UDID goes to the vendor for the price and for the
  sign-in URL; with no UDID at all the price still shows, `deviceError` says why, and sign-in refuses with the pair
  message.

Edits to payment.js and fake-native.mjs went through a small python replace script in the scratchpad (one-off; the
file-edit tool is the rule).

## Not verified

- On the sideload IPA on a phone: Chariz betterAlarm showing its price/FREE on the button and Purchase opening
  sign-in. Unattended run; the only sideload phone is the user's daily 18 Pro and the iPhone 7 runs the jailbreak
  build. Needs a hand check on the next sideload install.
- That Chariz accepts a lockdown/profile UDID the same as MobileGestalt's (it is the same value on a real phone, but
  the profile's single device is only this phone's when the profile holds just it).
- The Swift compiles only through the gate's native build (`make -C native package`), no separate run here.
