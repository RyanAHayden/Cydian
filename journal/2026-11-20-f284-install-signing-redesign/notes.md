# F284: Settings > Installation & Signing, option B (status first, details one tap away)

Concept: https://claude.ai/artifact/FcTku9dZ4jHgvFAuKfVWRP (user picked B).

## What changed

- **Main page** (`screens/installroute.js mainPage`, drawn by `settings.js drawMain`): built once per page element
  and kept in a WeakMap; every later draw (a setting changed, back from the background, the signing status changed)
  calls `refresh()`, which re-reads and fills slots in place. Rows: status cell + action row; Installation (Install
  Apps With ›, This iPhone ›); Signing (Certificate ›, Signing Server ›, Signed Apps ›); How Signing Works ›.
  Each value sits in a `.value-slot` (settings.css): the value and its wait (grey spinner, or the status cell's
  Checking… text) share one grid cell, so swapping them never moves a row; the swap is an opacity fade. Each source's
  answers land in order (an older read never paints over a newer one), and a refresh never puts a known value back
  to its spinner (except the status after Install Apps With is changed to This iPhone).
- **Status cell** (`core/installroute.js installStatus`, pure): two-line subtitle with a fixed two-line height and
  line clamp, a 29pt tile (green / red / grey), one action row (`STATUS_ACTIONS`) dimmed and inert while checking.
- **Sub-pages**: `installation/with` (the choice), `installation/iphone` (This iPhone's groups: Pairing, Developer
  Mode, the VPN, Open LocalDevVPN, Connect With, Tailscale always there), `installation/pair` (the setup, now titled
  Pairing), `signing/certificate` (Certificate/Files/Profile/Account/options groups + Share Your Certificate),
  `signing/server` (Server, Check Server, Run Your Own + one footer), `signing/apps` (Certificate Status + list).
- **Tailscale rule** (core): `tailscaleVPNOn(status)` = `status.tailscale.address` (the phone's own tailnet address,
  there only while the Tailscale app's VPN is up). Tailscale's VPN on is never "another VPN": decideRoute gives
  `tailscaleSignIn` (not signed in) or the new `tailscaleConnect` (signed in, Connect With LocalDevVPN).
- **Setup follows what the user set up** (user correction relayed mid-task by another session, and on F284's line
  in the main plan): `setUpWithTailscale(ts)` = Connect With Tailscale, or signed in to Tailscale and Connect With
  not LocalDevVPN. Another (non-Tailscale) VPN: Open Tailscale for a Tailscale setup, Open LocalDevVPN otherwise
  (nothing chosen = LocalDevVPN). decideRoute's alert for a Tailscale setup is the new `otherVPNTailscale` (no
  Open button: signing-client's open is LocalDevVPN's). `vpnRoute` is unchanged: both apps installed still asks.
  The brief's first rule ("Tailscale installed → use Tailscale") was implemented, then reverted on this correction.
- `docs/settings.md` describes the new page and routes.

## Decisions (unattended)

- Signing Server chosen: the top cell says Ready to Install "Through the Signing Server, <host>." with Check Server
  (the brief only covers This iPhone's states).
- Extra states the brief didn't list, all with fixed-size text: Can't Reach This iPhone (status call failed),
  LocalDevVPN Is Off / Tailscale Is Off (nothing on), Tailscale Is On + Use Tailscale (signed in, Connect With
  LocalDevVPN).
- Certificate row: "N days left" (red at ≤7), Expired (red), None, Incomplete, Unknown (signer didn't answer).
- Share Your Certificate (SideDrop) moved to the Certificate page; the main page keeps only How Signing Works.
- This iPhone's sub-page keeps its existing repaint (`paintInstallation`), including the Developer Mode row that
  appears once paired; the built-once rule was applied to the main page as the brief describes.
- The old `installationBlock`/`keepInstallBox` (B140) stay for the non-main path and their tests; the main page no
  longer uses them.

## Checked

- `node --test`: new `core/installstatus.test.js` (every state, the three other-VPN setups, subtitle length,
  certificate detail), `screens/installmain.test.js` (routes, sub-page groups, fixed rows); updated
  `core/installroute.test.js` (Tailscale VPN never otherVPN, otherVPNTailscale), `screens/installroute.test.js` and
  `installsigning.test.js` (Pairing / This iPhone / Install Apps With titles).
- Chromium, fake sideload bridge, every reply slowed 2.5 s (`shot.mjs` here): loading, ready via LocalDevVPN, ready
  via Tailscale, other VPN with nothing chosen / set up LocalDevVPN / set up Tailscale, Tailscale VPN not signed in,
  not paired. Each row's top and height printed while loading and once ready: **identical in every state**
  (`55:71 126:44 223:43 266:44 363:43 406:44 450:44 519:43`). A setting change afterwards kept every value (no
  spinner came back). Every sub-page drawn with its title and rows. Shots: `0-loading.png`, `ready-*.png`,
  `other-vpn-*.png`.

## Mistakes

- Two edits went through a shell (a `python3` heredoc on core/installroute.test.js, and a heredoc append to
  settings.css) before I switched back to the Edit tool. Both results are the intended text.

## Not verified

- On a phone: not reachable from this unattended run; only Chromium with the fake bridge.
- The action rows' taps (Check Connection, Open LocalDevVPN/Tailscale, Sign In, Use Tailscale, Check Server) in
  Chromium: they call the existing, tested functions (check, openVPN, openApp, tailscaleSignIn, checkServer); not
  driven one by one.
- Native's Automatic rule (Tailscale.swift useForInstall) is unchanged: native files are outside this task.
