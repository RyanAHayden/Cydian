# B120: This iPhone: no dead tap, no blank page, the VPN decided up front

## What was wrong

- **Dead tap**: Install Apps With > This iPhone awaited `idevice.status` (pairing + VPN check + `Tailscale.status()`)
  before doing anything, so nothing moved until it answered.
- **Blank page**: the pair page then awaited `idevice.status` again before drawing anything.
- **Jump to LocalDevVPN**: the "connect" state always showed the Turn On alert with Open LocalDevVPN, whatever was
  installed.

## What changed

- `screens/installroute.js`
  - `pickRoute`: the main page now reads `idevice.status` for the Signing Server choice too; a tap on This iPhone
    checks it at once when that status says paired, and otherwise opens the pair page at once.
  - The pair page draws at once (`setupState(undefined)` = `"checking"`: intro + iOS 6 grey spinner, packages.css
    `.loading`), then asks `idevice.status` and `idevice.vpnApps` together. A redraw keeps what is on screen (no
    spinner flash on every poll). Seeing a pairing there checks This iPhone (the user picked it, already paired).
  - `connectGroups(vpn, …)`: the VPN-off state per way: LocalDevVPN (as before, with its Turn On alert once),
    Tailscale (Sign In / signed-in state, Open Tailscale), ask (a Connect With choice group: LocalDevVPN, Tailscale;
    the tap is kept with `tailscale.setConnect`), none (LocalDevVPN Not Installed, Install LocalDevVPN = its App
    Store page via `app.openURL`, Tailscale named as the other way; the existing visibilitychange/pageshow reread
    rechecks when the app comes back).
  - Only Tailscale installed: Connect With becomes Tailscale when the user taps Sign In or Open Tailscale, not merely
    by viewing the page (decided: drawing a page shouldn't change a setting; Automatic would use Tailscale anyway once
    signed in with its VPN on).
- `core/installroute.js`: `vpnRoute(apps, connect)` (pure), `connectAlert(route)`, `LOCALDEVVPN_STORE`,
  `TAILSCALE_URL`, the `"checking"` state. An older shell without `idevice.vpnApps` keeps the LocalDevVPN page.
- `IDeviceBridge.swift`: `idevice.vpnApps` -> `{localdevvpn, tailscale}` with `canOpenURL` on the main thread;
  `tailscaleScheme`. `Info-sideload.plist`: `localdevvpn` and `tailscale` added to LSApplicationQueriesSchemes
  (`native/test_ipa.py` updated for the list).
- Tests: `core/installroute.test.js` (vpnRoute, connectAlert, schemes match Swift/plist),
  `screens/installroute-pair.test.js` (fake DOM: spinner before status answers, each way's page, older shell,
  paired page checks This iPhone, the immediate tap).

## Finding the Tailscale scheme

- `tailscale`: Tailscale's own source, `tailscale/tailscale` `tka/deeplink.go`:
  `DeeplinkTailscaleURLScheme = "tailscale"` (`tailscale://sign-device/v1/...`, the deep links its clients open).
- LocalDevVPN's App Store ID from the iTunes Search API: 6755608044 (`com.jkcoxson.LocalDevVPN`); Tailscale's
  bundle ID is `io.tailscale.ipn.ios` (1470499037).
- Tried and failed: reading the installed Tailscale app's `CFBundleURLTypes` off the user's iPhone 15 (read-only
  installation_proxy Lookup over Wi-Fi lockdown, `ideviceinstaller -n` didn't find it; a hand-rolled lockdown
  StartService worked but installation_proxy closed the connection right after the Lookup, twice). Left it there.

## Not verified

- The Tailscale iOS app actually registering `tailscale://` (so `canOpenURL` says true and Open Tailscale opens
  it): taken from Tailscale's deep-link code, not read from the app's Info.plist (probe above failed). If it turns
  out wrong, only Tailscale detection/opening is affected; LocalDevVPN-only and neither stay right.
- Nothing ran on a phone (the gate does build the IPA, so the Swift compiles): the dead tap and blank page fixes and
  `canOpenURL` are checked only by the fake-DOM tests and the build, not on the iPhone 18 Pro (not reachable from
  this unattended run).
