# B223: Lite IPA download speed

The report: on the iPhone 15 Pro, OpenTennis (41 MB, a GitHub release URL) sat on "Downloading OpenTennis
41.0 MB" with the bar barely moving.

## Where the download goes

The queue run (core/apprun.js startSign, signing/queue.js prepareOnDevice) calls the shell's `signing.prepare`
(SignAhead.swift), which calls `Sideload.download` and then `Download` (SignBridge.swift): one URLSession
`downloadTask` straight from the phone, on `URLSessionConfiguration.default` (not ephemeral), delegate on its own
queue, progress throttled to whole percents (`Throttle`) and sent to the page with `emitOnMain`. The look-first sheet
(`signing.inspect`) and Install (`signing.install`) use the same `Sideload.download`. Nothing goes through
`/api/fetch`, the Signing Server or Tailscale: the page's hooked `ifizboxNative.call` log shows no `net.fetch` for the
IPA, only `signing.prepare`. GitHub's 302 to release-assets.githubusercontent.com is followed inside URLSession.
Hashing (IPAHash) and the signer's read pass run after the download on `SignBridge.queue`, not on the main thread.

## Numbers (2026-11-20, same Wi-Fi, the 15 Pro on USB, installed build 0.17.3)

| What | Time for opentennis-ios.ipa (43,027,170 bytes) |
| --- | --- |
| Desktop `curl -L` (baseline) | 1.15 s total (redirect 0.23 s, first byte 0.31 s), 37 MB/s |
| 15 Pro, `signing.inspect` from the web inspector | first progress 333 ms, 100% at 1217 ms, answer at 1404 ms |
| 15 Pro, two `signing.prepare` at once (the run signs 2 ahead) | both downloads done at ~2.0 s, both signed by 3.0 / 3.9 s |
| 15 Pro, the real UI: OpenTennis > Install > Confirm | Downloading 1.1 s (24.2 s to 25.0 s on the hook's clock), signed at +2.1 s, iOS's Install prompt at +2.3 s after Confirm |
| 15 Pro, Safari, same URL | the download indicator was full in the first screenshot after Download, about 1 to 2 s (screenshot resolution) |
| 15 Pro, 1.68 GB GitHub asset through `signing.inspect`, Home pressed for 15 s mid-way | 43.2 s (39 MB/s); progress kept its pace while iFizBox was in the background |

So on this phone and network the app's download runs at line speed, the same as curl and Safari. None of the
suspects in the brief shows up: no proxy, no small chunks, no main-thread work, no ephemeral session, no serial
queue holding the second app, no stall when iFizBox goes to the background for 15 s.

## What changed

The Log's "Downloaded 43 MB" line now says the time and rate: "Downloaded 43 MB in 1.1 s, 39 MB/s"
(`Sideload.downloaded`, used by Install, Re-sign All and the queue's `signing.prepare`). If the user sees a slow
download again, the run's Log tells straight away whether the bytes came slowly (the network) or something else
held the row on Downloading.

Tried, then taken out after the spec review (not asked, and not shown to matter against the old build): holding
`KeepAlive` (silent audio) for the length of `Sideload.download`, so a download keeps going in the background as
Safari's does. Filed as R49 with how to check it. The background row below was measured with it in.

All phone work held the `tools/ui-15.sh` lock (B223) and drove the screen through it; timings came from the app's
web view through `pymobiledevice3 webinspector cdp` (port 9351).

After, the new build (0.17.3 build 3092 from this branch) on the 15 Pro:

| What | Time |
| --- | --- |
| `signing.prepare` of opentennis-ios.ipa, three runs | "Downloaded 43 MB in 1.5 s, 28.7 MB/s", "in 1.1 s, 39 MB/s", "in 1.2 s, 37.1 MB/s"; signed copy ready at 2.0 to 2.5 s |
| 1.68 GB asset, Home pressed at 3 s, back at 57.6 s (build with KeepAlive, since taken out) | 100% at 43.9 s, the whole download after the first 3 s done in the background, at an even ~38 MB/s |

## Left on the phone

- iFizBox is this branch's build (0.17.3, build 3092) until the next install.
- Safari's test download, opentennis-ios.ipa, is in Files > Downloads. OpenTennis itself was not installed (iOS's
  prompt cancelled); the test's signed copies were discarded.

## Tried and failed

- Cloudflare's speed-test URL (`speed.cloudflare.com/__down`) as a big test file: it answers 403 to the app. Used a
  1.68 GB GitHub release asset (ollama-linux-amd64.tgz) instead; `signing.inspect` downloads it, then fails "not a
  zip file" and deletes it, which is all the timing needed.
- Port 9333 for the web inspector was taken by another session's server; used 9351.

## Not verified

- The user's own slow case was not reproduced: every run here took 1 to 2 s. Its cause (the network the phone was on
  at the time, most likely) is unknown; the new Log line is there to tell next time.
- Whether a download stops after about 30 s in the background without KeepAlive was not tried (the old build was
  only tried for 15 s, where it kept going): R49.
- The committed build (Log line only, KeepAlive out) was not installed on the phone again; the line itself was seen
  on the phone in the build that had both, and the KeepAlive removal is the revert of a separate block.
- Cellular: the 15 Pro has no SIM (status bar "SOS"), so only Wi-Fi was timed.
- Safari's time is from screenshots, about 1 s resolution.
