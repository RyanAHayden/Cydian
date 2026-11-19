# F264: Tailscale connection for on-device installs (first build, coordinator session)

## Built

- `native/sideload/tailscale/`: tsnet (tailscale.com v1.104.7) as a Go 1.27.4 c-archive (`build.sh`, Go tarball
  checked by sha256, modules by go.sum, cached in `~/.cache/ifizbox/tailscale`; first build ~35 s plus downloads).
  Linked into the sideload executable only (`iFizBox-sideload`, 29 MB vs 7.8 MB for the jailbreak one with
  `stub.c`).
- The integration problem: idevice's `tunnel_create_rppairing` opens two OS TCP connections to the address it's
  given: the RPPairing port (49152) and then the TLS tunnel's port, which the phone picks in its createListener
  answer (`finish_tunnel`, ffi/src/tunnel_provider.rs). A relay for 49152 alone isn't enough. Patch 0002 adds
  `tunnel_set_port_map(cb)`: idevice asks the app for the port to use, the app opens a second relay
  (`TSRelay(own 100.x, tunnelPort)`) and returns its 127.0.0.1 port. RSD/AFC/installation_proxy run inside the
  tunnel (jktcp), so nothing else needs relaying.
- Sign-in: tsnet started without an auth key goes to NeedsLogin and gets an AuthURL (tsnet calls
  StartLoginInteractive itself); the app opens it in SFSafariViewController and polls status every second until
  Running (10 min limit), closing the page then. State: Application Support/tailscale (not backed up,
  completeUntilFirstUserAuthentication), not the Keychain yet.

## Not verified

- Nothing ran on a phone at commit time: sign-in, Test Connection and an install over Tailscale are the user's test.
- Hostname with spaces ("iFizBox on iPhone"): expected to be sanitised by control to `ifizbox-on-iphone`.
- Keys in the Keychain (a custom ipn.StateStore) instead of a protected file: follow-up.

## Logs

`log stream --predicate 'subsystem == "ifizbox.tailscale"'` (categories `app`, `tsnet`) plus `ifizbox.idevice`
(`install`). Lines: `node started in X s: state …`, `sign in: state …`, `signed in as …`, `test 100.x:49152: {…}`,
`install through 100.x:49152 via 127.0.0.1:P`, `relay for port N: 127.0.0.1:P`, tsnet's `relay … connected in
… / dial failed … / closed (… bytes up, … down)`, `install connection closed; node stopped`.
