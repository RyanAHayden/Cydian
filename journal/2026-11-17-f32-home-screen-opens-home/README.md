# F32 Add to Home Screen always opens Home

## What I did
- `web/app/manifest.json` and the apple-touch-icon in `web/app/index.html` already had what the task asks for
  (F10 set `start_url` and `scope` to `/`, and `icons/icon-180.png` is the F26 box icon, the same SVG as
  `img/cydian-icon.svg`), so I left both alone.
- New `web/app/launch.js` (no DOM): `launchURL(win, { resumed })` gives the URL to swap in before the router
  starts. A fresh standalone launch (`display-mode: standalone`, or `navigator.standalone`; not the native app)
  goes to `#/home`. Reloads (Home's Reload button) and back/forward keep the route, judged by the navigation
  timing entry's `type`, with `performance.navigation` as a fallback. A return from the background never reloads the
  page, so the rule never runs then (`resumed` covers a bfcache-style restore if a caller ever passes it).
- `app.js` calls it once, right before `router.start()`, and uses `history.replaceState`, so no extra history entry.
- `sw.js`: a notification tap that has to open a new window adds `?launch=push` to the URL, so a cold launch
  from an upgrade alert still lands on Changes (or Settings, for the test alert) and not on Home. `launchURL` takes
  the mark out again. When a window is already open, `client.navigate` only changes the hash (a same-document
  navigation, no reload), so that path stays unmarked and as it was.
- `web/app/launch.test.js`: fresh launch goes to Home (both detection methods, any added-from page), reload and
  back/forward stay, a resume stays, Safari tabs and the native app are left alone, the push mark is kept and
  stripped.

## Checks
- `node --test web/app/launch.test.js`: 6 pass.
- Headless Chromium against `python3 -m http.server` on `web/app/`: `/?launch=push#/settings` opens Settings, and
  `/#/sources` in a normal tab stays on Sources (the app loads with the new module and a normal tab is left alone).

## Hand check on an iPhone (to do)
1. In Safari, open the site and go to a deep page, e.g. Sources > a source.
2. Share > Add to Home Screen. Open the new icon: it opens on Home, with the tab bar on Home.
3. Go to Changes, press the Home button (swipe up) and open the icon again within a minute: it is still on Changes
   (resume).
4. Kill the app in the app switcher and open the icon: Home.
5. On Home, tap Reload: the app stays on Home. Go to Settings, pull the app down from the switcher and open it again:
   Home.
6. With Upgrade Alerts on and the app killed, tap an alert (or the Settings test alert): it opens on Changes
   (Settings), not Home.

## Not verified
- Everything in the hand check above: this unattended run has no iPhone running iOS 16+ to drive (the 4S runs iOS
  6, which runs no ES modules, and the task did not grant its screen). Whether iOS reports navigation type
  `navigate` on a cold Home Screen launch, and whether it ever reloads a backgrounded standalone app with type
  `navigate` (that would show as a jump to Home after a long time in the background) is unchecked.
- Standalone display mode in a desktop browser: the headless smoke test only covered a normal tab, since
  headless Chromium cannot emulate `display-mode: standalone` without an installed PWA.
- The `sw.js` push mark end to end (needs a real push to a killed Home Screen app).
