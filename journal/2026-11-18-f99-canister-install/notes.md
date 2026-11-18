# F99: Add Source & Install from Canister results

Search's Other Sources alert (`web/app/screens/extras.js offer`) offers **Add Source & Install** in the jailbreak
app, after Sileo's provisional Get (docs/sileo-zebra.md 'Canister').

## What I did
- `offerButtons(r, { canQueue })`: Cancel / Add Source & Install / Depiction when the backend has `queue` (only the
  jailbreak build does: backend-native-queue.test.js). The site and the sideload build still get Add Source. Suite
  (non-flat) repos still get no add button, as before ("add it from Sources > Edit").
- `addSourceAndInstall(r, deps)`: Verifying URL HUD + `addSource`; then a Reloading Data HUD over
  `refreshSources(_, { filter: key === new source })` and `catalog.ensure()`; then `catalog.package(id, key)`.
  Found: go to the package page (`#/sources/<key>/package:<id>`) and `backend.queue({ op: "install", id, version,
  name })`, which opens Confirm as usual. Not listed by that source: a "Not Found" alert saying the source was
  added but doesn't list the package for this device (Canister may be stale). Add or refresh errors: an alert,
  nothing queued. The key comes from addSource's record, or from `sources()` matched by `normalRepo(uri)`.
- All outside calls are injected (`backend, catalog, showHUD, showAlert, go`), so `search.test.js` (F99 test) drives
  every branch in node: queued, key-by-URI, missing, refused source.
- `catalog.js` is imported late inside `offer` so extras.js stays importable without the parse worker.

## Decisions
- The page opens first, then the job is queued: Confirm is modal over the package page, so Cancel there leaves the
  user on the page with the Install button.
- The version queued is the refreshed source's (`pkg.stanza.version`), not Canister's, which may be stale.

## Not verified
- On a phone: no jailbroken device run in this task (the iPhone 7 test phone runs the sideload/other builds per
  tools; not tried). The HUD sequence, the hash navigation and the Confirm sheet opening over the page are checked
  only through the injected test doubles.
- "Refresh just that source" in the app: `backend-native.js refreshSources` ignores the `filter` option (only
  withAltSources honours it), so in the app every APT source is re-read after `apt-get update` (which is global
  anyway). Correct but slower; outside this task's files, filed as a follow-up.

## Plan fix
- `done` refused to tick: plan/TODO.md had a second, parked F99 (Upgrading & Jailbreaking Help unlocked, added in
  5241898). I renamed that one to F105 (`plan newid F`), changing only its id. There's no `plan` command to
  re-id a task.
