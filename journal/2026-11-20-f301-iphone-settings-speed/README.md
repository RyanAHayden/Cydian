# F301: This iPhone's settings, fast and calm

User (2026-11-20): Settings > Installation & Signing > This iPhone (sideload build) is slow and janky; Test
Connection and every check (pairing, VPN, Tailscale) take forever.

## What made it slow (read from the code)

- **`idevice.status` waited out its own probes.** `VPNCheck.status()` probed 10.7.0.1 on the RemotePairing port
  (1.5 s deadline), then, only after that one went silent, on the lockdown port (another 1.5 s). With LocalDevVPN
  off, 10.7.0.1 goes out the default route and nobody answers, so **every status read took 3 s** whenever
  LocalDevVPN was off: no VPN on at all, or Tailscale/another VPN on. Every page that shows This iPhone waited on it
  (main page status cell, Install Apps With, This iPhone, Pairing). The Pairing page polls it every 2 s while it
  waits for the VPN, so reads piled up on each other.
- **Check Connection with the VPN off waited 30 s+.** `idevice.verify` runs under `IDevice.watched`, whose
  tunnel step allows 30 s of quiet (plus 10 s grace) before it says timeout.
- **Test Connection** starts Tailscale's node (`TSStart`, up to 20 s) and runs the handshake (`TSTest`, up to
  25 s): up to 45 s under a HUD that ate every tap, with no deadline on the page side.
- **Everything waited for everything.** The Tailscale rows (UserDefaults + getifaddrs: instant) waited for the VPN
  probes because they came inside `idevice.status`.
- **Every answer rebuilt the page.** `paintInstallation` did `el.replaceChildren(grouped(...))` for the Checking…
  draw and again for the answer: every group and row element new each time.
- **Nothing was remembered.** Each visit started from Checking…, even when the answer from a second ago was known.

## What changed

Native (`native/sideload/idevice/VPNCheck.swift`):
- No IPv4 tunnel interface up: LocalDevVPN can't be on (it's a utun with a 10.7.0.x address), so nothing is
  probed: the answer is immediate.
- A tunnel up: both ports probed at the same time (`concurrentPerform`), deadline 0.75 s (an answer through
  LocalDevVPN, connected or refused, comes in milliseconds).

Page (`web/app/screens/installroute.js`):
- `idevice.status` and `tailscale.status` are read at once; each part fills its own rows when it answers
  (`installationGroups`' new `tsReading`, `refreshing`, `late`).
- Deadlines (`TIMEOUTS`: status 5 s, tailscale 4 s, verify 20 s, test 25 s, `within()`); past one the rows say
  **Not Responding** in red, or the alert does (Test Connection, Check Connection). Nothing spins for ever.
- The last `idevice.status` answer is kept for the app run (`rememberStatus`/`cachedStatus`) and shown at once
  on the next draw of This iPhone / Install Apps With and on the main page's status cell, with the row spinners
  on while it's read again. Forget Pairing drops it. Not kept across launches on purpose: after a relaunch the VPN
  is likely another, and the fresh read is now well under a second.
- `patchGroups()`: a repaint keeps every group whose rows are the same (matched by header), swaps only the rows
  whose content changed, and sets a changed footer's text in place; groups that come, go or change rows are
  rebuilt; the whole change runs inside `slideLayout` (F300's FLIP; F299's shared helper is not on main yet, noted
  on F299). Rows kept from an older draw call the newest draw's handler (each onClick goes through a holder), so a
  kept row never runs a stale closure.
- Each row of a part being read shows its own spinner (Pairing, LocalDevVPN, Device, the checked choice).
- Test Connection spins "Testing…" in its own row (no HUD; a second tap does nothing while it runs). Check
  Connection spins on its own button (no HUD) and reads `idevice.status` first: with neither LocalDevVPN nor
  Tailscale's route on, it answers Turn On LocalDevVPN at once instead of waiting out `idevice.verify`.
- The Pairing page's 2 s VPN poll never starts a read while the last one runs.

Docs: `docs/settings.md` (This iPhone bullet) says how the page reads, caches, times out and patches.

## Timings

`measure.mjs` (here) draws `installation/iphone` in Node with a fake DOM and a fake bridge whose calls take as long
as the native code makes them take: `idevice.status` before = 15 ms with LocalDevVPN on (the probe connects at
once), 3000 ms with it off (two 1.5 s probes one after the other); after = 15 ms on, 5 ms with no tunnel (no probe),
750 ms with another VPN's tunnel up (two 0.75 s probes at once). `tailscale.status` = 5 ms. Run against the
committed file (`git show HEAD:…` copied beside it, then deleted) and against this one:

| Scenario | visit | rows all answered, before → after | real values on screen, before → after | rows swapped in after the first draw, before → after |
|---|---|---|---|---|
| LocalDevVPN on | 1st | 17 → 17 ms | 17 → 17 ms | 9 → 5 |
| LocalDevVPN on | again | 14 → 16 ms | 14 → **0 ms** (cached) | 9 → 3 |
| no VPN on | 1st | 3001 → **6 ms** | 3001 → 6 ms | 9 → 5 |
| no VPN on | again | 3001 → **6 ms** | 3001 → 0 ms | 9 → 3 |
| another VPN on (e.g. Tailscale) | 1st | 3000 → **750 ms** | 3000 → 750 ms | 9 → 5 |
| another VPN on | again | 3001 → **751 ms** | 3001 → 0 ms | 9 → 3 |

Groups ever on the page: before 6 (all three rebuilt on the answer), after 4 on a first visit (only Tailscale's
group, Checking… → its three rows, is rebuilt) and 3 on a visit again (none rebuilt).

Check Connection with the VPN off: before ≈ 30–40 s (`watched`'s 30 s tunnel limit plus up to 10 s grace) under a
HUD; after ≤ 0.75 s (one `idevice.status` read), the alert at once. Test Connection: the native work is the same
(node start + handshake), but the page stops waiting at 25 s with Not Responding, and nothing else is blocked by a
HUD meanwhile.

## Tried and dropped

- A separate `idevice.paired` native call so Pairing could fill before the VPN probes: with the probes down to
  0–0.75 s it gained too little for a new bridge call, and old shells would lack it.
- Keeping the cache in localStorage across launches: stale VPN state on a cold start would show as fact for up to a
  second; the module-level cache covers the back-and-forth the user described.

## Not verified

- **Real-device timings.** The numbers above come from the native code's own deadlines fed into a fake bridge, not
  from a phone. The sideload build's `idevice.*` / `tailscale.*` calls only run in the sideload IPA; the iPhone 7
  runs the jailbreak build (where they're refused), the iPhone 15 is the user's daily phone (read-only), and no
  unattended session can drive a phone running the IPA. To check by hand: open Settings > Installation & Signing >
  Install Apps With on a phone with the IPA, with LocalDevVPN off, and see the rows answer in well under a second
  (they took 3 s before); Check Connection with LocalDevVPN off should alert at once.
- **The no-tunnel shortcut** assumes LocalDevVPN always shows as a `utun` interface with an IPv4 address while on
  (the same assumption `otherVPN` already made). Not checked on a phone; if it were wrong, LocalDevVPN would read Off
  while on. The 7's `ifconfig` can't show it (LocalDevVPN isn't used there).
- **Swift**: compiled by the gate's native build (`native/build.sh --probe` passes here); not run on a phone.
- **The slide on a real WebKit** (`slideLayout` inside `patchGroups`): the tests use a fake DOM without layout; the
  FLIP code itself is F300's and unchanged.
