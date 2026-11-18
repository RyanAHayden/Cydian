# F133: check a full-URL Filename's download against its Packages stanza

F131 lets the shell download packages whose Filename is a full URL (apt can't), so apt's hash check never ran on
them. Now the stanza's SHA256 (or MD5sum when the repo lists no SHA256) travels with the job and the shell checks
the file before simulate-deb / install-deb ever see it.

## What I did

- `native/share/Share.swift`: `DebChecksum.check(file, sha256:, md5:)` → nil (matches, or no hash given) or a
  `bad_hash: …` sentence. SHA256 wins when both are given. A hash that isn't hex of the right length is refused too.
  SHA256 is `native/sign/Hash.swift`'s (CommonCrypto on the phone, plain Swift on Linux; the app already compiles
  sign/*.swift with share/*.swift). MD5 is a small plain-Swift RFC 1321 `MD5` struct (CC_MD5 is deprecated on iOS 13+).
- `native/share/App/ShareBridge.swift`: `share.debFetch {url, sha256?, md5?}` hashes the download on
  SharedInbox.queue after the .deb check; a mismatch removes the file and fails `bad_hash: …`. The reply gains
  `checked: "SHA256" | "MD5" | null`.
- `web/app/core/catalog.js` `aptVersionList`: each version carries `sha256` / `md5sum` (lowercase hex or null), from
  the same stanza that gave its `debUrl`.
- `web/app/core/queue.js` `debLinkOf(history, version)` → `{ debUrl, debSha256?, debMd5? }` (new function beside
  debUrlOf, which is unchanged).
- `web/app/screens/queue.js` `withDebUrls` uses debLinkOf, so the job carries the hashes. (Not in the task's file
  list; a three-line change there was the only way to get the hash from catalog.history onto the job, since the
  native backend has no catalog of its own.)
- `web/app/backend-native.js` `linkedDebs`: passes them to share.debFetch; the staged file is keyed by url+hashes, so
  a source update with a new hash refetches; a `bad_hash` failure becomes its own Cannot Comply sentence
  ("… isn't the file its source lists (…), so Cydian won't install it.").
- Tests: Swift (`native/share/tests/main.swift`, `test_share.py` now also compiles sign/Hash.swift): matches,
  mismatches, case/space, SHA256-over-MD5, bad hash, missing file, MD5 against RFC 1321 vectors and across block
  edges. JS (`backend-native-linked.test.js`, the share.debFetch stand-in now checks with node:crypto): debLinkOf,
  hashes passed and a matching file installs without a refetch, a mismatch (SHA256 and MD5) is refused with nothing
  staged, a changed hash refetches. `core/versions.test.js`'s deepEquals gained the two null fields.

The first gate run failed in the device build (Linux tests never compile ShareBridge.swift): a `? :` mixing a
String and NSNull in the `checked` reply. Fixed with an optional String, then `?? NSNull()`.

## Decisions

- No hash in the stanza → no check (as before), rather than refusing: many small repos' stanzas only have MD5sum, a
  few have none, and F131's links worked without one.
- SHA1/SHA512 aren't checked: Packages files on jailbreak repos carry MD5sum and SHA256 (dpkg-scanpackages' default);
  SHA512 alone would need a SHA512 in Swift for little gain.
- N7's daemon (automatic updates) doesn't use this path (F131 filed that separately).

## Not verified

- On the iPhone 7: the task didn't ask to touch it. The CommonCrypto SHA256 path and the new bridge code in
  ShareBridge.swift only compile in the device build (tools/check.sh builds it when the toolchain is there); the
  check logic itself runs on Linux through Share.swift's tests.
- screens/queue.js `withDebUrls` has no DOM test (no harness for openConfirm, as F131 noted); debLinkOf, which it now
  calls, is tested.
