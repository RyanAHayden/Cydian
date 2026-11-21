# B233: iFizBox's own secrets in its own Keychain group

B227's probe, signed with SideDrop's profile (explicit App ID `com.ryha.sideload`), listed iFizBox's
`com.ryha.ifizbox.signing.p12` and `com.ryha.ifizbox.reviews` items: iFizBox wrote every Keychain item with no
access group, so they went to the default group, which every older sign made `TEAM.com.ryha.sideload`, a group every
app signed with that profile has.

## What changed

- `native/Sources/OwnKeychain.swift` (new): `group` is `TEAM.<bundle ID>` when the signature's
  `keychain-access-groups` lists it (read with `SecTaskCopyValueForEntitlement`, looked up at run time like the
  probe does), else nil: SideDrop's signer (only `TEAM.<App ID>`) and the jailbreak build (`com.ryha.ifizbox`, no
  team) write as before. `scoped(attrs)` adds the group to an add; `move(query)` lists what a query finds with
  attributes only and `SecItemUpdate`s the access group of every copy in another group to ours (a copy already in
  ours wins, the other is deleted); `moveAll()` moves the p12 item, the identity's certificate and key (found by the
  public key's SHA-1, as `confirmImport` does), the ASC key, the account key and the review token.
- `moveAll()` runs at launch in the sideload build, on SignBridge's queue next to `removeOldInstallCA`, every launch
  (no flag: a sign without our group in between would write to the shared group again; a few attribute queries).
- Every `SecItemAdd` of those stores (SignStore, SignBridge.confirmImport, ASC, Account, Paid) goes through
  `scoped`. Reads and deletes keep no group, so they find items in either group.
- Payment secrets (Paid.swift `Keychain`) are behind Face ID when the phone has a passcode, so they don't move at
  launch (a `SecItemUpdate` of an access-controlled item might ask); `Keychain.get` returns the attributes with the
  value and, when it was in another group, adds it to ours and deletes the old copy only once that add worked
  (`moveIn`; the review caught a first version that deleted first).
- "Once": `moveAll` runs every launch instead of once behind a flag. Moving is a no-op when nothing is elsewhere, and
  a sign without our group in between (SideDrop's signer) would put new items in the shared group again.
- Reads still name no group (decided, not changed after the review suggested scoping them): an item whose move failed
  stays readable. Another app under the same App ID could plant an item in the shared group that we'd then read or
  move in, as it could before this task; only when ours exists does ours win.
- `native/test_native.py test_own_keychain_group`: every add in those files is scoped, moveAll names every store.
- `ASC.query` lost its `private` (moveAll reads it). SignBridge.swift is outside the task's file list: its
  `confirmImport` add and the launch call are one line each.

## Device check (iPhone 15 Pro)

1. Baseline: `tools/resignprobe/run.sh B233 check baseline` (the probe B227 left, signed with SideDrop's profile,
   groups `S8NFX3A2LT.com.ryha.ifizbox.probe`, `S8NFX3A2LT.com.ryha.sideload`) listed
   `com.ryha.ifizbox.reviews` and `com.ryha.ifizbox.signing.p12` in `S8NFX3A2LT.com.ryha.sideload`.
2. This branch's Lite IPA signed with SideDrop's identity (A) by the native signer (`signbench-linux`, as
   `run.sh native` does, no group fix): `keychain-access-groups` starts with `S8NFX3A2LT.com.ryha.ifizbox`.
   Installed over B227's copy (`ui-15.sh install --as-is`), launched.
3. Probe again (`check after-b233`): visible lists only its own four `probe.*` items. iFizBox's are gone from it.
4. iFizBox still has them (web inspector, `ifizboxNative.call`): `reviews.token.get` -> a 43-character token,
   `signing.status` -> the SideDrop identity, `signing.export` -> the .p12 (4192 bytes base64). No account key or
   ASC key was set on this phone.

## Failed on the way

- First Paid move deleted the secret before adding the copy (spec review); now add first, delete after.
- The first edits went through a Python heredoc; the rest with the editing tool.

## Not verified

- **The identity's certificate and key moved**: the probe lists generic passwords only; `signing.status` reading the
  identity after the move shows it's still reachable, not which group holds it.
- **ASC key, account key, payment secrets**: none were saved on the 15 Pro, so their move wasn't seen; the same
  `move` as the p12/review token (ASC, account) and `moveIn` (payment, on read) cover them. The payment path with a
  passcode and Face ID can't be shown on the 15 Pro (no passcode).
- **Jailbreak build**: `group` is nil there by construction (`com.ryha.ifizbox` has no team prefix); not run on the 7.
