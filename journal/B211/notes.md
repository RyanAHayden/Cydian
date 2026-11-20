# B211: app groups and keychain after re-signing

- Both signers already kept the profile's own app groups (appEntitlements / Profile.entitlements copy every key);
  the tests now say so.
- The fix dylib: `native/groupfix/groupfix.m`, built by `native/groupfix/build.sh` into
  `web/app/vendor/groupfix/ifizbox-groupfix.dylib` (committed, with `.source-sha256`; `core/groupfix.test.js` fails
  when the source changed without a rebuild). Same bytes on every build here (`-no_uuid`, debug prefix map).
- Keychain calls are rebound fishhook-style (the app's and its frameworks' `__got`/`__la_symbol_ptr`), not with
  `__DATA,__interpose`: dyld only honours interposing when AMFI allows it, which a get-task-allow=false app may not.
- Not tried on a phone yet. What to check: RyukGram (or any app with app groups) signed twice keeps its settings and
  sign-in; the device log shows nothing from the fix (it logs nothing); the signer's log says `Group fix: ...`.
