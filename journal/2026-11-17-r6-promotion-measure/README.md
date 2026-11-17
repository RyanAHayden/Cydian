# R6: measure the R3 spike on a ProMotion phone (blocked: needs the user)

Unattended run. The task needs a person holding the iPhone 15 Pro, so it was blocked rather than faked.

## What I checked (2026-11-17)
- `idevice_id -l`: "Unable to retrieve device list!". No iPhone attached over USB, and usbmuxd sees none.
- `sidedrop` isn't on PATH, so the IPA can't be signed here.
- No Swift toolchain on this machine: no `swiftc` on PATH, `~/swift-6.4.2` (the path in `native/spike/README.md`)
  is gone, and nothing under `~` to depth 4. The iOS SDK is still at `~/.local/share/hst-ios/iPhoneOS.sdk`.
  I didn't download a toolchain (about 1 GB) because without the phone the IPA can't be used anyway.
- `docs/native.md` is unchanged: there are no numbers to paste, and the choice of A stays as R3 left it.

## What unblocks it (the user, about 15 minutes)
1. Put a swift.org 6.4.x Linux toolchain back (e.g. `~/swift-6.4.2`), then
   `SWIFT_TOOLCHAIN=~/swift-6.4.2 native/spike/build.sh` → `native/spike/build/CydianSpike.ipa`.
2. Sign it with sidedrop and install it on the iPhone 15 Pro.
3. Run the menu's protocol for spike A and spike B, each with the 60 fps switch on and off, then open the probe page.
4. Paste the Results table and the probe JSON into `docs/native.md` under "R3 answers". Keep A, or revisit it if B
   is clearly smoother at 120 Hz.

## Not verified
- All of it: the build, signing, install, frame-time measurements and probe JSON. No device, no signer and no
  toolchain were available in an unattended run.
