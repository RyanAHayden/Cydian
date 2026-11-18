# R10: paid packages on a modern jailbroken iPhone (F57 device check)

> 2026-11-18: a device exists now: the iPhone 7 (`ssh 7`, iOS 15.8.8, palera1n rootless). How to use it, drive its
> screen (`tools/ui-7.sh`) and install Cydian on it: `docs/iphone7.md`. The "no device" notes below are from before.

## What happened

Unattended run, no person present. The check needs a modern jailbroken iPhone (iOS 15+, Dopamine or palera1n) and
a Havoc or Chariz account with money on it. Neither is reachable from this machine:

- `idevice_id -l` lists no USB device.
- `~/.ssh/config` has only `Host 4s`, the iPhone 4S on iOS 6. It cannot run the rootless iOS 15+ build and has no
  ASWebAuthenticationSession, Face ID or modern MobileGestalt, so it proves nothing for this task.
- There are no vendor credentials anywhere I could use, and buying a tweak spends the user's money, which an agent
  must not do unasked.

So nothing on the device was run. The task is blocked: it needs a person. Below is the checklist for that person,
taken from F57's code (`native/Sources/Paid.swift`, `native/entitlements.plist`, `native/helper/paid.c`) and
F57's own **Not verified** list (`journal/2026-11-17-f57-paid-shell/README.md`).

## Checklist for the person with the phone

Install the jailbreak build (not the sideload IPA: the entitlements below are only in the jailbreak build). Keep
`log stream --predicate 'process == "Cydian" OR process == "securityd"'` (or Console.app) running.

1. **Sign in**: add the Havoc (`https://havoc.app/`) or Chariz (`https://repo.chariz.com/`) source, open a paid
   package, tap Sign In. Expect the ASWebAuthenticationSession sheet, log in, and the sheet closes by itself on
   `sileo://authentication_success`; the package screen then shows signed in / the price button.
   If the sheet never closes: the callback scheme `sileo` isn't caught (Paid.swift auth.session).
2. **Keychain**: the first sign in stores the token/payment_secret (service `com.ryha.cydian.payment`). Expect a
   Face ID / passcode prompt on use. Watch the log for `-34018` (errSecMissingEntitlement): that means securityd
   rejects `keychain-access-groups = [com.ryha.cydian]` without a team ID; the fix would be a group with a team-ID
   style prefix or ldid's `*`-style group as other jailbreak apps ship.
3. **device.info**: the vendor gets the UDID. Check the Havoc/Chariz account page lists this device, or log the
   bridge reply. An empty/nil UDID means MobileGestalt refused `UniqueDeviceID` despite
   `com.apple.private.MobileGestalt.AllowedProtectedKeys`.
4. **Buy** a cheap tweak (under $1-2). Expect the vendor's payment page in the sheet and a return on
   `sileo://payment_completed`, then the button turns to Install.
5. **Download & Install**: expect the Running screen with `cydian-helper install-paid <path> <pkg> <version>`
   output, apt installs it, `dpkg -l <pkg>` on the phone shows `ii`, and the .deb copy is gone from the app cache
   and /var/tmp afterwards.

File a B task for each step that fails (`agent-runner plan add B "..." --files native/**`), with the log lines.

## Not verified

Everything in the task: sign in and the `sileo://authentication_success` return, the Face ID/passcode prompt and
whether `keychain-access-groups` is accepted (-34018), the UDID from MobileGestalt, buying, and install-paid as
root. Why: no modern jailbroken iPhone is connected or reachable (only the iOS 6 4S), no vendor account, and a
purchase needs a person's approval and money.
