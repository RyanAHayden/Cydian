# R46: B203's splash on iOS 26 (Simulator)

Findings: `journal/2026-11-20-b203-themed-splash/sim-notes.md`. In short:

- iOS 26 caches the splash as two snapshot files per app. B203's jailbreak route, copying the theme over the
  bundle, never shows on its own. With `clearSnapshots`, SplashBoard's code-signature check denylists the app
  (black splash). Re-signing avoids the denylist, but the old theme stays until a respring.
- The IPA's neutral splash is white / black as intended, but the status bar is white on white in light mode (B212).
- A sideloaded app **can** swap its own snapshot: writing the theme cover as ImageIO `com.apple.atx` over its
  `Library/SplashBoard/Snapshots/*.ktx` showed that theme on the next launch, in the same boot (F330).

No product change.

## What I did

The brief named B180's `sim/run.sh`. I extended its app and steps into a new `sim/` here rather than changing
B180's journal. It uses the same build, install and screenshot approach on the same simulators.

- `sim/main.swift`: B180's harness app plus B203's `Bundle(path:)` cover (`cover <key>`), a tree dump and in-place
  copy into its own snapshots (`snap`), a wipe of `Library/SplashBoard` (`wipe`), and the ATX write of the cover
  (`cover <key> atx`). It holds the system splash for 10 s.
- `sim/r46.sh`: `build` (JB.app like the .deb, Lite.app like the IPA), `jb`, `jb2 resign|symlink <id>`, `jb3`,
  `jb4`, `lite`, `swap`, `atx`, `log`. To rerun: copy `sim/*`, `native/launch/Launch*@?x.png`,
  `LaunchScreen.storyboardc`, `native/launch/themes/` and `web/app/` without `app.js` into one folder (`web/`)
  on the Mac, then `bash r46.sh build`, then the steps. Shots go to `out/`. They aren't committed, because they
  carry iOS's status bar.
- The MBA is under load and sometimes drops off ssh, so each run went through `nohup` on the Mac and was polled.

## Tried and failed / adjusted

- First runs held the splash only 6 s with one shot at 3 s. Under load the "late" shots were still the splash,
  which I first misread. The hold is now 10 s, with shots at ~3, ~7 and ~15 s.
- `jb`'s first clear denylisted `com.example.r46jb1`. Every later variant used a fresh ID.
- Symlinks out of the bundle: installd refuses them at install. Made in the installed copy instead.

## Left behind

On the MBA: `~/r46sim` (harness copy, shots), the test apps `com.example.r46*` on the iPhone 17 simulator. I didn't
delete them: this run deletes only inside its worktree.

## Not verified

- **Anything on a real phone**: no jailbroken iOS 16+ phone, and no sideloaded build I may run (the 7 runs the
  .deb under the same ID, and the 15 Pro was not used, since this was a Simulator task). So these are unchecked: the
  sandbox letting an app write its own snapshot files, a device's SplashBoard accepting an app-written ATX, and
  whether a jailbreak bypasses the resource validation.
- **Respring with the symlink variant**: only the re-sign variant was rebooted after clearing.
- **Which snapshot file is light and which dark**: SpringBoard's manifest isn't in the app's container. The test
  wrote the same frame to both.
- **Other screen shapes** (16e notch, SE): only the iPhone 17. B180 covered the storyboard's geometry there.
- **Other themes in the snapshot route**: Gunmetal, Classic and OLED Black only. Midnight and Sepia were tried in
  `jb4` but never showed, because of the cache described above.
