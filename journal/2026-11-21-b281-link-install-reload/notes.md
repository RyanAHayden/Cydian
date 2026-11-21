# B281: Installed reloads after an ifizbox://install link's install

## What was wrong

An Install from the Install IPA prompt (`ifizbox://install?url=…`, and another sideloader's IPA link, both
`incoming.js confirmInstall`) calls `signAndInstall({ url, name })` with no `onInstalled`. Every other install path
(a source's app page, My IPAs, the queue) writes an Installed record there, and that write (`recordInstall`) fires
`onAppsChange`, which reloads Installed's lists. The link install writes nothing, so nothing told Installed:

- the list kept its `signing.installed` copy from before (R56: the My IPAs install's days and "From My IPAs"). An app
  whose records were all gone (R56 run 5, Remove from List) stayed missing until Installed was opened again;
- the app's page is drawn once and kept in the stack, so it also showed the old state.

## What I did

- `incoming.js confirmInstall`: once the run ends (also when it fails or throws), it calls `reload()`. The default
  loads `screens/installed.js` and runs `reloadSigned`. It is skipped where there is no `document` (node tests). A
  reload that fails never fails the link.
- `screens/installed.js reloadSigned()`: `loadAllApps()` (every live apps list reloads `signing.installed`), then
  every app page still on screen (new `appPages` pageViews, registered in `renderAppPage`) is drawn again without the
  placeholder (`quiet`).
- Tests: `web/app/screens/installed-reload.test.js`.

## Tried, then reverted

The first version also removed the app's device record when it was a My IPAs one (key `library:…`). R56 run 7
(Reinstall from My IPAs) had written such a record (`sourceName: "My IPAs"`), so even a freshly drawn page still reads
"Source: My IPAs" after a later URL install. The spec review flagged this as more than the asked reload: it deletes
stored data, and `keptIpa` and the page's My IPAs actions read that record. I reverted it and filed it as **B283**
(low, after B281) so someone can decide what a URL install should leave behind.

## Not verified

- On the iPhone 15 Pro: not rerun. The fix is page-side only and the node tests cover it. The R56 scenario needs the
  phone lock, an http server behind `tailscale serve` and a My IPAs install first, which is about half an hour of setup
  for a low-priority follow-up. The real page redraw (`renderAppPage` on a live body) isn't exercised in node: the
  tests swap in a stand-in for the draw.
- "Source: My IPAs" on the page can remain when a My IPAs device record exists (see B283). The reload doesn't change
  stored records.
- On the signing-server route, `signAndInstall` returns once iOS has the install link, before iOS has the app, so
  the reload runs then. `signed.json` already holds the new record at that point (R56), but nothing reloads again when
  iOS finishes.
