# B100: app.js didn't load (refreshOnLaunch declared twice)

## What happened
F250 imported `refreshOnLaunch` from `websign-gate.js` into `web/app/app.js`, but app.js already had a local
`const refreshOnLaunch` (the Settings toggle "Refresh Sources on Launch"). The module threw
`SyntaxError: Identifier 'refreshOnLaunch' has already been declared` on parse, so the site and the app stayed on
Loading.

## Fix
- Renamed the local const to `refreshSetting` (both call sites: launch and back from the background). The imported
  F250 `refreshOnLaunch({ mode })` call is unchanged.
- New gate test `web/app/module-syntax.test.js`: runs `node --check` on every `.js` under `web/app` except tests
  and `vendor/`. Node detects ES module syntax by itself, so this parses each file the way the browser does. It
  takes about 2 s for ~147 files.

## Checks
- The old app.js (from HEAD) fails `node --check` with the same SyntaxError. The fixed file passes.
- To prove the test catches it, I added a throwaway `web/app/zz-bad.js` with an import and a `const` of the same
  name. The test failed and named that file. Then I deleted the file.
- Loaded the site in headless Chromium against `worker/node.mjs` (port 18931, `--dump-dom`): `#boot` is gone, and
  the tab bar and Home's tables are drawn.

## Found, not done
- B102 (low): a site user who turns on Refresh Sources on Launch gets two refreshes at launch (F250 plus the
  setting's).

## Not verified
- The native app (jailbreak or sideload build) on a phone. The fix is a rename of a local in shared JS, and the
  Chromium load covers the parse error. No device run was needed for the syntax error, and none was done.
