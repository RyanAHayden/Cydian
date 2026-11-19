# R25 Signing that keeps the app's own bundle ID (for push): blocked on the push profile

The idea: keep the app's real ID in Info.plist (`com.google.ios.youtube`). Make only the entitlements'
`application-identifier` the profile's (`TEAM.<explicit App ID with Push>`, Ad Hoc so `aps-environment` is
`production`). If iOS registers push under the Info.plist ID, the app's own server's notifications should arrive.

## Verdict so far

**Likely to install, push not proven.** iOS's installer never compares `application-identifier` with
`CFBundleIdentifier`, and containers are keyed by the Info.plist ID. Whether push works still needs the hand test
with a real Ad Hoc profile that has Push, and no such profile exists here (see "For the user" below).

| # | Question | Answer | How sure |
|---|---|---|---|
| 1 | YouMod signed this way installs and gets YouTube pushes | Installs: likely. Push: not tested | Install: installd strings plus the iPhone 7 with AppSync. Push: no profile |
| 2 | A second app with the same profile installs beside it | Yes. installd has no uniqueness check on `application-identifier`; A and B installed side by side on the 7. **But** they share the default keychain group (`TEAM.<App ID>`), so their keychain items mix: two Google apps would read and overwrite each other's sign-in. One explicit App ID per app is the safe rule | installd strings, 7 test E2 |
| 3 | The App Store app of the same ID is installed | **Refused**, not replaced: installd's `Upgrade's application-identifier entitlement string (%@) does not match installed application's application-identifier string (%@); rejecting upgrade.` (`MismatchedApplicationIdentifierEntitlement`), unless the new one is in Apple's `previous-application-identifiers`. The user has to delete the App Store app first, which deletes its data (the data container is keyed by the bundle ID) | installd strings only. On the 7 the check is skipped (see E3) |
| 4 | `com.ryha.*` wildcard profile, ID kept in Info.plist, `application-identifier` `TEAM.com.ryha.<last>` | Should install: the profile allows `TEAM.com.ryha.*`, and installd doesn't look at the Info.plist ID. No push (a wildcard App ID can't have it) | installd strings; the profile on disk is exactly this kind |
| 5 | Extensions | Keep them, with their own Info.plist IDs (`com.google.ios.youtube.<ext>`): installd requires each appex ID to be prefixed by the parent's Info.plist ID (`AppexBundleIDNotPrefixed`), and keeping the real IDs satisfies that. An explicit App ID profile allows exactly one `application-identifier`, so every extension gets the **same** one as the app. PluginKit keys plugins by Info.plist ID, so that should not clash. Keep the Notification Service extension: YouTube's rich pushes need it | installd strings; not tried |

### The exact entitlements (case 1, explicit App ID with Push, Ad Hoc)

For every Mach-O (app and each extension), with `TEAM` the profile's team and `com.ryha.youtube` the explicit App ID:

```xml
<key>application-identifier</key><string>TEAM.com.ryha.youtube</string>
<key>com.apple.developer.team-identifier</key><string>TEAM</string>
<key>keychain-access-groups</key><array><string>TEAM.com.ryha.youtube</string></array>
<key>aps-environment</key><string>production</string>
<key>get-task-allow</key><false/>
```

Plus whatever else the profile grants and the app asks for (App Groups only if the profile has them).
Info.plist `CFBundleIdentifier` is untouched (`com.google.ios.youtube`, and the extensions' own IDs), and so is
the code signature's Identifier, which must equal the Info.plist ID: installd checks
`Code signing identifier (%@) does not match bundle identifier (%@)`. zsign already does this when run **without**
`-b`, since it takes the identifier from Info.plist.

Case 4 (wildcard) is the same, without `aps-environment`, with `application-identifier` and the keychain group
`TEAM.com.ryha.youtube` (the profile's prefix plus the ID's last part, as `targetBundleId` does today).

### What the follow-up feature has to change

`web/app/core/websign.js`: `appEntitlements(profile, bundleId)` is already called with the *target* ID. Keeping the
ID means calling it with `targetBundleId(profile.appId, bundleId)`, but not passing that ID to zsign's `-b`. Then
Info.plist and the code identifier stay the app's own, and the entitlements carry the profile's ID. zsign (pinned
commit 9299685) writes the profile's `Entitlements` verbatim when it gets no `-e` file, so the entitlements file
has to be passed every time, as it is now. The native signer needs the same split (not read in this task).

## What I did

1. Found what signing material is on this machine: `~/sync/default/signing/`. It holds an Ad Hoc profile "sidedrop
   adhoc", `S8NFX3A2LT.com.ryha.*` (Ian Smith's team), **no** `aps-environment`, 2 devices of the
   `0000xxxx-` kind, so not the iPhone 7. It also holds the distribution `.p12` and an App Store Connect API key.
   It belongs to the user's other project (sidedrop), and AGENTS.md says not to depend on another project's
   signing. I only read the profile's plist to see what exists, and signed nothing with it.
2. Read the strings of the iPhone 7's own `/usr/libexec/installd`, `apsd` and `SpringBoard` (iOS 15.8.8, copied to
   the scratchpad, not committed) for every check that touches `application-identifier`, the bundle ID or extension
   IDs. The quotes in the table come from there.
3. Hand test on the iPhone 7 (AppSync Unified, so signatures are fakesigned with `ldid` and not checked against a
   profile). `tools/r25inst.c` asks installd through the same SPI as `native/helper/ipa.c` and prints installd's
   error. `tools/mkapp.sh` makes a Tiny app with a chosen Info.plist ID, `application-identifier` and code
   identifier. `tools/build.sh` builds and copies it.
   - E1: Info.plist `com.ryha.r25a`, `application-identifier` `S8NFX3A2LT.com.ryha.r25shared`: **installed**. Its
     data container's `MCMMetadataIdentifier` is `com.ryha.r25a`, the Info.plist ID.
   - E2: a second app, `com.ryha.r25b`, with the same `application-identifier` and keychain group: **installed
     beside it**.
   - E3: an upgrade of `com.ryha.r25a` with `application-identifier` `…r25other`: **accepted**. This is
     inconclusive: installd has `Skipping application-identifier check because both existing app and app being
     installed are not validated by a profile`, which is the fakesigned case. On a stock phone with real profiles,
     or with an App Store app installed, the check runs.
   - E4: code identifier `com.ryha.r25cdother` ≠ Info.plist `com.ryha.r25c`: **accepted** too. Under AppSync,
     installd's signing-info checks don't fire, so the 7 can only show what installd does outside code signing.
   - Removed all three with `r25inst uninstall`. No `Tiny.app` is left in `/var/containers/Bundle/Application`.

## Tried and failed

- `uninstallApplication:withOptions:error:` doesn't exist on iOS 15 (unrecognized selector, the tool crashed and
  uninstalled nothing). `uninstallApplication:withOptions:` (what `ipa.c` uses) worked.
- No way to read installd's log on the 7 (no `oslog`/`log` tool installed), so I couldn't confirm that E3 went
  through the "skipping" path. I didn't install a log package for it.

## For the user (what unblocks R25)

1. **An Ad Hoc profile with Push**: an explicit App ID (e.g. `com.ryha.youtube`) with the Push Notifications
   capability, an Ad Hoc profile for it with the test phone's UDID, and the matching distribution certificate.
   The only profile here is the `com.ryha.*` wildcard (no push, iPhone 7 not on it). The App Store Connect API key in
   `~/sync/default/signing/other/` could create the App ID and profile, but that changes Ian's developer account
   (App IDs, a device slot) and belongs to sidedrop, so I left it alone. Say if an agent may use it.
2. **Which phone.** The iPhone 7 runs AppSync, so it can't show iOS's profile and upgrade checks (E3, E4). It
   could still show push if its UDID is on the profile. The App Store-app question (3) and a real install check
   need a stock phone, i.e. yours. The brief says only if you say so.
3. A YouMod (or decrypted YouTube) IPA to sign, and a Google account signed in on the test phone, to get a real
   YouTube push.

## Not verified

- **Push arriving at all** (the point of the idea): no Ad Hoc profile with Push, and no YouTube IPA or Google
  account on a test phone. Hypothesis: the topic is the Info.plist ID, because UIKit/SpringBoard register the app
  by its bundle ID. TrollStore installs keep the real ID and reportedly get pushes. Both are unchecked; the
  registration code is in the dyld shared cache, which I didn't dig into.
- **Install on a stock phone with a real profile** (1 and 4): only installd's strings plus the AppSync phone,
  where amfid/MIS profile validation is bypassed.
- **(3), App Store app present:** strings only. On the 7 the check is skipped for fakesigned apps (E3).
- **(5), extensions under the main app's `application-identifier`:** not tried. The Tiny test app has none.
- **Keychain sharing between two apps on one App ID (2):** inferred from the shared default keychain group, not
  observed.
- The phone's `/tmp/r25`, `/tmp/r25inst`, `/tmp/r25inst-ent.plist`, `/tmp/r25-Tiny`, `/tmp/r25-mkapp.sh` are
  left there (the rules allow deleting only inside the worktree). They're harmless and go at the next reboot.
