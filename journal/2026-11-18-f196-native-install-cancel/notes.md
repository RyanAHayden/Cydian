# F196: native signing.cancel and ipa.cancel (F188's Cancel)

## What was done

**Sideload shell: `signing.cancel`** (SignBridge.swift registers it, Sideload.swift `cancel`) -> `{cancelled: bool}`.

- `native/sign/SignJob.swift` (new, Foundation only so the host tests build it): one running job; `begin()` makes
  it the one Cancel stops, `onCancel` hooks the stops, `check()` throws code `cancelled`, `end()` lets it go (a newer
  job is left alone).
- `IPASigner.stop` (native/sign/IPASigner.swift): checked after each file read, after each bundle signed and before
  the zip is written; throws `cancelled` and nothing is written. Without it Cancel could only discard the result
  after a long sign, so this small hook was added outside the task's file list (additive, 6 lines).
- `Download` (SignBridge.swift) now returns itself from `start` and has `cancel()` (invalidateAndCancel, `done` gets
  "cancelled: Cancelled" once; `finish` got a lock since cancel races the delegate queue). `Sideload.download`
  returns it too and removes the partial file on failure.
- `signing.install`: job begun at the call; Cancel stops the download, the signer (`signer.stop`), the host upload
  (iFizBox's own update, `hostAndOpen`'s upload task) or, once iOS has the link, the serving: `serveAndOpen`'s
  `job.onCancel` removes the route with `InstallServer.cancel(path)` (cuts a transfer under way at its next 1 MB
  chunk, stops the listener and its background task when nothing else is served), deletes the IPA and releases
  KeepAlive at once (no minute's grace). The job stays current until iOS fetched the IPA or the link expired.
- `library.sign` / `library.install` (MyIPAs.swift): same job; `signIfNeeded(job:)` sets `signer.stop`. A cancelled
  library sign leaves an earlier signed copy alone (Library.sign only replaces it after a finished sign).
- `signing.progress`'s watch ends (installed: null) after a signing.cancel (`Sideload.watchCancels`).
- Re-sign All / resign are not hooked (no job): their pages weren't part of F188's Cancel.

**Jailbreak shell: `ipa.cancel`** (Apt.swift): `IPAInstall.Run` tracks the running ipa.install; Cancel cancels the
download task, or, if the download just finished, keeps cydian-helper from starting. Once the helper runs it refuses
("can't be stopped halfway"): install-ipa's stdin is /dev/null, there is no channel to it (unlike apply-ask's "C"
line, F64), and the brief only asked for "helper before installd starts". ipa.install then answers
"cancelled: Cancelled" (the page has already closed and ignores it).

**Web**: `screens/ipa-install.js` `stopIpaInstall` asks `cydianNative.call("ipa.cancel")` on the page's Cancel,
answer ignored; not for share.js's stand-in (`native`), which turns every call into share.ipaInstall (a staged file:
no download to stop, and asking it would start another install). signing-client.js already called signing.cancel.

## Tests

- native/sign/tests/sideload/main.swift: "F196: Cancel stops the signing job" (SignJob states, signer stopping with
  `cancelled` and writing no output). `python3 -m unittest native.test_sideload` passes.
- web/app/ipa-cancel.test.js: stopIpaInstall's call, ignored refusals, nothing to the stand-in.
- Native jailbreak and sideload builds compiled by the gate (`make -C native package`).

## Not verified

- Nothing ran on a phone: Cancel mid-download, mid-sign, while iOS fetches the IPA from 127.0.0.1, and the
  KeepAlive release were not tried on the iPhone 7 (the task doesn't say to touch it) or a sideload device (none
  here). The Swift compiles; the shell paths (URLSession cancel, NWConnection cut-off, LSApplicationWorkspace watch)
  have no host test.
- The wiring `page.stoppable -> stopIpaInstall` in openIpaInstall has no test (it needs the fake DOM of
  install-cancel.test.js); only stopIpaInstall itself is tested.
- native/fake/fake-native.mjs has no signing.cancel/ipa.cancel (not in the task's files; the web code ignores a
  refusal, so the fake's "unknown method" is fine).
