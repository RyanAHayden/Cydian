# Tailscale connection for the "This iPhone" install route

iOS runs one VPN at a time. A Tailscale user installs on this iPhone without switching to LocalDevVPN: the sideload
app runs its own [tsnet](https://pkg.go.dev/tailscale.com/tsnet) node (tailscale.com, BSD-3-Clause, `LICENSE`)
and reaches this phone's own RemotePairing service through the tailnet. Plain sockets from an app to the phone's
own addresses are reset by iOS; a connection that arrives over the Tailscale app's node is answered.

| File | What it does |
| --- | --- |
| `tsnet.go` | the c-archive: start the node (login URL, approval, status), a 127.0.0.1 relay per remote port dialed through the tailnet, RemotePairing's handshake as a test, a port probe (`TSProbe`: connected, refused or no answer), logout, stop; logs to os_log (`ifizbox.tailscale`, `tsnet`) |
| `go.mod`, `go.sum` | the pinned tailscale.com version and every module's checksum |
| `pin.env` | the Go toolchain version and its sha256 |
| `build.sh` | downloads that Go once (checked), builds `libtsnet.a` for arm64 iOS 15, cached per user in `~/.cache/ifizbox/tailscale` |
| `tsnet_ffi.h`, `module.modulemap` | `import TailscaleFFI` for Swift |
| `stub.c` | the jailbreak executable's stand-in: Go and tsnet go into the sideload executable only |
| `Tailscale.swift` | the phone's own Tailscale address (a utun with 100.64.0.0/10), Connect With, sign-in with the login page in the app, the install relay, the `tailscale.*` bridge calls |

## How an install connects

`IDevice.Session` asks `Tailscale.useForInstall()` (Connect With: Tailscale, or Automatic with the Tailscale VPN
on, and the app signed in). Then it starts the node, finds the port RemotePairing listens on (`TSProbe` through the
tailnet: 49152 or the advertised one, `../idevice/README.md`), opens a relay for it and hands idevice
`127.0.0.1:<relay>` instead of LocalDevVPN's `10.7.0.1:<port>`. RemotePairing's tunnel runs on a second port the
phone picks (createListener): idevice asks `tunnel_set_port_map` (our patch,
`../idevice/patches/0002-tunnel-port-map.patch`) and gets a relay for that port too. Everything after (RSD, AFC,
installation_proxy) runs inside that tunnel. The node stops when the session ends.

The node is a normal tailnet device ("<app> on <device>"), not ephemeral. Its state is in Application Support
(`tailscale/`, not backed up, protected until first unlock). Nothing is logged to Tailscale's servers
(`TS_NO_LOGS_NO_SUPPORT`). Tailscale needs the internet for its coordination server; LocalDevVPN works offline.

Tailnet policy: the app's node must reach this phone's node on every TCP port (the tunnel port changes). Test
Connection says which fix applies: an access rule (it shows one to copy), device approval, or an expired key.
