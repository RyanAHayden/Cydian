# B139: queue run ended an app "Failed: Cancelled" though nobody cancelled it

## What cancels it

"Failed: Cancelled" is a failed row whose error is "Cancelled". With no Stop/Cancel tapped (the row's flight had no
`why`), the only source is a bridge call that answered `cancelled: Cancelled`: native `SignJob.cancelledError`, which
a tagged job gives when its tag is cancelled. Native `SignJob` keeps cancelled tags for the app's whole life (up to
64), and `SignJob.begin(tag:)` starts a job under a remembered tag already cancelled ("Stop tapped as the call went
out").

`phoneLanes` (web/app/screens/apprun.js) made tags `${id}#${n}` with `n` counting from 1 in each new `phoneLanes`,
and `runAppQueueRun` builds a new one for every run. So running the same queue again (same apps, same order, so the
same sequence of tags) reuses the tags of the earlier run. If anything in an earlier run was stopped or cancelled
(row stop, Cancel, a stall), that app's tag in the new run starts cancelled and its row fails "Cancelled". In the
user's queue (YouMod, OpenTennis, Party Board, openMX) OpenTennis's install tag is `opentennis#4` in every run; it
fails right after YouMod only because that is its turn. YouMod's failure itself cancels nothing: a failure sends no
signing.cancel and the native jobs of different tags are independent (checked the This iPhone path, installHere:
its errors carry their own codes, `install_failed:` etc., never `cancelled`, unless the job's tag was cancelled).

This is the most likely cause from the code; I could not see the user's log of the earlier run, so "an earlier run
cancelled that tag" is inferred, not seen.

## Fix

- `phoneLanes` tags carry a per-run id: `${id}#${n}@${run}` (`laneRunId()`: time + random + counter, so a web view
  reload doesn't repeat it either). `run: ""` gives the old form (the existing tag tests pin it).
- core/apprun.js: a sign/install that throws `cancelled` (code, or a bare "Cancelled" message) while the run didn't
  cancel that row fails it with `NOT_YOU` ("stopped before it finished (not by Cancel)"), so only the user's
  Cancel / a row's stop ever reads Cancelled. The next app goes on as for any failure.
- No native change needed (Sideload.swift, queue.js untouched).

## Tests

`web/app/core/apprun-b139.test.js` (a new file beside apprun.test.js, as B136 did, to keep merges clean): a fake
shell that remembers cancelled tags like SignJob, driving the real prepareOnDevice/openPrepared through phoneLanes and
createAppRun: app 1 fails at iOS and apps 2-4 install with no signing.cancel sent; a second run after a Stop doesn't
collide (fails on the old tags); the old collision now reads NOT_YOU, not Cancelled; the user's stop still says
Cancelled.

## Not verified

- On a phone (iPhone 18 Pro, This iPhone route): the task names no device for me and the 18 Pro is the user's; the fix
  is checked only against the fake bridge.
- That the user's earlier run really cancelled OpenTennis's tag (no log from that session was available).
