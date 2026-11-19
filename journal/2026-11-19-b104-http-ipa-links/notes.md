# B104 Plain-http IPA links in the sideload app

## The cause

Every IPA download in the app goes through URLSession (`Download` in SignBridge.swift, and `IPAInstall.session` in
the jailbreak app). The app has no ATS exception, so an `http://` link failed with iOS's own sentence ("…the App
Transport Security policy requires the use of a secure connection"). On the iPhone 7 I confirmed ATS applies to a
real hostname: `http://127-0-0-1.nip.io:8712/b.ipa` was refused.

## What changed

- `native/Sources/Sideload.swift`: `download(url, http:)` with `HTTPPolicy` (`ask`, `allow`, `fallback`). For an http
  link it downloads the https twin first (`httpsTwin`: same link, https, port 80 dropped; 20 s idle limit). If the
  twin fails (any error but cancelled, too_large or offline), it answers `insecure: …` (`ask`), or carries on over
  plain http (`fallback`). `allow` (the call's `insecure: true`) goes straight to F238's `PlainDownload`
  (Network.framework), so no ATS exception was needed and the WKWebView is unchanged. `HTTPChain` lets the job's
  Cancel stop whichever half is running. `signing.inspect` now uses `download` too, so it follows the same rules.
- Callers: `signing.install` and `signing.inspect` use the call's `insecure`. Re-sign (`resign`, and
  `signing.prepare {record}` in SignAhead.swift) uses `fallback`: the user already let that link through when it was
  installed (and before B104 an http link couldn't install at all, so no older record has one). `library.add`
  (MyIPAs.swift) uses `download` with the call's `insecure`.
- `native/Sources/SignBridge.swift`: `Download.start` takes an optional `timeout` (60 s as before), and
  `appTransportSecurityRequiresSecureConnection` answers `ats: …` (an https link that redirects to http) instead of
  iOS's text.
- `web/app/core/insecureipa.js` (new): `isHttpIpa`, `httpsTwin`, `INSECURE_IPA_ALERT` ("This Download Is Not Secure",
  the brief's words with `NAME`, Cancel `cancel: 0` / Install Anyway), `isInsecure`, `isAts` (code `ats` or iOS's
  English sentence from an older shell), `atsText`, `insecureText`.
- `web/app/signing-client.js`: `askInsecure(send, { alert, url })` sends once; on `insecure` it asks, then sends again
  with `{ insecure: true }`; Cancel rejects with code `cancelled`. It remembers links the user let through for the
  session, so Custom Install's look and then the queue's `signing.prepare` of the same link ask only once. Wired into
  `installOnDevice` (signing.install; Cancel hides the page, no error alert), `prepareOnDevice` (the IPA queue: Cancel
  ends the row as cancelled), and `libraryCall("add")` (My IPAs' Download from URL).
- `web/app/signing-sheet.js`: both `signing.inspect` calls (Custom Install, and Custom Install to the queue) go through
  `askInsecure`; Cancel closes quietly.
- `web/app/screens/myipas.js`: Download from URL says nothing after Cancel.
- `web/app/core/signing.js deviceError`: `insecure` where nothing asked (share.js's `library.add`) and any ATS
  refusal get our words. `web/app/core/ipainstall.js ipaError` does the same for the jailbreak app.
- Where this covers the brief's ways in: Install IPAs' Download from URL (`library.add`), `ifizbox://install`
  (incoming.js `confirmInstall` → `signAndInstall` → `installOnDevice`), and My IPAs and app pages from http sources
  (Install → `installOnDevice` or the IPA queue's `signing.prepare`; Custom Install → `signing.inspect`). incoming.js
  and screens/ipa-install.js didn't need changes: every path ends in one of those calls.
- `docs/signing.md`: a "Plain http IPA links" section.

## Tests

- `web/app/core/insecureipa.test.js`: the URL rules (which links are http, the twin, port 80, other ports kept), the
  alert's words and buttons, `isAts` against iOS's sentence and against an unrelated TLS error, deviceError and
  ipaError never passing iOS's text through.
- `web/app/signing-client-insecure.test.js`: askInsecure (twin worked: no alert; Install Anyway: second call with
  `insecure: true`; Cancel: `cancelled`, no second call; other errors pass through; one approval per session). Then
  every way in against a fake bridge: Install (Install Anyway installs, Cancel hides the page with no error alert),
  `ats` showing our words, the queue's `signing.prepare`, My IPAs' `library.add`, and Custom Install's
  `signing.inspect`.
- `node --test web/app`: 1858 pass. `make -C native package` builds the .deb and the IPA. Native Python tests pass.

## On the iPhone 7 (jailbreak build 0.9.9-1959, from this branch)

The test IPA (`testkit.ipa`, bundle `dev.ifizbox.b104test`, only downloaded, never installed) was served with
`python3 -m http.server 8712 --bind 127.0.0.1` through `ssh -N -R 8712:127.0.0.1:8712 7`. Both are stopped, the
file is deleted from `/var/mobile/Documents`, and the .deb from `/tmp`.

- `iphone7-ats-message.png`: `ifizbox://install?url=http://127-0-0-1.nip.io:8712/b.ipa` in the jailbreak app
  (ipa.install, still URLSession) now shows "Download Not Secure" in our words, not iOS's. I changed the wording after
  this shot: the "or start from the http link itself" ending was wrong when the link is already http. It now reads
  "its link is, or leads to, a plain http address, which iOS blocks here. Ask for an https link to the IPA."
- `iphone7-not-secure-alert.png`: Install IPAs > Download from URL, `http://localtest.me:8712/b.ipa`. The server log
  shows the https try (a TLS hello answered 400), then the alert.
- `iphone7-install-anyway-added.png`: Install Anyway. The server log shows a plain `GET /b.ipa` (PlainDownload), and
  BTest (912 bytes) is in My IPAs.

## Follow-up filed

- B113: the jailbreak app's `ipa.install` still can't download an http IPA at all (it now says why in our words).
  It needs the same twin, alert and PlainDownload in Apt.swift's IPAInstall.

## Not verified

- **signing.install, signing.inspect and signing.prepare with an http link on a phone.** The only phone I can test on
  is the iPhone 7, and it runs the jailbreak build, where every `signing.*` call is refused. Installing the sideload
  IPA there would replace the jailbreak app (same bundle ID). These calls use the same `Sideload.download` that
  `library.add` used in the phone test, and fake-bridge tests cover how the page handles them, but the full sideload
  Install from an http link (sign, then serve to iOS) has not run on a device.
- **An https link that redirects to http** (the `ats:` answer from `Download`) on a phone. The ATS refusal itself was
  seen on the 7 through ipa.install's URLSession, and the JS mapping is tested, but `Download`'s new branch wasn't
  triggered on a device.
- **The twin's 20 s limit against a host whose port 443 hangs** (BigBoss-style): not timed. On the test server the
  twin failed at once (TLS to a plain HTTP port).
- **Re-sign of an app installed with Install Anyway** (the `fallback` policy): not run anywhere; it needs a sideload
  phone.
- **The alert over the progress page:** on the phone, the Downloading HUD stays dimmed behind the alert (see the
  shot). That's the only path I saw; the sideload Install's full progress page behind it wasn't seen.
- **Non-English iOS:** the native `ats` code handles any language, but a shell older than this one gives iOS's raw
  text, and `isAts` matches only the English sentence.
