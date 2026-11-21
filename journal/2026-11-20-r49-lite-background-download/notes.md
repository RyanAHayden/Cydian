# R49: Lite IPA download in the background

Question: does the sideload build's IPA download (`Sideload.download`, a plain `URLSessionConfiguration.default`
download task) stop once iOS suspends iFizBox? Answer: **yes, and it fails**. So KeepAlive is now held from the
start of `Sideload.download` to its `finished` (the B223 change, back in).

## How it was timed

iPhone 15 Pro (iOS 27, Wi-Fi), driven through `tools/ui-15.sh` under the R49 lock. `signing.inspect` called from the
app's web view through `pymobiledevice3 webinspector cdp`, with every `{progress}` event timestamped in JS
(`Date.now()` from the call). The file: ollama v0.12.0 `ollama-linux-amd64.tgz` from GitHub releases,
1,908,839,322 bytes (a 302 to release-assets, as an IPA link is); inspect downloads it, then answers "not a zip
file", which is all the timing needs. Home about 2 to 3 s after the call, the app launched again 50 s later.
Suspension read from the phone's syslog (`ios syslog`, runningboardd's "Calculated state" lines).

## Results

| Build (0.17.3 build 3159) | What happened |
| --- | --- |
| main, no KeepAlive in the download | Home at 20:27:08; progress kept coming until 32 % at 18 s; runningboardd: `running-suspended` at 20:27:24 (16 s after Home, not the 30 s B223 assumed). Back at 20:27:58: the call failed at once with "The network connection was lost." (the QUIC connections were cancelled on resume). The download does not pick up again: it is lost. |
| this branch, KeepAlive held during the download | Home at 3.3 s; progress every ~0.5 s all the way through, 10 % per ~5.2 s (about 36 MB/s); 100 % at 53.2 s, before the app came back; iFizBox stayed `running-active` in syslog the whole time. |
| this branch, Safari in front playing an mp3, then iFizBox started the download and Safari was brought back | Safari's player: 00:02 before, 00:30 and 00:41 during, 01:34 after the download ended (55 s) and KeepAlive let go; each step matched the wall clock, so playback never stopped or paused, neither when KeepAlive began nor when it ended (`.mixWithOthers`, `setActive(false, .notifyOthersOnDeactivation)`). The download also finished with Safari in front (100 % at 54.9 s). |

## What changed

`native/Sources/Sideload.swift` `download(_:http:emit:done:)`: `KeepAlive.shared.begin()` at the start, and
`KeepAlive.shared.end()` once (a `Once`) in `finished`, which every path reaches: success, failure, the https-twin
chain's fallback, too-large and Cancel (`Download.finish` and `PlainDownload` both call `done` once). Inspect,
Install, Re-sign, the queue's `signing.prepare` (SignAhead.swift) and My IPAs' add-from-link (MyIPAs.swift) all
download through it.

## Tried and failed

- Apple Music as the music source: the app on the 15 Pro was never set up (its What's New sheet, no library), so
  Safari playing a public mp3 (SoundHelix test song) stood in for "music". Left paused at 01:46.

## Not verified

- Apple Music (or Spotify) itself was not tried, only Safari's media player: it uses the same shared audio session
  rules (another app's playback session), so `.mixWithOthers` should behave the same, but that's an inference.
- Cellular: the 15 Pro has no SIM, Wi-Fi only.
- A download longer than a few minutes in the background (e.g. a slow link): not tried; KeepAlive has no time
  limit of its own, so nothing here expects a cut-off, but only ~50 s were watched.
- The jailbreak build: not tested on the 7. `signing.*` is refused there; if My IPAs' `library.*` reaches
  `Sideload.download` in that build, KeepAlive plays its silent loop, which without the `audio` background mode
  (only the sideload build's Info-sideload.plist has it) keeps nothing alive but does no harm either.
- Left on the phone: iFizBox is this branch's build (0.17.3 build 3159) until the next install; Safari has the
  SoundHelix mp3 tab open, paused.
