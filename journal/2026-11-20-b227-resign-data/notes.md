# B227: re-signed apps must never lose data

User report: RyukGram went back to the sign-in screen with its saved config gone, no crash. Later: it happens at
random times, not right after a re-sign; YouMod (YouTube), signed the same way, never lost anything.

## The probe

`tools/resignprobe/`: `probe.m` (a tiny UIKit app, bundle ID `<brand>.probe`, never iFizBox's), `build.sh` (clang +
the iOS SDK; its "original" signature, made ad hoc with zsign, asks for another team's keychain group
`ABCDE12345.<id>` and app group `group.com.ryha.probe.original`, the way a store app does), `sign-web.mjs` (the
website's signer exactly: `websign-job.js runSignJob` with the WebAssembly zsign and the committed group fix, in
Node), `run.sh` (sign, install over the copy on the 15 Pro, launch with go-ios, pull `Documents/probe-log.jsonl`).
The native signer runs as `signbench-linux` (`native/sign/bench`, the same Swift sources as the app's signer); the
bench now signs for real on Linux when given `SIGNBENCH_KEY_PEM` (openssl), `SIGNBENCH_CHAIN` and
`SIGNBENCH_GROUPFIX`.

The probe writes a marker ("<time> by <bundle ID> as <application-identifier>") to: Documents, NSUserDefaults,
the original group's container and suite, the first real app group, and four keychain items (no access group;
AfterFirstUnlock; the original team's group; `<prefix of its own items' group>.<bundle ID>`, the bundle-seed-ID
lookup most keychain wrappers do). Each launch says per store: kept, NEW (lost and written again), OTHER (another
app wrote it: shared) or FAIL, and lists every keychain item it can see. Green screen = all kept.

Identities (all list the 15 Pro): A = SideDrop's certificate + SideDrop's profile (explicit `com.ryha.sideload`,
groups `.1`-`.5`); A2 = same certificate, the other profile for the same App ID (a profile made again); B = the
other distribution certificate of team S8NFX3A2LT + a profile for the same App ID made for this test through the
ASC API ("ifizbox B227 probe certB"); BW = certificate B + the old wildcard `com.ryha.*` profile (another App ID);
X = the Arctic profile (team STW4VDB85Z). "SideDrop" signer = what SideDrop's `sign_ipa` does (native zsign,
`keychain-access-groups = [application-identifier]`, no group fix).

## Matrix (iPhone 15 Pro, iOS 27)

Before = main's signers (B211), after = this branch. Every row is a re-sign installed over the previous one.

| Change | Data folder | Prefs | Orig. group folder | Orig. group suite | Keychain (plain, AFU) | Keychain, original group | Keychain, `<seed>.<id>` |
|---|---|---|---|---|---|---|---|
| same cert + profile (web, native) | kept | kept | kept | kept | kept | kept | kept |
| profile made again, same App ID (native A2) | kept | kept | kept | kept | kept | kept | kept |
| new cert, same team + App ID (web B, native B) | kept | kept | kept | kept | kept | kept | kept |
| SideDrop's signer (no fix) | kept | kept | **FAIL (nil)** | other suite | kept | **FAIL -34018** | **FAIL -34018** |
| our signer, fix off | kept | kept | **FAIL (nil)** | other suite | kept | **FAIL -34018** | before **FAIL -34018**, after kept |
| new App ID (BW), new team (X) | install refused: `MismatchedApplicationIdentifierEntitlement`; only deleting the app gets past, which loses everything | | | | | | |
| another app under the same App ID clears its keychain (before) | kept | kept | **OTHER** (shared) | **OTHER** | **deleted, then OTHER** | **deleted** | **deleted** |
| the same (after) | kept | kept | kept (own) | kept (own) | kept | kept | kept |
| before -> after (an app B211 signed, re-signed from its original IPA) | kept | kept | kept (copied in once) | kept (copied in once) | kept | kept | kept |
| relaunch, lock + unlock, reboot (after) | kept | kept | kept | kept | kept | kept | kept |

Findings:

1. **One keychain for every app under an explicit App ID.** Both our signers and SideDrop set
   `keychain-access-groups = [TEAM.<App ID>]`, so every app signed with SideDrop's (or any one-App-ID) profile writes
   into `S8NFX3A2LT.com.ryha.sideload`. The probe saw iFizBox's own items there (`com.ryha.ifizbox.signing.p12`,
   `com.ryha.ifizbox.reviews`), and a second probe app deleting "its" items on first launch deleted the first
   probe's; the first then silently read the second's markers. That is a sign-out at a random time with no re-sign
   around it: any app under the same App ID that clears or overwrites its keychain (many do on a fresh install or a
   logout; Meta apps share family login items by service name) takes RyukGram's session with it.
2. **The profile's first app group as the fix's target** (B211): every fixed app shared one folder and one suite,
   and the folder moved whenever the profile's first group changed (groups added after Ian assigned them: SideDrop's
   profile had an empty group list before; groups listed in another order). Not reproduced on the phone: Apple
   gives every profile of one App ID the same group list, and the API can't change groups; covered by unit tests.
3. **Without the fix** (SideDrop), an app's original group is nil and keychain calls that name a group fail with
   -34018 (missing entitlement). `<team prefix>.<bundle ID>` failed too, because only `TEAM.<App ID>` was entitled.
4. A new certificate, a profile made again, or a re-sign of any kind on the same team and App ID loses nothing
   (with the fix, before and after). Team or App ID changes are refused by installd outright.
5. Relaunch, a lock and unlock, and a reboot lose nothing. The 15 Pro has no passcode, so data protection classes
   (items unreadable before the first unlock, or while locked) can't show there.

## RyukGram and YouMod

The regular RyukGram 453.0.0 (`com.burbn.instagram`, https://source.ryuksign.com/) was inspected, not run (a
subagent downloaded it to the scratchpad). The Duplicate build is `com.ryuk.ryukgram`: another bundle ID, so another
data container, keychain items and app (both can sit side by side); switching between the two looks exactly like
losing everything, but only once, at the switch.

- Original entitlements: `application-identifier MH9GU9K5PX.com.burbn.instagram`, keychain groups
  `MH9GU9K5PX.platformFamily` and `MH9GU9K5PX.shared`, app groups `group.com.burbn.instagram`,
  `group.com.facebook.family`, `group.com.burbn.family`. Eight extensions (notification service, share, widgets...).
- Injected: `RyukGram.dylib` (+ CydiaSubstrate), FLEX, and `zxPluginsInject.dylib`, a sideload shim that already
  hooks `SecItemAdd/CopyMatching/Update` (imports `SecTaskCopyValueForEntitlement`, the string `MH9GU9K5PX.`,
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: it learns its team prefix by adding an item and rewrites Meta's
  `MH9GU9K5PX.*` groups) and redirects `containerURLForSecurityApplicationGroupIdentifier:` and `initWithSuiteName:`
  ("groupContainer %@ -> %@ (entitled)" / "(sandbox fallback)", suite fan-out for extensions). Extensions get
  `RYGExtensionKit.dylib` (deleted-message fetching with the session token copied into `group.com.burbn.instagram`).
- RyukGram's own settings: NSUserDefaults (standard) and `RyukGram/...` files in the data container: they survive
  every re-sign that keeps the bundle ID. Its wipe functions (`wipeKeychain`, "Clear device & relaunch") run only
  from a tap; nothing checks the signature or team, and nothing logs out on its own.
- The subagent reported a string "keychain bootstrap FAILED ... SecItem rebind inactive"; it isn't in any file of
  the app (checked with grep over the whole bundle), so that theory was dropped.

Why RyukGram and not YouMod: Instagram keeps its session in keychain groups it names itself and in its app group,
both of which only work through zxPluginsInject's rewriting into whatever the signature gives. Under SideDrop that
is the one keychain group every SideDrop app shares (finding 1) and, for groups, the profile's shared group or a
sandbox fallback. YouTube keeps its sign-in with Google's own keychain code in its default group and doesn't depend
on an app group, so the same signature leaves it alone. The most likely cause of the random sign-outs is another
app under `com.ryha.sideload` clearing or overwriting keychain items in that shared group (or a second Meta app
sharing the family items); second, zxPluginsInject's prefix lookup adds an item with AfterFirstUnlock, which fails
before the first unlock after a reboot, so a background launch then (push, background refresh) may see no session.
Neither is proven for RyukGram itself on the user's phone (Not verified below).

How our fix meets RyukGram (from reading, not run): the group fix rebinds `SecItem*` in every non-cache image,
zxPluginsInject's included, and is injected after the app's own dylibs, so its rebinding should come last and
Instagram's calls lose their access group and land in `TEAM.com.burbn.instagram` (its own group now),
with no lookup that can fail while locked; its original groups go to folders of its own. Extensions keep their
original groups unmapped (only the main executable gets the fix, as before).

## The fix

- Keychain: both signers write `keychain-access-groups = [TEAM.<the app's own bundle ID>, TEAM.<App ID>]` when the
  profile's keychain entry allows the first (`TEAM.*`; `Profile.keychainGroups`, `core/websign.js keychainGroups`).
  New items go to the app's own group; old ones stay readable through the second. Extensions get the app's.
- Group fix: never the profile's group for a new plan; the original groups map to `Library/AppGroups/<group>` and
  suite `ifizbox.appgroup.<group>` in the app's own container, under any profile. An app an earlier sign mapped to a
  profile group keeps it while the profile has it, `lost` when not (logged by the native signer, `warnings` in the
  website job's result). `legacy` (the group the old rule would have picked) makes the dylib copy that folder (not
  Library/Caches) and suite into the app's own once, only when the app has run before (its own preferences aren't
  empty): checked on the phone (before -> after row).
- Team / App ID change: installd refuses it; the app's signer already stops first (`AppIDMatch`, B138). The website
  can't see what is installed (follow-up filed).
- Docs: `docs/signing.md` "Keeping an app's data across re-signs", `docs/developer-account.md` "Keep your apps'
  data" and a trouble entry, `docs/sideload.md`.
- Files outside the task's list: `web/app/core/groupfix.js` and its test, `web/app/core/keepid.test.js`,
  `web/app/core/websign.test.js` (B211's planner lives there; the tests follow), and the docs (the user asked).

## SideDrop

SideDrop is another project (its repo on the TrueNAS host); not changed here. Its `sign_ipa`/`app_entitlements`
need the same two changes (filed): `keychain-access-groups = [f"{team}.{bundle ID kept}", appid]` and the group fix
(or at least no shared app-group target), plus the same docs section. Its `regen_profile` keeps the App ID, so
making the profile again (new iPhone, new capability) loses nothing by itself.

## Failed on the way

- First probe crashed: iOS 27 stops an app built with its SDK that has no scene lifecycle
  (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`); now it has a scene delegate.
- NSUserDefaults writes made right before the app was killed by the next install were sometimes lost (the launch
  counter, a prefs marker once): the run log is by line, not by counter.
- WDA's activate timed out once; `run.sh` launches with go-ios instead.

## Not verified

- **The app's own on-phone signing** (KeychainIdentity, SignBridge, This iPhone/Signing Server routes) and **a
  background auto re-sign**: the native rows used the same Swift signer built for Linux (`signbench-linux`), not
  iFizBox on the phone; the entitlements and group fix come from the same code (`Profile.entitlements`,
  `GroupFix.plan`), and auto re-sign signs from the original IPA through `IPASigner` like Install does.
- **Profile groups changing or reordered on one App ID**: Apple's API can't change groups; unit tests only.
- **Data protection**: the 15 Pro has no passcode, so "before first unlock" and "while locked" reads can't fail
  there; RyukGram's prefix lookup failing before the first unlock is a reading of its imports, not observed.
- **RyukGram itself** on a phone (not installed: the user's apps stay alone, and the 15 Pro has no Instagram login).
- **Hours-long run**: relaunch, lock/unlock and one reboot only (see below if a later check was added).
