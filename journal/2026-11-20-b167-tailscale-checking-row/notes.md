# B167: Tailscale's row says Checking… while its state is unknown

## What happened

Settings > Installation & Signing > This iPhone: a Connect With pick runs `tailscale.setConnect`, then `redraw()`.
`paintInstallation` first paints with `st = null` (`reading: true`) while `idevice.status` (which carries
`tailscale.status`) answers. `installationGroups` read `null` as signed out and drew **Sign In**, then the real
signed-in rows (Device, Test Connection, Sign Out) when the status came back. That was the flash.

## What I did (web/app/screens/installroute.js)

- `installationGroups`: while `reading` (or with no status at all), the Tailscale group has one row, Tailscale /
  Checking… with the grey spinner (`spin`, the same style as Pairing's). It is one row, as Sign In is, so the swap from
  the unknown state to signed out doesn't change the group's height. A running sign-in (`busy`) still wins.
- Connect With during that read showed Automatic whatever was picked (the default for no status). A new
  `connectPick` option (module variable set by the connect handler, cleared once the status answers) keeps the pick
  checked until the answer carries it.
- `connectGroups` (the pair page's Connect step): `st == null` is Checking… too. A status with no `tailscale` key stays
  signed out (the shell always sends it; existing tests use that shape).
- `slideBelow(box, change)`: the main page's repaints measure the box before and after; when its height changes (for
  example Checking… giving way to the three signed-in rows, or a footer of another length), everything under it in
  the page slides from its old place by transform (FLIP, same easing as nav/ui.js `collapse`). There was no shared
  sliding-layout helper (no F-task for one in the plan), so it lives here.

Tests: installroute.test.js (pure: unknown → Checking…, the pick kept, the answer wins), installroute-pair.test.js
(connectGroups with no status), installroute-busy.test.js (DOM: signed in, tap Automatic, no Sign In while the status
is pending, signed-in rows back after).

## Not verified

- On a phone: no device run (the task needs the sideload/jailbreak shell with Tailscale signed in; not part of an
  unattended run). Checked with the fake-DOM tests only.
- The slide itself: the fake DOM has no layout, so `slideBelow` returns early in tests; not seen in a browser.
