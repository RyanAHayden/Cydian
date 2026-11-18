# B21: signing an IPA whose nested bundle names a missing executable

User 2026-11-18: YouMod failed in the sideload build with "YTUHD.bundle/YTUHD is missing." (Downloading, Reading,
Signing, then Couldn't Install).

## What each signer did

- **On-device signer** (`native/sign/IPASigner.swift`): collects every folder with an Info.plist and a
  `CFBundleExecutable` (`.app .appex .framework .xctest .bundle`) as a bundle to sign, then threw `bad_ipa ... is
  missing.` when the named executable wasn't in the zip. That's the user's error.
- **zsign** (website, `web/app/vendor/zsign`): only `.app .appex .framework .xctest` are sign folders, so a `.bundle`
  was already sealed as files. A `.framework` without its binary stopped it: "Can't parse BundleExecute file!".

## Fix

- IPASigner: while collecting bundles, a nested one whose executable isn't in the IPA is skipped like a resource
  bundle (its files sealed in the enclosing bundle's CodeResources), with a log line
  `Skipped <rel>: its executable <exe> is missing, sealed as resources` through the new `IPASigner.log` (NSLog on the
  phone, the device log) and listed in the new `SignedApp.skipped`. The app's own executable missing is still
  `bad_ipa "<exe> is missing."`.
- zsign: `tools/zsign-wasm/skip-missing-exe.patch` (applied by build-zsign-wasm.sh with the other patches): in
  `GetObjectsToSign`, a nested folder whose executable file doesn't exist is dropped from the sign list with a
  `ZLog::WarnV` "Skipped ..." line (zsign's output, which websign-job.js collects). The root app isn't listed there,
  so its missing executable still fails. Rebuilt `zsign.wasm` with the same emcc (6.0.13, ~/emsdk) as the committed
  copy; `zsign.js` came out unchanged.
- Fixture `web/fixtures/missing-exe.ipa` (tiny-cydian.ipa + YTUHD.bundle + Kit.framework without binaries), used by
  `native/test_sign.py` / `native/sign/tests/main.swift` (new test, plus `noexe.ipa`: the app's own executable
  missing is refused) and `web/app/websign-missing-exe.test.js` (real zsign WebAssembly). The web test fails on the
  old zsign.wasm (checked by swapping it back) and passes on the new one.

## Not verified

- On the iPhone 7 / sideload build with YouMod: not done. The task says "if possible"; it needs a sideload build
  installed with a certificate and an AppTesters-style YouMod download, and driving the phone's screen, which this
  unattended run didn't do. The fixture reproduces the exact shape of the error (a .bundle naming a missing binary).
- The skip line is not shown in the app's UI: the sideload build has no install log page; it goes to the device log
  (NSLog) and `SignedApp.skipped`. Sideload.swift/MyIPAs.swift don't pass `skipped` to the page (outside this task's
  files). On the website it is in zsign's output, which is only shown when signing fails.
