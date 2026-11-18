# B29: in-app install of an imported 42.7 MB IPA hangs at installing, then "Unable to Install"

The user's IPA: `~/Downloads/opentennis-beta-p146.ipa` (OpenTennis Beta 1.7.2, `io.github.fizl0.hst.beta`), 5 entries:
one 122.9 MB thin arm64 executable, an icon, an XML Info.plist. No `_CodeSignature`, no `embedded.mobileprovision`,
no PkgInfo, and **no LC_CODE_SIGNATURE at all** in the binary (it was linked unsigned); `LC_ENCRYPTION_INFO_64`
with cryptid 0; 12920 bytes of room after the load commands.

## Signing compared (no fault found)

- Signed it with the on-device signer (`native/sign/`, built on Linux with a driver around `IPASigner`, key from
  `web/app/core/fixtures/signing/test.p12`, wildcard `test.mobileprovision`) and with the website's zsign WASM
  (`runSignJob`, same p12 and profile) in node, then compared both with a Python dissector:
  - LC_CODE_SIGNATURE added the same way (at the end of the load commands, data at the 16-aligned end of
    `__LINKEDIT`, offset 0x753d050 in both), the same `__LINKEDIT` fileoff, a vmsize covering the new size.
  - CodeDirectory: identical shape (version 0x20400, SHA-256, 4 KiB pages, 30014 code slots, codeLimit = signature
    offset, 7 special slots, exec segment 0..112721920 with MAIN_BINARY). Every page hash verified; Info.plist (-1)
    and CodeResources (-3) slots match the files.
  - Entitlements identical (`application-identifier` TEAM.io.github.fizl0.hst.beta, team, keychain group,
    `get-task-allow` false), XML and DER both present.
  - Info.plist bundle ID unchanged (wildcard profile); CodeResources seals the same files (icon, profile; Info.plist
    in `files`).
  - Differences that don't matter for installing: zsign writes a designated requirement (184 bytes) where we write
    an empty requirement set (as every IPA we've installed so far), its CMS carries more certificates, and its zip
    has a `_CodeSignature/` directory entry.
- So the signature isn't the cause, as far as Linux can tell. iOS itself didn't check either copy (see Not verified).

## On the iPhone 7 (iOS 15.8.8): how iOS fetches a 43.7 MB IPA from 127.0.0.1

The phone runs the jailbreak build and has no Apple identity, so it can't run the sideload install itself. Instead:
our signed copy (test identity) served by a logging Python server on the desktop, put on the phone's
`127.0.0.1:47811` with `ssh -R`, and a real itms-services link to `https://sign.ifizbox.com/sign/manifest?...&port=47811`
opened with `tools/ui-7.sh` (lock B29), Install tapped.

- Plain run: `com.apple.appstored/1.0 iOS/15.8.8`: **HEAD, then one whole GET** (no Range), 43.7 MB in about a
  second. installd (`/var/installd/Library/Logs/MobileInstallation/mobile_installation.log.0`, sudo) then got as far
  as the identity: `0xe8008018 (The identity used to sign the executable is no longer valid.)`, i.e. it read our
  signature on this binary (built with no LC_CODE_SIGNATURE) and only refused the throwaway certificate. The Home
  screen placeholder sat at "Open..." with a cloud. Tapping it: **"Unable To Install ... This app cannot be
  installed because its integrity could not be verified."** That's iOS's wording for a signature failure. The
  user's alert was the generic **"Please try again later"**, which points at the transfer, not the signature.
- Run 2, the server drops the first GET after 20 MB: appstored **resumes with `Range: bytes=20971520-`** at once and
  takes the rest. So iOS does fetch an IPA in parts.
- The failed placeholder was deleted afterwards (long press, Delete App); the phone's Home screen is as before.

## The cause found: the install server stopped serving the IPA too early

`InstallServer.answer` called the route's `onServed` as soon as **any** request whose range reached the last byte
finished (`whole || r!.upperBound == size - 1`), and `Sideload.serveAndOpen`'s `end(true)` then **removed the route
at once** (only the file deletion waited out the minute). iOS's installer may fetch an IPA in parts (the Worker's
own `/sign/up` notes "iOS's installer may ask for parts"): the zip's end first, or a resume (`Range: bytes=N-`) after
a dropped connection. A big IPA makes both likelier. Either way the next request got **404**, and iOS's download
never finished: the page sat at "Installing" (B28's watch waits on iOS's progress), then iOS said "Unable to
Install. Please try again later." A small IPA fetched in one request never hit it, which fits "other IPAs work".
Also: `onServed` ran on Network.framework's `.contentProcessed` for the last chunk, i.e. once the bytes were handed to
the socket, not received; a connection lost in the last buffered bytes followed by iOS's resume got the 404 too.

**How sure:** the defect is real, and iOS's resume-by-Range (measured above) is the request that hits it. But in the
plain dropped-connection case the resume itself reaches the end and would have completed under the old code too, so
the 404 needs a tail read first, a second request after a completed one, or the lost-last-bytes case. Which one (if
any) happened on the user's iOS 27 phone isn't proven: the new install log shows every request and status, so the
next attempt says exactly what iOS asked for.

## The fix

- `native/sign/HTTP.swift`: `ByteCoverage`, the bytes of a file sent in full over all requests (merged ranges).
- `native/Sources/InstallServer.swift`: per path, each completed request adds its range; `onServed` fires once,
  when the coverage is the whole file. A path no longer served logs "iOS asked again ... 404" (the route's log is
  kept in `gone`). Each request is logged (method, Range, status, bytes), each completed one with "iOS has n of
  size bytes", and a connection cut short with how far it got. `Route` got a `log` and an explicit init.
- `native/Sources/Sideload.swift` `serveAndOpen`: the route stays through the grace after the IPA was fully
  served (`servedGrace`, 120 s, was a minute for the file only), removed with the file and KeepAlive at its end.
  Logs `Bundle ID: <chosen> (the app's own: <original>), version, serving <size>`.
- The server's lines arrive after `signing.install` / `library.install` has answered, and `bridge.js` drops stream
  events once a call has answered, so they'd never show. `InstallLog` (Sideload.swift) buffers them per bundle ID and
  `signing.progress` (the page's follow of iOS's install) attaches and emits them as `{log}` events. Also in NSLog.
- `native/Sources/MyIPAs.swift` `install` (the imported-IPA path the user hit) had no console log at all: it now
  passes one to `serveAndOpen` and says which signed copy and bundle ID it installs.
- Web: `installFromLibrary` (signing-client.js) shows `{log}` lines, as `installOnDevice` already did;
  `followInstall` (signing-sheet.js) shows them and returns before the progress code, so a log line can't reset
  B27's "mid-install" flag (it would have: `Number(undefined)` is NaN).

## Tests

- `native/sign/tests/main.swift` "B29: the IPA counts as served only once every byte went out": the 43.7 MB IPA's
  tail first (reaches the last byte, not served), a gap, then the rest; joins, repeats, an empty file.
- `native/test_install_server.py` (new): reads InstallServer.swift / Sideload.swift / MyIPAs.swift: the old
  last-byte trigger is gone, onServed only through `ByteCoverage`, the route removed only inside the grace, the logs
  wired to signing.progress and library.install.
- `web/app/install-log.test.js` (new): followInstall puts server lines on the console and a log after 40% doesn't
  end the follow (fails against the old signing-sheet.js: checked); installFromLibrary shows library.install's log.
- The native build (`make -C native package`, sideload IPA and .deb) compiles with the changes.

## Tried and failed

- A first `cutShort` closure written as `{ (left: UInt64) in route.log?(...) }` inferred `Void?` and didn't compile
  for iOS; typed it explicitly.

- My first stop of the logging server killed the subshell's pid, not Python's (`cd && python3 ... &`); found the
  listener with `ss -ltnp 'sport = :47811'` and stopped that pid. Later servers were started without the `cd`.

## Not verified

- **The fix on the user's phone (iOS 27, iPhone 18 Pro).** It needs their certificate and the new build; nothing
  here runs the sideload build's Swift (`InstallServer`, `Sideload`, `MyIPAs` need UIKit/Network, iOS only). They
  compile in the gate's native build; their logic is checked by reading the source (test_install_server.py) and
  `ByteCoverage` in Swift on Linux. Filed R19 to read the new install log from the user's next attempt.
- **That iOS 27 fetches the same way as iOS 15.8.8** (HEAD + one GET, Range resumes). Only iOS 15 was measured.
- **iOS accepting our signature on this binary with a real Apple identity.** iOS 15 got past the format and stopped
  at the throwaway identity; the CodeDirectory header is byte-identical to zsign's. A real install needs the user's
  certificate.
- **KeepAlive / beginBackgroundTask while iOS downloads with iFizBox in the background**: not reproduced (the iPhone 7
  can't run the sideload build). The iOS 15 download took about a second, far inside beginBackgroundTask's time, and
  the alert left the foreground app up.
- **Signing time and memory on the phone** for the 123 MB binary (Linux: 4 s with openssl as the key holder).
