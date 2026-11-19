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

## Pairing on the phone: discovered, never connected (iPhone 15 Pro, iOS 27.0.1, 0.9.9 (1885))

Phone syslog of two tries (Developer Mode > Pair with … appeared, the user tapped it):
- `remotepairingdeviced` resolved the service: `nw_resolver_bonjour_resolve_callback … ifindex=1 …
  target=idevice-4f457959.local. port=54096`, then a local-only `getaddrinfo` (ifindex -1) for that host that ended
  in 1 ms, and 11 s later `Received pairing outcome failure(RemotePairingError(errorCode: -1 …))` plus
  `SYMPTOM_LIBNETCORE_CONNECTION_SETUP_STALL` for remotepairingdeviced.
- The kernel's summary of iFizBox's listener when it closed: `tcp listen [IPv4:54096]`, `SYN in/out: 0/0`. Nothing
  ever reached it.
- So the advertisement worked (multicast went out without the multicast entitlement) but the address side didn't:
  idevice's `pairable_host_accept` binds `0.0.0.0` (IPv4 only) and answers mDNS itself (`mdns-sd`, host
  `idevice-XXXX.local.`, addresses from `enable_addr_auto`). The daemon resolves on loopback/local-only through
  mDNSResponder, which doesn't hold A/AAAA records for that host there (mdns-sd skips lo0), or gets one the IPv4-only
  listener can't take.

Fix: idevice only pairs. `pairable_host_prepare` gives the identity, service name and TXT records;
the app listens on `[::]:0` with `IPV6_V6ONLY` off (IPv4 and IPv6, every interface, as PhonePair does), publishes
with `DNSServiceRegister` (interface 0: every interface plus local-only, mDNSResponder's own host name and
addresses), accepts, and hands the socket to `pairable_host_accept_fd`. A failed try keeps listening and is shown on
the page; `NSBonjourServices` + `NSLocalNetworkUsageDescription` are in the sideload Info.plist (iOS refuses to
publish an undeclared type: `kDNSServiceErr_NoAuth`/`PolicyDenied`, shown as "Local Network access is off").
Not NWListener: idevice needs a socket fd, and NWConnection doesn't give one.

Log lines (`<name> pair: …`): `identity …, TXT keys …`, `listening on [::]:PORT …; addresses: lo0 …, en0 …, utunN …`,
`Bonjour: registered NAME._remotepairing-pairable-host._tcp port PORT`, `connection from ADDR port P`,
`idevice asked for the code to be shown`, `paired; the pairing is saved`, or `pairing with ADDR failed: …`,
`DNSServiceRegister failed: N`, `canceled`.

## The phone asked for the code, the page never showed one (iPhone 15 Pro, iOS 27.0.1, build 1893)

The connection worked this time: `remotepairingdeviced` resolved `target=rphone.local. port=54214` on en0 (ifindex
20), held a TCP connection to it (`C38 IPv4…:54214 ready`, f15pair3) and Settings asked "Enter the 6-digit PIN".
iFizBox showed no code. Why, from the code:
- The page redrew on every idevice.pair event through `drawPair`, which first awaited `idevice.status`. That call ran
  on `IDevice.queue`, the serial queue `pairOnPhone` blocks while it waits for the phone. So after the first redraw
  every redraw hung on `status` until pairing ended: no step lines and no code, even when idevice handed the code
  over. (The code was only known once the phone had sent pair-setup M1: idevice drew it in `pair_setup`.)
- Events emitted while iFizBox is in the background (the user is in Settings) may not reach a suspended web view.
- The `iFizBox pair:` lines were NSLog: none reached the syslog relay on iOS 27 (f15pair2, f15pair3), so the logs
  couldn't show it either.

Fix:
- The code is made when Start Pairing is tapped and given to idevice (`patches/0001-pairable-host-set-pin.patch`,
  `pairable_host_set_pin`, applied by build.sh on the pinned commit), so every try uses it; idevice.pair emits it
  first and the page shows it at once, with the steps. It's also posted as a notification ("iFizBox Pairing Code",
  "123 456 — type it in Settings"), removed when pairing ends.
- `idevice.status`, `idevice.vpn` and the new `idevice.pairState` run off `IDevice.queue`; in pairing mode the page
  draws without waiting on status, and on `visibilitychange`/`pageshow` it reads `idevice.pairState` (code, step,
  text, error).
- No timeout: the listener, Bonjour and KeepAlive's silent audio last until paired, Cancel, or leaving the page
  (hashchange sends idevice.pairCancel).
- Logs: os_log `%{public}@`, subsystem `ifizbox.idevice`, category `pair`.

## Paired, then the first install hung (iPhone 15 Pro, iOS 27.0.1, build 1899, f15pair4)

Paired at 16:14:45. Install with This iPhone, Airplane Mode on, LocalDevVPN on. The page stayed on its install
step; no line from the app (the install path still used NSLog). remotepairingdeviced only:
- 16:17:07.92 a connection to 10.7.1.1:49152 opened and closed at once (the route check), then tcp-41: pair-verify
  ok, `Creating tunnel`, `Server ready on port 56552`, TLS, `Tunnel established: utun10, fd4f:7e72:e906::1 ->
  ::2`, RSD on 56553.
- 16:17:08.106 `tcp-41: received error reading message`, `TCP connected peers updated. Total count: 0`, `Rolling
  bonjour advert after host disconnected`. That is the RPPairing control connection only: idevice's
  `tunnel_create_rppairing` drops its `RemotePairingClient` when it returns (ffi/src/tunnel_provider.rs). The tunnel
  isn't torn down with it: its `Stats` line goes on every 30 s until the log ends (16:23). StikDebug does the same.
- Stats: 16:17:38 packets in/out 2204/1083, bytes in 14,459,428 (the IPA going up by AFC). From then on +60 packets
  in and +30 out every 30 s, ~62 bytes each: empty TCP segments, no data either way, for 6 minutes.

So the app sat in an idevice call waiting for a reply that never came (an AFC write/close status, or
installation_proxy's next status), with nothing to end it: idevice has no read timeouts (its global 5 s covers TCP
connects only), jktcp has no zero-window probe, and `IDevice.install` ran with no limit, so the page never got an
error. Which reply it was can't be told from the phone's side alone (installd isn't in this process-filtered log).

Fix (coord/fix-pin):
- `IDevice.watched`: the install (and idevice.verify) runs on its own thread under a `Watch`; each step has a limit of
  quiet (`IDevice.Limit`: tunnel 30 s, AFC/installation_proxy connect 20 s, AFC request 20 s, each 1 MB chunk 30 s,
  installd's next percentage 180 s). Over the limit, the watchdog closes the tunnel (`adapter_close` on an
  `adapter_clone`, so idevice's waiting read fails at once) and fails with `timeout: <step>: no answer from iOS for
  N s (<progress>)`. A call that still doesn't return is left with what it holds (nothing is freed under it).
- os_log `%{public}@`, subsystem `ifizbox.idevice`, category `install`, one line per step: `step: …`,
  `addresses: …`, `tunnel and RSD up in X s: RSD <uuid>, N services, AFC on P, installation_proxy on P`, `AFC: X MB
  of Y MB (Z MB/s)`, `AFC: copied …`, `installd: N%`, `installd: Complete`, `install: done in …` or `install: FAILED
  at <step> …`, `TIMEOUT …; closing the tunnel`. idevice's own log (Info) goes to Caches/idevice.log and its last 30
  lines are relayed as `idevice: …` after a failure.
- The page: This iPhone's install is its own phase, "Installing on this iPhone N%" (connected 2%, upload to 30%,
  then installd), apart from "Downloading". A download that fails without internet says "No Internet Connection"
  (`offline:`), including Airplane Mode with LocalDevVPN up (no address on en*/pdp_ip*).
- Sideload.install's reply passes a `Failed`'s own code (`offline:`, `timeout:`) instead of `internal: …`.

Next run: grep the relay for `ifizbox.idevice` / `install:`; the last `step:` line before a TIMEOUT is where it stops.
