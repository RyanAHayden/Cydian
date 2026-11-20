# R45 Paid tweaks on the sideload IPA: what could be checked without a phone

The brief: on the sideload IPA, a paid Chariz tweak (betterAlarm, priced FREE) signs in to Chariz, downloads through
authorize_download + paid.download, and injects into a signed app; re-sign uses the kept .deb
(Application Support/PaidTweaks); the package page's Add to an App group shows Price / Sign In / Buy. F308 built it
with no Swift build and no phone.

## What I did

1. **Swift build**: `make -C native ipa` on this PC (the toolchain is here: `native/build.sh --probe` exits 0). It built
   `native/build/iFizBox.ipa` (0.17.0 (2759), 17 MB) with no errors and no warnings, so F308's `PaidTweaks`
   (native/Sources/Paid.swift) compiles and links (`PaidTweaks` type metadata is in the executable). Not run.
2. **Chariz live, unauthenticated** (curl, then `chariz.mjs` here, which drives iFizBox's own core/payment.js client
   with real `fetch`):
   - `https://repo.chariz.com/payment_endpoint` -> `https://chariz.com/api/sileo/`; `GET info` parses (name Chariz).
   - betterAlarm is `com.noisyflake.betteralarm`, latest 1.4.1 for both `iphoneos-arm` and `iphoneos-arm64`, tagged
     `cydia::commercial`, Depends `mobilesubstrate, firmware (>= 14.0), preferenceloader`.
   - `POST package/com.noisyflake.betteralarm/info` signed out (and as GET): `{"price":"FREE","purchased":true,
     "available":true}`. So the "FREE + purchased" case F308 tested is exactly what Chariz answers, even signed out.
   - `POST .../authorize_download` with **no token** and a made-up UDID (`{udid, device, version, repo,
     architecture}`) -> `{"url": "https://chariz.nyc3.digitaloceanspaces.com/…betteralarm_1.4.1_iphoneos-arm64.deb?
     X-Amz-…&X-Amz-Expires=60…"}`: a presigned S3-style URL good for 60 s. Fetching it: HTTP 200, **no redirects**,
     295154 bytes, starts `!<arch>` (paid.download's check passes, well under its 64 MB cap). So the UDID question
     F308 left open is answered for FREE packages: Chariz doesn't check it at all.
   - iFizBox, signed out, on that same answer: `paidTweakDeb` -> `PaidNeeded(signin, FREE)`, and the client's
     `authorizeDownload` refuses itself ("no token (sign in first)"). So the IPA asks for a Chariz sign-in that Chariz
     doesn't need for a free tweak. Not a bug in the sign-in path, just a needless step: filed as **F318** (low).
3. **The real betterAlarm .deb through iFizBox's tweak code** (core/tweaks.js `unpackDeb`, `prepareTweaks`): its data
   is `data.tar.lzma`, which unpack.js reads. One file to inject, `Frameworks/BetterAlarm.dylib` (239536 bytes);
   `Library/PreferenceBundles/BetterAlarm.bundle` and the PreferenceLoader plist are ignored (so its settings pane
   won't exist in a sideloaded Clock app: expected, the app has no Settings host). `missing: ["CydiaSubstrate"]`,
   which is the ElleKit case F295's bundled ElleKit fills in the real add flow.
4. **Package page group** (`group.mjs` here): renders `worksInGroup` with a tiny fake DOM, F308's fake shell in
   sideload mode and its fake vendor, then taps through. For FREE and for $1.99:
   - signed out: `Price | Free` (or `$1.99`), `[tap] Sign In to Fake Vendor`, footer "Sold by Fake Vendor. Sign in to
     buy it, or to add it if you already have."
   - after Sign In: `Price`, `[tap] Buy for Free` / `Buy for $1.99`, footer "Sold by … Once bought, it goes into an
     app you sign here."
   - after Buy: `Works In | com.me.fixture`, `[tap] Add to App…` (the kept .deb was downloaded and inspected).
   (The fake vendor answers purchased:false for FREE, so it shows a Buy for Free step that Chariz would skip.)

## Tried and failed

- First `group.mjs` run: the fake vendor had no `version`, so the stanza's version was undefined and the fake shell's
  paid.download refused it ("bad_url: not a package name or version") after Buy. Gave the vendor version 1.0; the
  refusal itself is the shell's name/version guard doing its job.

## Not verified

- **Anything on a phone**: the IPA was built but not installed. No sideload phone is in reach of an unattended run
  (the iPhone 7 runs the jailbreak .deb; the user's iPhone 15/18 Pro are theirs; the MBA answers but has no phone on
  it and a free Personal Team), and the steps need a person's Chariz sign-in. So these are unchecked: the real
  Chariz sign-in through auth.session on the IPA; paid.download writing `Application Support/PaidTweaks/
  com.noisyflake.betteralarm_1.4.1.deb` on iOS; injecting into a signed app and the tweak loading (with ElleKit);
  re-signing that app reading the kept .deb instead of asking Chariz again; and how the Add to an App group looks
  (the check above is text and taps, not pixels).
- **Signed-in authorize_download** on Chariz with a real token: not tried (no account). Tokenless works, so a token
  is unlikely to make it fail, but not seen.
- **Paid (non-FREE) Chariz tweak**: no bought one to try.
