# B121: the website signs for the .p12's own certificate, not the profile's first

## Problem

F276's profile for a `.p12` picked alone (`profileForAnyP12`) lists every distribution certificate in the account. The
website then took `profileSerials(id.profile)` as "the .p12's serials", and `findCertificate` returned the first
match. So the per-app profile (`autoProfileSite`) could be made for another certificate, and iOS refuses an app signed
with a certificate its profile doesn't list. Check Account and the Make Certificate picker's "in use" mark used the
same list.

## What I did

- `web/app/core/p12cert.js` (new): reads the certificates out of a `.p12` in the browser. The certificate bags are
  decrypted with the password: PBES2 (PBKDF2 + AES-CBC, and des-ede3-cbc) through WebCrypto. PKCS#12's own PBE
  (pbeWithSHA1And3-KeyTripleDES-CBC, pbeWithSHA1And40/128BitRC2-CBC) uses the existing `pkcs12Kdf` (now exported from
  `core/signing.js`) with DES-EDE3 and RC2 written in JS, since WebCrypto has neither. Plain (unencrypted) bags, as
  `freecert.makeP12` writes them, are read too. The leaf is the certificate whose localKeyId a key bag has, else the
  only one with a localKeyId, else the one that issued none of the others. `p12Leaf` gives `{ serial, team }`.
- `signing-client.js identityCert(id)`: reads it once and keeps it with the identity as
  `p12Cert { of: SHA-256 of the .p12, serial, team }`. It's read again when the `.p12` changes. Null when it can't be
  read (wrong password, BER, another cipher).
- `screens/devaccount.js`:
  - `siteSerials(id)`: the `.p12`'s serial alone, else the profile's list as before. Used by `autoProfileSite`, Check
    Account (website) and `currentSerials` (Make Certificate's "in use").
  - `profileFromKey`: when the serial and team read, it makes the profile with `profileForP12` for that one
    certificate. Otherwise `profileForAnyP12` as before.
  - `dropOtherCertProfile`: a cached per-app profile that doesn't list the `.p12`'s certificate is forgotten, so
    ensureProfile makes it again. Without this, a profile already made for the wrong certificate would be reused
    until it expired, because the cache entry's certId isn't compared when no certId is passed.
- Fixture `web/app/core/fixtures/signing/test-rc2.p12`: the same certificate and key as test.p12 (password
  `hunter2`), exported with `openssl pkcs12 -export -legacy -certpbe PBE-SHA1-RC2-40 -keypbe PBE-SHA1-3DES -macalg sha1`.
- Tests: `core/p12cert.test.js` (FIPS/RFC 2268 vectors, the four fixture .p12s, wrong passwords, a made .p12, leaf
  choice) and `screens/devaccount-serial.test.js` (identityCert keeping and rereading, siteSerials fallback,
  profileFromKey listing one certificate under its team, dropOtherCertProfile).
- docs/signing.md: a paragraph under "Own provisioning profiles".

## Choice: JS decryption rather than zsign

zsign (wasm) opens the .p12 but prints nothing about the certificate. `runPasswordCheck`'s output with `-d` is only
"Can't find app folder", and the module exports only main, unzip and plist_json. Exporting the serial would mean
rebuilding the wasm (emcc, network, byte-for-byte gate check). Decrypting the bag in JS needed no rebuild.

## What failed on the way

- RC2 at first decrypted the RFC 2268 vectors to garbage. I had typed one byte twice (`93`) in the PITABLE (257
  entries). A test now checks the RFC vectors.

## Not verified

- A real Apple Distribution `.p12` exported from macOS Keychain Access or from another sideloading tool: none is on
  this machine. The fixtures cover the ciphers those use (3DES, RC2-40, AES/PBES2) but not their exact encodings. A
  BER-encoded file (indefinite lengths) isn't read, and the website then falls back to the profile's list (the old
  behaviour).
- In a real browser (Safari on an iPhone): only node's WebCrypto ran. The 3DES fixture (20000-iteration PKCS#12 KDF,
  one `subtle.digest` per iteration) takes about 0.6 s in node. It runs once per `.p12`, and then the serial is cached
  with the identity.
- autoProfileSite end to end against App Store Connect: it needs the site's pass-through and a real key. Its parts
  (siteSerials, dropOtherCertProfile, ensureProfile's serial lookup) are tested separately.
