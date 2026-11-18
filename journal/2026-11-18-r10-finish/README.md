# R10, sixth run (2026-11-18): merged the fifth run, checked the helper's caller guard, closed R10

The fifth run's work (`journal/2026-11-18-r10-installed-check/`, B11-B13, D5) was on `wip/R10` and couldn't merge
only because `test_icons.py` failed on main (since fixed). I merged `wip/R10` into `task/R10` (no conflicts).

## What I checked on the phone

- `ssh 7`: jailbreak up, `sudo -n true` works, Cydian `0.3.8-791` installed (`ii`).
- **install-paid from outside the app is refused, even as root.** I put procursus's `sl` 5.06 .deb (6 KB, harmless)
  into `/var/mobile/Library/Caches/com.ryha.cydian/paid/` as `mobile`, then ran
  `sudo /var/jb/usr/libexec/cydian/cydian-helper install-paid <path> sl 5.06` (and with a wrong version, a wrong
  package name, and a path outside the paid folder). Every call: `the calling process isn't Cydian`, exit 77, nothing
  installed (`dpkg -l sl`: not found), nothing left in `/var/tmp`. That's `helper_caller_ok` (policy.c): the parent
  must be Cydian's own executable. So the helper's guard works on the device. It also means install-paid's copy,
  control check and apt run can only be tested from inside the app, through a real vendor download.
- I deleted the test files and the `paid/` folder I made. The phone is as I found it.

I did not try to get around the caller check (e.g. faking the parent): that's the guard under test.

## What's left, and why R10 is closed anyway

Everything an agent can do without the user's Havoc/Chariz login is done, across the probe, installed-check and
this run. The rest needs the user signed in on the phone, so I filed it as **R15** (later, for a person to
schedule) instead of blocking R10 for a sixth time: sign in (sheet closes on `sileo://authentication_success`,
`keychain.set`), Download & Install of Chariz's free betterAlarm (install-paid end to end, no purchase), and the
passcode prompt once a passcode is set.

## Not verified

- Finishing sign-in, the `sileo://authentication_success` return and `keychain.set`. Why: no vendor account (R15).
- install-paid's copy / control check / apt install on the device. Why: the helper only accepts Cydian as its
  caller, and the app only calls it after a vendor download, which needs a signed-in account (R15). The host
  tests (`native/helper/test_helper.py`) cover that code.
- The passcode/Touch ID prompt. Why: the phone has no passcode.
- Buying a tweak. Why: needs the user's money and OK. betterAlarm (free) covers install-paid without buying.
