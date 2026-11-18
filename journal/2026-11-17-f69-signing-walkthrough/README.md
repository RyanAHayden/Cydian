# F69: Sideload signing: Install agrees with Settings, a walkthrough page, a signed install profile

## (1) Install showed the chooser while Settings showed the certificate

The two screens read the same thing (`signing.status` through the bridge): Install asks
`signingReady()` → `deviceStatus().identity`, and Settings' root row reads `st?.identity` too. So for one
status they couldn't disagree. Where they did differ is what the **Signing page** showed: the Certificate rows
(`certificateBlock`) took their names from the staged picks in memory (`p12Name`, `profileName`), which
`importIfComplete` kept after `signing.import` resolved. It also threw away the status that the import returned. So if the
import went through but `status()` then found no identity, the page still listed the .p12 and the profile as if
they were set up, and Install (going by the real status) found nothing and showed the chooser.

How the native side can end up there: `SignStore.importIdentity` treats `errSecDuplicateItem` from `SecItemAdd` as
"keep that one". When half of an earlier import is still in the Keychain (the certificate without its key, or the
other way round), the add reports a duplicate, nothing pairs up, and `SignStore.identity()`, which looks up
`kSecClassIdentity` by the saved certificate hash, comes back nil. `status()` then says `identity: null`. I couldn't reproduce this off
the phone (see Not verified). It fits the report, and nothing else in the path can make the two screens disagree.

Fixes, on both ends:
- `signing-client.js statusReady(status)`: one rule for "the Keychain holds a usable identity" (an identity object;
  also takes the status as JSON text). `signingReady()` and every place Settings shows the certificate (root row,
  the rows' names, the Keychain section, the walkthrough's step 1) use it, so they can't diverge again.
- `signingReady()` tries `signing.status` once more after 400 ms when the call fails, rather than falling back to the chooser
  on a single hiccup.
- Settings no longer shows staged names as if they were set up: a name stays on a row only while its file is picked, or when
  `statusReady` says the Keychain has it. `importIfComplete` checks the status the import answers. If it shows no
  identity, it alerts "Couldn't Import" with the reason and clears the picks.
- Native `SignBridge.confirmImport` (after `importIdentity`): if `SignStore.identity()` doesn't find what was just
  imported, delete whatever matches the certificate's public key hash (certificates by `kSecAttrPublicKeyHash`,
  keys by `kSecAttrApplicationLabel`) and the old label, add the identity again, and fail with a `keychain`
  error if it's still not found. `status()` adds `identityProblem` when a certificate hash is saved but no identity comes back.
- Node tests: `web/app/signing-client-ready.test.js` covers `statusReady` and `signingReady` over the real shapes
  (identity with profile and `revocation: null`, no name, no profile, trusted, JSON text, null identity, identityProblem,
  junk), the retry, and a bridge that's passed in.

## (2) The Signing page is a walkthrough

`web/app/screens/signing.js` + `web/app/signing.css` (the module links the CSS itself, so `index.html` is untouched).
In the sideload build, Settings > Signing (`#/settings/signing`, which Home's Signing tile already opens) is now four numbered,
collapsible steps, each with a green tick once done:
1. Import your certificate: the existing Browse rows (certificateBlock), and a mock of the file picker.
2. Download the install profile: Download Profile (`signing.trust`), and a mock of Safari's "allow this
   configuration profile" alert.
3. Install the profile: Settings > General > VPN & Device Management, and a mock of the Install Profile screen
   showing "Signed by <certificate name> Verified ✓" (or "Not Signed" before a certificate).
4. Trust its certificate: Settings > General > About > Certificate Trust Settings, and a mock with the CA's switch on.
Then **Check** (re-reads `signing.status` under a HUD and redraws with the ticks) and Test Install Server, with the
Keychain details and Remove Certificate below. The step states are pure (`stepStates`, tested in
`screens/signing.test.js`): 1 = `statusReady`, 2 = `trust.ca`, 3 and 4 = `trust.trusted`. iOS only tells an app whether it
trusts the CA, so installed-but-untrusted can't be told from not installed, and the page says that 3 and 4 tick
together. The first unfinished step opens by itself. The user's own expand/collapse taps are kept across redraws until
Check.

Pictures: our own iOS 6-style mock screens in HTML/CSS (nav bar gradient, pinstripes, grouped tables, the
UIAlertView, a pulsing ring around what to tap: opacity and transform only). There's no Apple artwork. There's a slot for
the user's own screenshots: `web/app/icons/signing/<step id>.png` (certificate, download, install, trust) replaces the drawing when the file exists.
Each slot is looked up once per session.
The site's Signing page (the server signer) is unchanged.

Shots from headless Chromium against a fake bridge (sideload mode): `step1-none.png`, `steps-open-ca-made.png`,
`all-done.png`.

## (3) The install profile is signed with the user's certificate

`native/sign/ProfileSign.swift`: an attached CMS SignedData over the .mobileconfig plist (content type, signing
time and message digest attributes; leaf plus its issuers in the certificate set; RSA or ECDSA per identity).
`signing.trust` signs the profile with the Keychain identity (`KeychainIdentity`, whose chain is Apple's WWDR CA and
root from `Cydian.app/certs/`) when there is one, and answers `{url, signed}`. With no certificate, or if signing
fails, the profile goes out unsigned as before. Swift test in `native/sign/tests/main.swift`, "install profile signed with the
user's certificate": `openssl cms -verify` checks the signature against the test CA, the content it hands back is the plist byte for byte,
the CMS holds the leaf and its CA, and with no identity there's no signature. Run through `native/test_sign.py`: all passed.

## Tried and dropped
- Headless Chromium doesn't advance CSS transitions under `--virtual-time-budget`, so the disclosure arrow looked unrotated in
  the shots. With transitions off it reads `rotate(90deg)`. The CSS is fine.

## Not verified
- **The root cause on the phone.** No iPhone running the sideload build is reachable from here (the 4S is iOS 6, jailbroken, and can't run it). The
  duplicate-Keychain-item explanation is reasoned from the code. If the user still sees the chooser after this, the page
  now says why (`identityProblem` on the walkthrough, or "Couldn't Import" with the Keychain's reason).
- `confirmImport`'s repair path (deleting by public key hash, then re-adding) runs only on iOS: Security.framework's Keychain isn't
  on Linux. The native build in the gate compiles it, but it hasn't run.
- That iOS shows the signed profile as **Verified** with the user's name: needs the phone and a real Apple
  certificate. The test proves the CMS verifies against the issuing CA, which is what iOS checks with WWDR.
- The walkthrough on a real iPhone (taps, the file picker, Safari round trip, Check after coming back) and in the dark
  theme. The shots are light theme only, at 375 px in Chromium.
