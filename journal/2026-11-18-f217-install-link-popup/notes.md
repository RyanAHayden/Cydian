# F217 ifizbox.com/?install asks the plain Install iFizBox popup

User 2026-11-18: "it opened with the popup install first or browse anyway, thats the wrong popup".

## Done
- `web/app/websign-gate.js` `askFromInstallLink`: shows `FIRST_VISIT` (Install iFizBox First: Not Now / Install
  iFizBox) instead of `askToBrowse`'s browse gate. Install (index 1) runs the given `install` (app.js passes
  `home.installiFizBox()`) and returns "install"; Not Now returns null and writes nothing, so Home's lock and
  `firstVisitState` stay as they were (unlike `promptFirstVisit`, whose Not Now writes "later"). It no longer takes
  `storage`. F184 comments updated there and in `web/app/app.js`.
- `web/app/install-link.test.js`: the launch helper answers Not Now (0); the Install test uses index 1; new tests:
  the popup is exactly `FIRST_VISIT` (two buttons, no Browse, no countdown), and Not Now runs nothing and leaves storage,
  `firstVisitState` and `browsingLocked` unchanged from "ask", "later" and "installed".

## Tried and failed
Nothing.

## Not verified
- Not checked in a real browser or on a phone (Safari at ifizbox.com/?install): the change is a one-call swap covered by
  the node tests, and no phone task was given.
