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
  value and writes it again into our group when it was elsewhere.
- `native/test_native.py test_own_keychain_group`: every add in those files is scoped, moveAll names every store.
- `ASC.query` lost its `private` (moveAll reads it). SignBridge.swift is outside the task's file list: its
  `confirmImport` add and the launch call are one line each.

## Device check (iPhone 15 Pro)

(see below)

## Not verified

(see below)
