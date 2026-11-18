# B39: incoming IPA asked for the certificate again, then landed on Home

## Why the saved certificate wasn't seen

Settings > Signing and Install both go by `signing.status` (`SignBridge.status()`, JS `statusReady`): a Keychain
identity whose certificate reads. The share path (Open In / share sheet, `native/share/App/ShareBridge.swift` and
`ShareRouter.route` in `native/share/Share.swift`) had a check of its own, `PhoneSigner.problem()`: it also wants the
profile file and refuses on the profile's or certificate's dates or the certificate not being in the profile. When
it found anything, a shared IPA link was refused with "Import Your Certificate" (and a shared file's Inbox copy was
deleted), while Signing showed the certificate as set up. That is the "different check than the Signing screen
uses" from the brief.

Fix: a sideload IPA always goes into My IPAs and its page (`.signIPA`); `ShareBridge.receive` no longer branches on
`problem()`. The page's Install (`installFromLibrary` -> `firstInstallCheck`) decides with `signing.status`, the same
rule as Signing. A real problem with the profile still surfaces, as the signer's error when signing, with the file
kept. `ShareSigner`/`PhoneSigner` stay (unused by the router now) to keep the diff small.

Load order on cold launch was looked at too: the bridge registers every handler in `Bridge.init` before the page
loads, and `readyStatus` already retries `signing.status` once; nothing there explained it, so it wasn't changed.

## Back to the page, not Home

`screens/signing.js` gains `rememberReturn(hash)` / `pendingReturn()`: the page that opened Signing. `offerInstall`
(called by every Signing draw, F177) now first goes back to that page once ready, then asks Install Now there.
Set by `firstInstallCheck` (its `from`, the hash when Install was tapped) and by `openRoute`, which every
`why.open === "signing"` path uses; `openSigning()` is exported for the pages that set the hash themselves
(`signing-sheet.js` x2, `screens/myipas.js` Sign Now; myipas.js wasn't on the task's file list, one-line change).
`installFromLibrary` now also remembers its install (F177's Install Now), so after the import the user is back on
the IPA's page with the alert "Install <name>?" over it. Leaving Signing (any non-signing route) forgets both.

## Test

`web/app/incoming-ipa-signing.test.js`: both incoming links (`shared?route=sign-ipa`, `myipas?file=`) with a saved
cert (installs, no prompt, still on the IPA page) and without (Signing opens, after import back on the IPA page,
Install Now signs the same file); Later; Signing opened by hand returns nowhere.
`native/share/tests/main.swift` updated: no/expired certificate now routes `.signIPA`.

## Not verified

- The Swift changes (`Share.swift`, `ShareBridge.swift`, `tests/main.swift`) were not compiled or run: no swiftc on
  this machine, so `native/share/test_share.py` skips here. The edits are small (one guard dropped, one
  `if let` removed).
- Not tried on the phone (iPhone 7, sideload build): the task didn't say to touch it, and the user's exact cold-launch
  sequence couldn't be replayed. If the prompt still shows with a cert that Signing shows as fine, the next suspect
  is `readyStatus` failing twice at launch (it counts a silent bridge as no certificate).
