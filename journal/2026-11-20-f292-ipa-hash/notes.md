# F292: the IPA's SHA-256 when it is signed

F291 left Report as Malicious's `sha256` and MALWARE_IPAS's hash match empty: nothing recorded a hash. Now both signers
hash the IPA as it came, before signing changes it, and refuse a listed hash before signing.

## What changed

- `web/app/core/malicious.js`: `rememberSigned(storage, { ids, versions, sha256 })` keeps one hash under every ID and
  version a report may ask by; `malwareHashes(list)` gives MALWARE_IPAS's hashes, lowercased; `MALWARE_REFUSED` is the
  refusal's sentence.
- Website: `websign-job.js` `ipaSha256(bytes)` (crypto.subtle, in the Web Worker) runs before unzip. A hash in the job's
  `refuseSha256` throws code `malware` before zsign; otherwise the answer carries `sha256`. `signing-worker.js` passes
  it on as it is (comment updated).
- Native: new `native/Sources/IPAHash.swift` (the signer's own streaming SHA256, native/sign/Hash.swift; 1 MB chunks,
  each in an autoreleasepool). `signing.install`
  (both the url path and the look-first sheet's token path) and `signing.prepare` (the IPA queue, Re-sign, My IPAs)
  hash the downloaded or copied IPA before signing, log "IPA SHA-256: …", answer `sha256`, and refuse with
  `malware: …` when it is in the call's `refuseSha256`.
- `signing-client.js`: `keepIpaHash(storage, result, asked)` stores the signer's hash under the caller's ID and
  version (the app page's: the source's bundle ID and version, which `reportMalicious` asks with) and the IPA's own
  (`originalBundleId`/`originalId`, the signed ID, the Info.plist version). Called after signing.install,
  signing.prepare and the website's worker. `refusing()` adds `refuseSha256` to the three signer calls **only while
  MALWARE_IPAS lists a hash**: with today's empty list the calls are byte for byte as before (existing tests compare
  params exactly, and an older shell sees nothing new). A `malware` refusal's alert is titled Known Malware.
- Tests: `web/app/ipa-hash.test.js` (hash, refusal before zsign, the helpers, prepare/install sending the list and
  keeping the hash, the Known Malware alert).

## Decisions

- The hash is of the unsigned IPA as downloaded: the signed one differs per certificate, so only the original can
  match a report from another device or a MALWARE_IPAS entry.
- Kept under several ID/version keys because the report asks by the source's bundle ID and version, which can differ
  from the IPA's Info.plist (Keep Bundle IDs off, a source listing "1.2" for an IPA saying "1.2 (45)").

## Tried and dropped

- Always sending `refuseSha256: []`: broke three existing tests that deep-compare the bridge params
  (apprun.test.js, signing-client-device.test.js, signing-sheet.test.js); sending it only when non-empty keeps them
  and the calls unchanged.

- CryptoKit's `SHA256` first: the gate's native build (swiftc isn't on PATH, but build.sh finds its toolchain) failed,
  as the module already has its own `SHA256` struct (native/sign/Hash.swift) that shadows CryptoKit's. Used that one.

## Not verified

- Not run on a phone (the sideload IPA's signing.install / signing.prepare answering `sha256`, the Report carrying
  it): the task didn't call for the iPhone 7, and the build above couldn't be made here.
- The website's hash in a real browser Worker: tested in Node's crypto.subtle only. An http (non-secure) page has no
  crypto.subtle; the job then signs without a hash, by design.
- docs/signing.md doesn't list the new `sha256` / `refuseSha256` fields: docs weren't among this task's files.
