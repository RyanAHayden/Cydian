# B66: Manage's Re-sign on a marked app dropped the pick quietly

## What was wrong

Two holes in Installed > Manage (screens/installed.js runManage), either of which matches "tapped Re-sign, nothing
happened, the row came unselected":

1. A marked app whose installed version is no longer on its source (or has no source, or was marked without a version)
   was pickable (Delete counts it) but got no Re-sign job: `manageKinds().resign` was false, so Re-sign either stayed
   disabled for it alone or quietly skipped it beside other apps. Nothing said why.
2. Once jobs did run, `done()` always ended Manage (setManaging(false) clears the selection), even when the run stopped
   at the first failure or never started. One case shows nothing at all: screens/queue.js runAppQueue returns 0
   without a word while Confirm's run is still going (`appRunning`). signing-client.js installOnDevice does the same
   while another install runs.

I couldn't tell which of the two the user hit (see Not verified), so both are fixed.

## What changed

- core/installed.js: `manageKinds` gives `blocked` (marked and not re-signable). `manageCounts` counts `blocked`.
  The Re-sign button is enabled when the pick has blocked apps, but its (n) still counts only the apps it signs as they are.
- core/appqueue.js: `markedResignProblem(pkg, installed)` returns why (no-source / no-version / unknown-version /
  no-download) and the newest version to install instead.
- screens/installed.js:
  - `resignBlockedAlert`: "Can't Re-sign YouMod" with one line per app saying why, plus "Install the newest (x)
    instead: it keeps its data." Buttons: Cancel | Install Newest | Re-sign the Other(s), or just OK when nothing can
    be done.
  - `runManage`: the alert comes first. When it adds the newest installs, the confirm sheet counts them ("1 app is
    installed at its newest version"). When only newest installs are left, the alert's button is the confirmation.
    If Confirm's run is going, it says "Another Install Is Running" and keeps the pick. After a run, the apps still in
    the queue stay picked with Manage on (`keep`). Manage ends only when everything went through.
  - `runManageJobs` returns `{ done, left }` (ids still queued). It labels a newest install under Re-sign "Installing".
- screens/queue.js: one added export, `appQueueRunning()`. This file isn't on the task's file list; it's a single
  added line, nothing moved.
- Tests: web/app/screens/installed-manage.test.js, with B66 cases for a marked app with and without its version on
  the source, no source, no version, mixed picks, a failed or busy run, and markedResignProblem.

## Tried / dead ends

- None. Note: nav/alert.js `showAlert` resolves `{ index, value }`, not an index. runManage reads `.index`.

## Not verified

- The 7's sideload build: not driven. The 7 runs the jailbreak build, where Manage doesn't show. Installing the
  sideload IPA there is outside this task. So I never saw which of the two holes YouMod actually hit. The tests use
  the same rows (a marked YouMod with and without its version on the source).
- The alert's look (three stacked buttons) and the toolbar's enabled Re-sign without a count: not rendered. Only
  checked through the injected alert/sheet fakes.
- signing-client.js installOnDevice's own quiet `return false` while another install runs: not covered by the busy
  check (no export there). The pick now stays selected in that case, but no alert says why.
