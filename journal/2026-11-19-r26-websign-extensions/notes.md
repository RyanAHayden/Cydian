# R26 Website signing with Keep Bundle IDs: could it keep app extensions?

## Verdict

**Not decided, so `websign-job.js` is unchanged and still removes PlugIns, Extensions and Watch.** The brief's
deciding step, installing a website-signed IPA that has an extension on a stock phone, needs a stock phone, a real
certificate and profile, and the user. None of those is here. The iPhone 7 runs AppSync, and an earlier test there
(B29) showed installd rejecting a throwaway certificate before it gets to any extension. R27 (the user's hand test)
already covers "a kept-ID app with extensions on a stock phone". A plan note on R27 adds the website case.

What the offline run did show:

1. **zsign signs the extension the way R25 said it should** when the ID is kept. The extension's code identifier is
   its own Info.plist ID (`com.ryha.ifizbox.r26test.ext`), which starts with the app's ID. Its entitlements are the
   app's: `application-identifier` and the keychain group are `TEAM.<profile App ID>`, `get-task-allow` is false,
   and the DER entitlements and a real CMS blob are there. The app's CodeResources seals the extension.
2. **With the ID kept, the signed extension is laid out exactly as it was with the ID changed.** Only the Info.plist
   IDs differ (`com.me.r26only.ext` against `com.ryha.ifizbox.r26test.ext`). So keeping the ID doesn't fix the cause
   of the earlier "integrity could not be verified", which happened with the ID changed (user 2026-11-18, iFizBox's
   Share and Widget). Whatever caused it would very likely happen again.
3. **The likely cause: the extension has no `embedded.mobileprovision`.** zsign (pinned 9299685, `bundle.cpp`
   SignFolder) writes a profile into a nested bundle only when one of its *several* `-m` profiles has an
   `application-identifier` ending in that bundle's ID. With the website's single profile, the `.appex` gets none.
   Xcode builds and the native signer (`native/sign/IPASigner.swift`, `isApp` covers `.appex`) put the profile in
   every app extension. As far as I know, iOS refuses an extension signed with a non-Apple certificate that has no
   profile (`0xe8008015`, "A valid provisioning profile for this executable was not found"). That is from memory,
   not checked here.
4. **The fix to try is small, and it works with zsign.** Copy the app's profile into each `PlugIns/*.appex` and
   `Extensions/*.appex` before `callMain`. zsign then seals it in the extension's CodeResources
   (`files2: embedded.mobileprovision`) and in the app's (`PlugIns/Ext.appex/embedded.mobileprovision`). One explicit
   profile allows exactly the `application-identifier` the extension carries, and a prefix wildcard allows the
   narrowed one, so the same profile fits. Filed as a follow-up that waits on R27's phone result. It doesn't change
   the product now. Filed as **F245** (low, after R27), with a note on R27 asking for both IPAs to be installed.

| Run (real zsign WebAssembly, `tools/sign.mjs`) | Profile | Extension Info.plist / code ID | Extension application-identifier | Profile in .appex |
|---|---|---|---|---|
| keep | explicit `com.me.r26only` | `com.ryha.ifizbox.r26test.ext` / same | `TESTTEAM42.com.me.r26only` | no |
| old (ID changed, `-b`) | explicit `com.me.r26only` | `com.me.r26only.ext` / same | `TESTTEAM42.com.me.r26only` | no |
| keep + profile copied in | explicit `com.me.r26only` | `com.ryha.ifizbox.r26test.ext` / same | `TESTTEAM42.com.me.r26only` | yes, sealed |
| keep | prefix wildcard `com.me.*` | `com.ryha.ifizbox.r26test.ext` / same | `TESTTEAM42.com.me.r26test` | no |

## What I did

- `tools/mkfx.py REPO OUT` (`APPID=` to pick the profile's App ID) makes a throwaway identity (`key.p12`, password
  hunter2), a profile from `native/testkit.py`, and `test.ipa`. The IPA is the repo's Tiny binary as
  `com.ryha.ifizbox.r26test`, with one widget extension `PlugIns/Ext.appex`.
- `tools/sign.mjs REPO OUT keep|old [prof]` runs the real `runSignJob` with `vendor/zsign`. It turns off the job's
  extension removal by making `FS.rmdir`/`FS.unlink` on those folders do nothing until `callMain`. `prof` also copies
  the profile into each appex before zsign runs.
- `tools/sigdump.py IPA` prints, for each Mach-O, the Info.plist ID, the CodeDirectory identifier and team, and the
  entitlements blob's `application-identifier`, keychain groups and `get-task-allow`. It also prints the DER and CMS
  sizes, every `embedded.mobileprovision`, and what each CodeResources seals.
- Read zsign's `bundle.cpp` (cached tarball `~/.cache/ifizbox-zsign-wasm`) for how it writes profiles into nested
  bundles and how it handles `.appex`.

## Tried and failed

- The dump script was first called `inspect.py`. It shadowed Python's `inspect` module, so the next `mkfx.py` run
  imported it through `cryptography` → `dataclasses` and crashed. I renamed it `sigdump.py`.

## Not verified

- **The deciding install on a stock phone** (the brief's step): no stock phone, no real certificate or profile here,
  and the user's OK is needed (R25/R27). The iPhone 7 can't stand in: AppSync, and installd stops at the throwaway
  identity first (B29). Moved to R27 with a plan note.
- **That a missing `embedded.mobileprovision` in the appex caused the earlier "integrity could not be verified"**:
  inferred from zsign's code and from how Xcode and the native signer lay out bundles. The installd error is quoted
  from memory, and installd's strings weren't read for this task.
- **That the native signer's kept extensions install on a stock phone** (F237 keeps them with the profile in each
  appex): not touched here, and also R27's question.
- Extensions with their own entitlements (App Groups, Push for a Notification Service extension): the Tiny fixture's
  extension asks for none. zsign gives every binary the app's `-e` entitlements, so an extension's own App Group is
  dropped, as it is in the native signer.
