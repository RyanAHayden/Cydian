# F15: idevice install route ("Install on this iPhone, no server"), first part

## What F15 delivers here

The engine and the build, not the screens:

- `native/sideload/idevice/build.sh` builds idevice (github.com/jkcoxson/idevice, MIT, Jackson Coxson) **from source
  on Linux** for `aarch64-apple-ios` (deployment target 15.0): `native/build/idevice/lib/libidevice_ffi.a` plus
  `include/idevice.h` and a module map (`import IDeviceFFI`). Upstream's `IDevice.xcframework` is a Mac-made binary
  download; this is the same static library from a pinned commit (`pin.env`: 2dca9a5, v0.1.68-14, 2026-11-16),
  `cargo build --locked`, so the corresponding source is that commit. It skips itself when the stamp (commit +
  features) matches, so `native/build.sh` calls it on every build. The first build fetches git + crates (network).
  Source and `target/` (~700 MB) live in one per-user cache (`~/.cache/ifizbox/idevice`, `IFIZBOX_IDEVICE_CACHE`)
  under `flock`, keyed by the stamp's hash, so the slots' worktrees don't each rebuild it; a worktree only copies
  the finished `.a` (cargo rebuild there: ~16 s on this machine once crates are downloaded).
- Size: the app executable went from 1.9 MB (main, same day) to 6.9 MB with idevice linked (dead_strip on).
- Features: `ring,tcp,afc,installation_proxy,heartbeat,rsd,remote_pairing,core_device_proxy,tunnel_tcp_stack`.
  `ring`, not upstream's default `aws-lc`: aws-lc wants cmake and a Mac toolchain to cross-build.
- Cross-building needed: clang as cargo's linker driving rustup's `ld64.lld` against `IOS_SDK` (the crates also
  build cdylibs, and gcc as `cc` rejects `-target`), `CC_aarch64_apple_ios=clang` with `-isysroot` for ring's C.
- `IDevice.swift`: pairing in the Keychain (`ifizbox.idevice.pairing`, this device only, one at a time);
  `importPairing` (lockdown record with `HostCertificate`, else a RemotePairing file, each checked by idevice);
  `pairOnPhone` (iOS 27: `pairable_host_accept`, shows the 6-digit code, cancellable); `Session` connects to
  10.7.0.1 (LocalDevVPN) by RPPairing on 49152 + RSD for a RemotePairing pairing, or TCP lockdown on 62078 +
  heartbeat for an imported lockdown record; `install(ipa, progress:)` uploads to `/PublicStaging/<uuid>.ipa` in
  1 MiB AFC writes (upload progress), then `installation_proxy_install_with_callback` (install progress), then
  removes the staged file.
- `VPNCheck.swift`: generic "another VPN is on": a TCP probe of 10.7.0.1 (49152, then 62078; connect or refused
  both mean LocalDevVPN routes it) and the `utun*/ipsec*/ppp*` interfaces up with IPv4.
- `IDeviceBridge.swift`: `idevice.status/vpn/import/pair/pairCancel/verify/forget/openLocalDevVPN`, sideload build
  only, on one serial queue (one connection to the phone at a time). Registered from `SignBridge.register`.
- `native/build.sh`: probes for the Rust side, builds it, compiles `sideload/idevice/*.swift` with
  `-I build/idevice/include`, links `-lidevice_ffi -liconv`. One executable for both builds, so the jailbreak
  .deb carries it too (its bridge calls refuse there).
- `test_idevice.py` (in the gate): the pin, the feature set, the build wiring, every listed bridge call
  registered, the jailbreak refusal, the Keychain accessibility; `mkipa.py check` (run on every IPA build) checks idevice linked in and
  the pairable host present after dead_strip.

## Decisions (unattended, written down)

- Order of routes: whatever pairing is stored decides (RemotePairing → RPPairing/RSD; lockdown record → 62078). On
  iOS 17.4-26 a lockdown record over LocalDevVPN is what StikDebug/Feather users have, and installation_proxy is a
  plain lockdown service there (no developer tunnel needed). On iOS 27 62078 is refused over loopback (brief), so
  only the RemotePairing pairing works there.
- Pair-setup over loopback isn't allowed (`allowsPairSetup` false over Wi-Fi/Tailscale, per the brief), so
  `tunnel_create_rppairing` gets no PIN callback (idevice falls back to "000000"); pairing is `pairOnPhone` only.
- Installs pass no options to installation_proxy (`install`, not `upgrade`: install handles an update on iOS 15+).
- LocalDevVPN is opened with the `localdevvpn://` scheme (guess, see Not verified); `open` needs no
  `LSApplicationQueriesSchemes` entry, and the reply says when nothing opened.
- Split: the Settings > Installation screen, the install run choosing this route, the "Another VPN Is On" alert,
  docs, and the phone checks are follow-ups: F15a (screens + install run) and F15b (phone checks), filed with
  `plan add`. They touch `web/app/` and
  `Sideload.swift`, outside this task's files.

## Tried and failed

- First cross-build: cargo used gcc as the linker for the cdylib crates (`cc: unrecognized option '-target'`). Fixed
  with `CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=clang` + lld link-args.
- Building in the session scratchpad (tmpfs) hit "Disk quota exceeded" at ~700 MB of `target/`; it builds under
  `native/build/idevice/` (gitignored) now.
- Swift: idevice's `uintptr_t` lengths import as `UInt`, not `Int`.

## Not verified

- **Nothing ran on a phone.** No install, pairing, tunnel or VPN probe from the app on the iPhone 15 (iOS 27) or the
  iPhone 7 (iOS 15): the screens that call this aren't built yet (F15a), the iPhone 15 is read-only, and the 7 runs
  the jailbreak build, whose `idevice.*` calls refuse. F15b is the phone check.
- That `pairable_host_accept`'s mDNS advertisement (idevice's own `mdns-sd`, raw multicast sockets) works inside an
  iOS app: iOS 14+ gates multicast behind `com.apple.developer.networking.multicast`, which free accounts don't
  have. If the phone never sees "Pair with …", advertise `_remotepairing-pairable-host._tcp` with NWListener/
  NetService (mDNSResponder, needs only `NSBonjourServices` + local network permission) and keep idevice's listener.
  Also untested: whether the phone finds a pairable host that is itself.
- That the RemotePairing port is 49152 on every phone/boot (only seen on the iPhone 15); idevice discovers it over
  mDNS normally.
- LocalDevVPN's URL scheme `localdevvpn://` is a guess; not checked against the app's Info.plist.
- That the `--locked` build is reproducible byte for byte; only that it builds and links.
- Whether the larger executable (+5 MB) changes launch time; not measured on a phone.
- On a machine without the aarch64-apple-ios Rust target the whole native build is now skipped by the gate (probe
  says what's missing); only this machine was tried.
- Heartbeat interval handling (`heartbeat_get_marco` timeouts) is from reading idevice, not observed.

## Gate failure after the merge

`test_idevice.py`'s check of the built IPA read `native/build/ipa`, which the gate's Python step finds before the
native build runs: in the merge checkout that was main's last build, without idevice, so "ifizbox.idevice.pairing"
was missing. The check moved into `mkipa.py check`, which runs on the IPA `native/build.sh` has just built.
