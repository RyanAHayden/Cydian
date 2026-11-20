# B211: app groups and keychain after re-signing

- Both signers already kept the profile's own app groups (appEntitlements / Profile.entitlements copy every key);
  the tests now say so.
- The fix dylib: `native/groupfix/groupfix.m`, built by `native/groupfix/build.sh` into
  `web/app/vendor/groupfix/ifizbox-groupfix.dylib` (committed, with `.source-sha256`; `core/groupfix.test.js` fails
  when the source changed without a rebuild). Keeps lld's LC_UUID: dyld refuses new-SDK binaries without one.
- An IPA signed a second time: its executable carries the profile's groups, so the plan also takes the groups of
  the `ifizbox-groupfix.plist` the first sign left in the app.
- Open: several original groups share one target when the profile has a group; extensions kept by the native signer
  get no fix.
- Keychain calls are rebound fishhook-style (the app's and its frameworks' `__got`/`__la_symbol_ptr`), not with
  `__DATA,__interpose`: dyld only honours interposing when AMFI allows it, which a get-task-allow=false app may not.
- Not tried on a phone yet. What to check: RyukGram (or any app with app groups) signed twice keeps its settings and
  sign-in; the device log shows nothing from the fix (it logs nothing); the signer's log says `Group fix: ...`.
