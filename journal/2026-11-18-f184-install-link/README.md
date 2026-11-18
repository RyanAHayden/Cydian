# F184: ifizbox.com/?install opens Home with Install iFizBox First

## What I did
- `web/app/websign-gate.js`: `takeInstallParam(win, { mode })` (site mode only, never with `cydianApp`/`cydianNative`):
  when the query has `install`, it replaces the URL (history.replaceState) with the same path, the other params kept,
  and `#/home`. `askFromInstallLink(took, { install })` then calls `askToBrowse` (the locked-row popup), whatever
  firstVisitState is.
- `web/app/app.js`: takes the param before `router.start()` (after launch.js's startAt, so it wins), asks after it
  with `home.installCydian`. `screens/home.js` needed no change: `installCydian` was already exported.
- `web/app/install-link.test.js`: asks once on the site, cleans the URL (other params kept), asks even when the state
  is "later" or "installed", never in jailbreak/sideload/native/app shells, nothing without the param, Install runs
  the flow.

## Decisions
- Matched with `URLSearchParams.has("install")`, so `?install`, `?install=1` both work; `?installed` doesn't.
- No change to the website lock: after Browse Anyway, `?install` still asks (brief: whatever firstVisitState is).

## Not verified
- In a real browser (Safari on the iPhone) and on the deployed ifizbox.com: no browser/phone driving in this run;
  the logic is covered by the node test with a fake window/history, and app.js's wiring by reading it.
- That the Worker serves `/?install` as index.html: static asset lookup ignores the query string, not tested here.
