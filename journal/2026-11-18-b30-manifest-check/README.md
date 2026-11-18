# B30: check the install manifest before handing iOS the link

The user's install log ended on "Handing iOS the install link" with no Install prompt: iOS shows nothing at all
when it can't load the itms-services manifest (the task's uiopen test on the iPhone 7 showed a 404ing manifest
gives no popup).

## What I did

- `native/sign/ManifestCheck.swift` (new, Foundation only, so the Linux host tests run it): `problem(status:body:error:)`
  says why an answer isn't a manifest iOS can read (transport error; non-200, with the Worker's JSON `error` words
  when there are some; 200 that isn't a plist with a non-empty `items`), and `errorText(host:reason:reached:)`
  builds `no_manifest: Couldn't reach <host>: <why>. iOS can't show Install without it.` (or
  `<host> didn't give the install manifest: <why>. …` when the server answered with the wrong thing).
- `native/Sources/Sideload.swift` `serveAndOpen`: after the install server starts and the manifest URL is built, a
  GET of that exact URL (`checkManifest`, ephemeral session, 10 s request/resource timeout, no cache). Failure: the
  IPA is never served, the file is deleted, `opened(.failure(Failed(text: "no_manifest: …")))`, and the install log
  gets the sentence. Pass: the log says "Checked the manifest: <host> answers it", then the old serving code runs
  (moved unchanged into `serveChecked`). Cancel during the check cancels the request (`job.onCancel`) and answers
  `cancelled`.
- My IPAs' install (`MyIPAs.install`) already goes through `serveAndOpen` and passes `Sideload.Failed.text` on, so
  MyIPAs.swift needed no change. The host path (iFizBox updating itself through POST /sign/host) gets its itms link
  from a server that just answered 200, so it isn't checked.
- `web/app/core/signing.js` `deviceError`: code `no_manifest` keeps the native sentence and adds "Check the
  connection, or the Signing Server in Settings > Signing." It doesn't jump to Settings (`open: null`): when the
  default server is down or the phone is offline that jump would be noise.
- Tests: Swift host test "manifest check before iOS gets the link (B30)" (native/sign/tests/sideload/main.swift,
  including the Worker's real manifest text), node test for the `no_manifest` alert.
- docs/signing.md "Installing an app": step 3 describes the check.

## What failed

- First gate run: `native/test_install_server.py` test_route_kept_for_the_grace reads serveAndOpen's source for
  B29's grace logic, which now lives in `serveChecked`. Pointed the test at `serveChecked`.

## Checked

- `python3 -m unittest native/test_sideload.py` (Swift 6.4.2 host build): all passed, including the new test.
- `node --test web/app/core/signing-device.test.js`: passes.
- `make -C native package`: the .deb and sideload .ipa build, no warnings from the changed files.
- From the iPhone 7 over ssh (no screen, no lock needed): `curl https://sign.ifizbox.com/sign/manifest?…` answers
  HTTP 200 `application/xml` with the plist (that text is now in the Swift test, so the parser accepts it);
  an unresolvable host fails at once ("Could not resolve host").

## Not verified

- The sideload build on a phone with Signing Server set to an unreachable host showing the alert, and the default
  server still getting iOS's Install prompt after the check. Why: the iPhone 7 runs the jailbreak .deb; putting the
  sideload IPA on it, adding a certificate/profile and typing a server URL on the on-screen keyboard through
  ui-7.sh is a long UI session I couldn't do reliably unattended. The link handed to iOS is byte for byte what it
  was before (only a GET runs first), and the default server answers the check from that phone, so the prompt
  should be unchanged. Worth a person's install on 0.9.4+ to confirm.
- URLSession's real wording for a timeout / DNS failure on iOS 15 in the alert (the test uses an NSError with the
  usual text; the code only strips the trailing full stop).
