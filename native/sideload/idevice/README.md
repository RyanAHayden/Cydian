# idevice install route ("Install on this iPhone, no server")

The sideload build installs a signed IPA by talking to this phone's own installd through
[idevice](https://github.com/jkcoxson/idevice) (MIT), the way a computer on USB would. No itms-services manifest,
so nothing reaches the Signing Server, there's no install sheet to keep alive, and the app can update itself.

| File | What it does |
| --- | --- |
| `pin.env` | the idevice commit and the cargo features built |
| `patches/*.patch` | our changes on top of that commit (MIT): `pairable_host_set_pin`, a setup code the app picks and shows before the phone connects |
| `build.sh` | builds `libidevice_ffi.a` + `idevice.h` for arm64 iOS 15 from that commit plus `patches/` on Linux (`--probe`: is the toolchain there) |
| `module.modulemap` | `import IDeviceFFI` for the Swift files |
| `IDevice.swift` | pairing (Keychain), connecting over LocalDevVPN, AFC upload, installation_proxy with progress |
| `VPNCheck.swift` | is LocalDevVPN on (10.7.0.1 answers), is another VPN on instead (tunnel interfaces up) |
| `IDeviceBridge.swift` | the `idevice.*` bridge calls (listed at the top of the file) |
| `test_idevice.py` | the gate's checks that need no phone |

## Routes

- **iOS 17.4+ / iOS 27**: RemotePairing on 10.7.0.1:49152, an RPPairing tunnel and RSD
  (`tunnel_create_rppairing`, `afc_client_connect_rsd`, `installation_proxy_connect_rsd`). The pairing is made on
  the phone on iOS 27 (Developer Mode > Pair with <app>, a 6-digit code; the app is idevice's pairable host).
  Lockdown's 62078 is refused over loopback on iOS 27.
- **Older iOS**: TCP lockdown on 10.7.0.1:62078 with a pairing record made on a computer (`idevice_pair`,
  jitterbugpair) and imported; a heartbeat runs while connected.

Pair-setup isn't allowed over loopback, Wi-Fi or Tailscale (`allowsPairSetup` false), so a connection only ever
verifies an existing pairing. LocalDevVPN must be on while installing; iOS lets no app switch another app's VPN.

## Building

`native/build.sh` runs `build.sh` on every build. It needs `rustup target add aarch64-apple-ios`, clang, `IOS_SDK`
and ld64.lld. The source and cargo's `target/` live in `~/.cache/ifizbox/idevice` (or `IFIZBOX_IDEVICE_CACHE`),
shared by all checkouts under a lock. The first build needs the network (git + crates.io, `--locked`).
It uses `ring`, not upstream's default `aws-lc`, which needs cmake and a Mac toolchain to cross-build.
