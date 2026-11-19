# B111: This iPhone install progress

User report (iPhone 15): an install through This iPhone (installd over LocalDevVPN) finished in 2.3 s, but the run's
page still sat on the Signing Server route's "Asked iOS to install" step with the bar at 50%.

## Cause

The IPA queue's install lane (`signing-client.js openPrepared`) treated every route the same: after `signing.open`
answered it called `progress("asking")` (row "Tap Install on the iOS prompt", bar 50%, log "Asked iOS to install")
and then started `signing.progress`, the watch for iOS's prompt and install, with a 600 s ask wait. On This iPhone
`signing.open` only answers once installd has installed the app, and no prompt ever comes, so the watch waited.
`SignAhead.open` also passed `emit: nil` to `installHere`, so the run never saw the copy or installd's percent.

## What changed

- `native/Sources/Sideload.swift installHere`: a new optional `step(phase, fraction)`: `copying` (AFC bytes sent /
  size; 0 on connect) then `installing` (installd's percent). The old overall `here` emit stays.
  `signAndOpen` passes `step` through; `signing.install` streams it as `{here: phase, progress}` (a new key, so older
  JS ignores it).
- `native/Sources/SignAhead.swift open`: on the local route streams `{phase: "copying" | "installing", progress}` and
  the reply carries `installed: true`.
- `web/app/signing-client.js`:
  - `openPrepared`: on This iPhone, `progress("copying", 0)` as soon as the route is known, then the events
    (`herePhase`), and it returns `{ installed: true }` from `signing.open`'s reply: no "asking", no prompt watch.
  - `installOnDevice` (the single install and iFizBox's self-update): `hereLabel` maps `{here}` events to
    "Copying to iPhone N%" / "Installing N%" (the step line and the bar), ignoring the overall `here` once those come.
    When it is iFizBox itself, "iFizBox will restart" is stepped once as installd starts. A finished app install ends
    on "Installed <app>", bar 100%, with Open <app> (signing.openApp) above the Return button, not "Sent to iOS".
- `web/app/core/apprun.js`: phase `copying` (state `installing`, row flag `here`). Row: "Copying to iPhone N%" then
  "Installing N%"; run status "Copying <app> to iPhone (1 of 1)"; log "Copying <app> to this iPhone", "Installing
  <app>", "Installed <app>"; bar: copy 50-60%, installd 60-100%. iFizBox itself: "iFizBox will restart" in the log
  and status. The Signing Server route's words are unchanged.
- `web/app/screens/apprun.js`: a one-app run installed on This iPhone ends with Open <app> above Return (`openRow`,
  `phoneLanes().open`). Done / Installed list / queue clearing are the run's normal end (unchanged: the row ends
  `installed`, not `unsure`, so record() and queue.clear() run).
- Tests: `web/app/install-here-progress.test.js` (step mapping, the run's words and percents, openPrepared skipping
  the watch, the single install's end, the self-update line, openRow).

`ipa-install.js` (on the task's file list) is the jailbreak helper's install page; it has no This iPhone route, so it
was left alone.

## What failed on the way

- The first gate run broke the native build: inside `installHere`, `IDevice.install`'s closure argument was named
  `step`, which hid the new `step` parameter (`step?(…)` on an `IDevice.Step`). Renamed the closure's argument to
  `st`; `make -C native package` then built the .deb and .ipa.

## Not verified

- **On the iPhone 15** (the task asked): not done. It is the user's daily phone, read only (memory: lockdown probe
  only, no installs or screen driving), and this unattended run has no way to put a new build on it or watch its
  screen. Needs a person: install a build with this branch, set Settings > Installation > This iPhone, install one app
  from its page and from a queue of two, and update iFizBox itself.
- The Swift edits compile (the gate builds both apps on this machine), but they have not run on a phone.
- The real event timing (how often installd reports, whether the AFC progress reaches 1.0 before installd starts) was
  not observed; the mapping is tested with fake events only.
