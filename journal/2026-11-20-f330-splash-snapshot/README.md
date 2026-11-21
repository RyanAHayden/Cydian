# F330: themed splash by writing SplashBoard snapshots

Built on R46's Simulator findings (`journal/2026-11-20-b203-themed-splash/sim-notes.md`, section 3).

## What was built

`native/Sources/Launch.swift`, `enum Snapshot`:

- **Who:** the IPA on every iOS, and the jailbreak build from iOS 16 (`Snapshot.used`). `Splash.follow` hands over
  to it before the helper's bundle copy, so on iOS 16+ the jailbreak build no longer copies the bundle or clears
  snapshots (R46: on iOS 26 that gives a black, denylisted splash or the old theme until a respring). The jailbreak
  build on iOS 15 keeps B203's bundle copy unchanged.
- **When:** every `app.theme` (`Theme.apply` -> `Splash.follow`): the page sends one at every launch and at every
  theme or appearance change.
- **What:** the `.ktx` files under `Library/SplashBoard/Snapshots/` entries named for the bundle ID (the same names
  `clearSnapshots` matches). The theme's frame is rendered from `LaunchThemes/<key>/LaunchScreen.storyboardc`,
  laid out on the app window (so it gets the real safe areas), drawn with `layer.render(in:)` at the screen's scale
  and removed in the same run-loop turn, so it is never committed to the screen. Written with ImageIO
  `com.apple.atx` in place, as R46's harness did.
- **Light/dark mapping:** decided here (R46 left it open). A file iOS drew is classified by sampling it at 8x8:
  plain white (all samples > 0.9 luma, spread < 0.08) is light, plain black (< 0.1) is dark, anything else unknown.
  The IPA's neutral splash is exactly white or black, so its files classify. The tone is recorded per file in
  UserDefaults `ifizbox.splashSnapshots` with the file's size and date as written; while those match, the file is
  ours and keeps its tone. A file iOS rewrites (install, update, reaped) no longer matches and is classified again.
  Unknown tone (the jailbreak build's files, drawn from its Classic bundle storyboard in both appearances, or an
  unreadable file) gets the theme of the iPhone's appearance at write time, and is rewritten when that changes.
- **Skips:** a file already holding the wanted key (same stamp) is not rewritten, so a launch costs a listing and
  two `stat`s; a file whose pixel size differs from the render is left alone; nothing happens if ImageIO lists no
  `com.apple.atx` destination or the theme has no set (`Splash.key`).

Why not keep the bundle copy as a fallback on iOS 16+ when no snapshots exist: if the jailbreak doesn't bypass
SplashBoard's resource check, regenerating from a modified bundle is what denylisted the app on the Simulator.
A Classic splash with the themed cover is the safer failure than a black splash.

`docs/native.md` ("Launch screen") describes the snapshot route. `native/test_splash_snapshot.py` pins the
contract in the source (Swift doesn't run on Linux).

## Phone check (iPhone 15 Pro, iOS 27, sideloaded IPA, ad hoc signed via `tools/ui-15.sh install`)

Theme on the phone: Automatic, Classic light, Gunmetal dark; iPhone in dark appearance.

- **The sandbox allows it.** The container is readable over house_arrest
  (`ios fsync --app=com.ryha.ifizbox tree|pull`), which gave the evidence below without any app-side logging (the
  app's `NSLog` lines never showed in `ios syslog`).
- **Light/dark mapping is right.** SplashBoard logs each file it generates with its style
  (`Image generation complete for: … userInterfaceStyle: Dark` and then `written to file: …/<UUID>@3x.ktx`). Twice
  (after the install, and again after an update gave new file names), the file SplashBoard called Dark was the one
  the app classified `dark` and wrote with `gunmetal`, and the Light one became `light`/`classic` (the record in
  the pulled `Library/Preferences/com.ryha.ifizbox.plist`).
- **The next launch shows the theme.** For a visual check I built a throwaway IPA that sleeps 3 s at the start of
  `scene(_:willConnectTo:)` (never committed), so iOS's splash stays up before the app has a window and the cover
  can't be on screen yet. `first-launch-after-update.png`: the first launch after the update is iOS's plain black,
  because iOS drew new files and the app hadn't written them yet. `second-launch.png`: the next launch's splash is
  the Gunmetal frame (nav bar, dark pinstripes, tab bar), zoom-in animation included. The colours match the page's
  bars and ground.
- SplashBoard accepted the written files: after the app's writes there was no `Deleting snapshots` and no
  regeneration until the app update, and no `bad launch image` or denylist line.
- **Bug found and fixed on the phone:** the first build also wrote over `Snapshots/sceneID:com.ryha.ifizbox-default/`,
  which holds the app switcher's pictures of the last screen (SplashBoard calls them `SceneContent`, and reaps
  them when they expire). `Snapshot.files` now takes only the `<bundle ID> - {DEFAULT GROUP}` entry.
- The phone was left with the normal build (without the pause) installed.

## Spec review

Nothing to fix. Answers to its points:
- Render appearance: the theme's storyboard colours are fixed per theme (make.py writes literal `UIColor`s into
  the nib), so the window's appearance doesn't change the render.
- `Splash.follow` ignores its arguments and reads `Theme.saved`: `Theme.apply` saves before it calls in, and
  per-tone keys need the style, which those arguments don't carry.
- Unknown tone in Automatic, a reset record, and overwriting a file whose size can't be read: these trade-offs are
  written above. R46 overwrote without reading the size, and that worked.

## Not verified

- **The jailbreak build on iOS 16+**: there's no jailbroken iOS 16+ phone here. It's unknown whether SplashBoard
  keeps snapshots for an app in `/var/jb/Applications`, and whether they live under mobile's
  `Library/SplashBoard/Snapshots/<id> - {DEFAULT GROUP}/` as assumed. If it keeps none, that build now opens on the
  bundle's Classic splash (no copy on 16+), followed by the themed cover.
- **The jailbreak build on iOS 15 (iPhone 7)**: the code path is unchanged (`Snapshot.used` is false there), but it
  wasn't run on the 7 in this task.
- **A light-appearance launch on screen**: only the dark tone was seen as a splash. The light file's mapping and
  write were checked through the log and the record, not by a light-appearance screenshot.
- **A theme change followed by a relaunch** (as opposed to the write after an install or update): it's the same
  code path, triggered by a different `app.theme`, and wasn't run separately.
- **Other screen sizes**: only the 15 Pro (1179x2556) was checked.
- **The MBA Simulator**: unreachable (`ssh mba`: connection timed out). The phone covered it.
