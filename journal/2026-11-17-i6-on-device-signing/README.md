# I6: sign and install IPAs on the phone (sideload build)

## What I did

- **Researched the install step and picked one** (docs/signing.md, "On the phone (I6)"): itms-services wants an
  HTTPS manifest the phone trusts. I compared backloop.dev (published key, so a CA has to revoke it; its pack was
  already expired), a manifest from a server (palera1n's, or the user's own), a CA made on the phone, idevice
  pairing, and data/file URLs. **Picked the CA made on the phone.** Cydian makes an ECDSA P-256 root in the
  Keychain, name-constrained (critical) to `localhost` and `127.0.0.1/32`. The user installs it once as a
  .mobileconfig and turns on full trust. Cydian's loopback HTTPS server then uses a one-year leaf the CA issues. No
  private key is published or shared, so nothing has to be revoked, and no server is involved.
- **Signer: Cydian's own, in Swift (`native/sign/`), not zsign.** zsign needs the key as a file or bytes, and
  OpenSSL cross-compiled for iOS. With our own signer the key stays in Security.framework and signs through
  `SecKeyCreateSignature`. The signer covers:
  - Mach-O: the CodeDirectory (0x20400, SHA-256), an empty requirement set, XML and DER entitlements, and a CMS with
    the CDHashes and CDHashes2 attributes and Apple's WWDR chain, bundled as public `.cer` files from apple.com.
    Thin and fat binaries; an unsigned binary gets a new `LC_CODE_SIGNATURE`; encrypted binaries are refused.
  - Bundles are signed inside out, each with its CodeResources and `embedded.mobileprovision`, and with I5's
    bundle-ID and entitlement rules. An explicit profile drops the extensions.
  - Zip to zip: one hashing pass, and untouched entries are copied still compressed. ZIP64 is supported.
- **Phone half** (`native/Sources/`):
  - `SignStore.swift`: the `.p12` goes into the Keychain with `SecPKCS12Import` and `SecItemAdd`, ThisDeviceOnly.
    The password isn't kept. The profile is stored as a file. Also the local CA and TLS keys, and the trust check
    with `SecTrustEvaluateWithError`.
  - `InstallServer.swift`: an `NWListener` on loopback only. It serves TLS for the manifest and IPA, and plain HTTP
    only while it hands Safari the CA profile. It has random tokens, ranges, idle shutdown and a background task.
  - `SignBridge.swift`: `signing.status`, `.import`, `.remove`, `.trust`, `.resetTrust` and `.install` (with
    progress events). In jailbreak mode every call answers code `jailbreak`.
- **Wiring:**
  - `build.sh` compiles `sign/*.swift`, links `-lz` and copies `sign/certs/` into both bundles.
  - The bridging header includes `zlib.h`, and `Bridge.swift` registers `SignBridge`.
- **Tests:** `native/test_sign.py` builds the signer and `sign/tests/main.swift` for Linux and runs 13 Swift tests (12 when there is no built `native/build/Cydian.ipa`).
  It then reads the signed IPA again in Python. Details are in docs/signing.md, "Tests".
- **Follow-ups filed:**
  - F58: the web UI in sideload mode calls these bridge methods. I6's files are only `native/**` and the doc, so
    nothing in `web/app` calls them yet.
  - F59: the jailbreak helper installs IPAs.
  - F60 (later): a manifest endpoint on the user's own signing server, as the fallback.
  - F14 got a note about what is done and what's still open.

## Decisions (unattended)

- Own signer instead of cross-compiling zsign + OpenSSL. Reasons: the key never leaves the Keychain, the app has
  no new binary dependency, the gate needs no build of OpenSSL for iOS, and the same code is tested on Linux. The
  risk is that iOS rejects something zsign gets right. To lower that risk the format follows zsign and codesign
  closely, and rcodesign verifies the output.
- CodeResources seals nested bundles' files as plain files, as zsign does, not as Xcode's cdhash+requirement
  entries.
- SHA-256 CodeDirectory only, without the SHA-1 one: iOS 15+ is the target.
- The requirement set is empty, as ldid writes it. There is no designated requirement.
- The install server uses `127.0.0.1` in its URLs, not `localhost`. The certificate has both names.
- The password isn't stored at all. docs/sideload.md said "the password goes in the Keychain", but once the
  identity is in the Keychain the password has no use.
- No silent-audio keep-alive (F14's). The install relies on `beginBackgroundTask`.

## Tried and failed

- First compile: an escaping closure captured a non-escaping parameter in `ZipReader.read`, and one `try` was
  missing in a test. Both were fixed. After that every test passed on the first run, so I checked the output with
  an independent tool too: `rcodesign verify` reports "no problems detected", and `print-signature-info` reads the
  slots and the DER entitlements as intended.

## Not verified

- **Nothing ran on an iPhone.** The task's device check is the user's: sign and install a real app and report. It
  can't happen yet either, because the web UI doesn't call the native methods until F58 lands. Unknowns that only a
  phone answers:
  - whether iOS's installer accepts an itms-services manifest from `https://127.0.0.1:<port>` secured by a
    **user-installed, fully trusted root**. This is the crux of the chosen option. If not, F60 (option B) is the
    fallback;
  - whether iOS honours the CA's name constraints (if it ignores them, the trust still works, only the safety
    margin is lost);
  - whether a sideloaded app's `NWListener` on loopback with `sec_identity` works, and whether the Keychain pairs
    the leaf certificate with its key into a `SecIdentity`;
  - whether Safari offers to download the `.mobileconfig` from `http://127.0.0.1`;
  - whether iOS accepts the signatures: the empty requirement set, SHA-256 only, the CodeResources shape, and the
    WWDR chain picked by issuer. The signatures are checked with openssl and rcodesign only; neither is iOS.
- The Keychain code (`SecPKCS12Import`, `SecItemAdd` with an identity, the identity query, the deletes) compiles
  against the iOS 27.1 SDK but has never run.
- Real Apple certificates: the tests use a throwaway CA, so the WWDR chain lookup in `KeychainIdentity.issuers`
  is untested.
- Memory and speed on a big IPA: each Mach-O is held in memory while it's signed. Not measured.
- The 4 GB download cap and ZIP64 writing above 4 GB were not exercised. Only ZIP64 reading code exists for big
  archives, and none was tested.
