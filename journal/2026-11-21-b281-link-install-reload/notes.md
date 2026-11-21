# B281: Installed reloads after an ifizbox://install link's install

## What was wrong

An Install from the Install IPA prompt (`ifizbox://install?url=…`, and another sideloader's IPA link, both
`incoming.js confirmInstall`) called `signAndInstall({ url, name })` with no `onInstalled`. Every other install path
(a source's app page, My IPAs, the queue) writes an Installed record there, and that write (`recordInstall`) is what
fires `onAppsChange`, which reloads Installed's lists. The link install wrote nothing, so nothing told Installed:

- the list kept its `signing.installed` copy from before (R56: the My IPAs install's days and "From My IPAs"), and an
  app whose records were all gone (R56 run 5, Remove from List) stayed missing until Installed was opened again;
- the app's page is drawn once and kept in the stack, so it also showed the old state;
- R56 run 7 (Reinstall from My IPAs) had written a device record with `sourceName: "My IPAs"`, key
  `library:probe.ipa`. A later URL install left it there, so even a freshly drawn page read "Source: My IPAs" while
  `signed.json` held the URL record.

## What I did

- `incoming.js confirmInstall`: passes an `onInstalled` that keeps the answer, and once the run ends (also when it
  fails or throws) calls `reload(answer)`; the default loads `screens/installed.js` and runs `reloadSigned`. Skipped
  where there is no `document` (node tests). A reload that fails never fails the link.
- `screens/installed.js reloadSigned(result)`: if the installed app's device record is a My IPAs one
  (`libraryRecord`: no source, key `library:…`) it is removed (this install came from a URL); that fires
  `onAppsChange`, else it calls `loadAllApps()` itself. Then every live app page (new `appPages` pageViews, registered
  in `renderAppPage`) is drawn again, without the placeholder (`quiet`).
- A source's record is kept: Changes and Update read its source and key (the jailbreak `rememberIpa` keeps such
  records for the same reason). The jailbreak build's link install records through its own `rememberIpa` and ignores
  the `onInstalled` passed in; the reload there is harmless.
- Tests: `web/app/screens/installed-reload.test.js`. Two existing tests compared the install call's argument with
  `deepEqual`; they now compare `url` and `name` only (the argument carries `onInstalled` now).

Decision (unattended): removing the My IPAs record rather than writing a new source-less record. With it gone the
app shows exactly as a fresh URL install does (the signed-only row, "Signed by iFizBox"), which is the existing look
for URL installs; writing a new record would have changed that look for every link install.

## Tried and failed

Nothing failed. (One edit to `incoming.js` went through a python heredoc by mistake instead of the edit tool; the
result was checked in the diff.)

## Not verified

- On the iPhone 15 Pro: not rerun. The fix is page-side only and covered by node tests; the R56 scenario (My IPAs
  install, then an `ifizbox://install` link with an http server behind `tailscale serve`) needs the phone lock and
  about half an hour of setup, and this is a low-priority follow-up. The real page redraw (`renderAppPage` on a live
  body) is not exercised by the node tests, only the record and list side.
- On the signing-server route, `signAndInstall` returns once iOS has the install link, before iOS has the app; the
  reload runs then. `signed.json` already holds the new record at that point (R56), so the list and page are right,
  but nothing reloads again when iOS finishes.
