# R45 on the iPhone 15 Pro: waits for T58

The brief: run the paid sideload check (journal/2026-11-20-r45-paid-sideload-check/notes.md) on the iPhone 15 Pro
through `tools/ui-15.sh` (docs/iphone15.md), after T58.

## What I did

- Looked for the rig on main: `tools/ui-15.sh` and `docs/iphone15.md` are not there. T58 is still open in the plan,
  and `task/T58` has no commits beyond main.
- A `tools/ui-15.sh` exists only as uncommitted work in another worktree (`~/runs/iFizBox/take-T58`), and the rig's
  files (`~/.local/share/ifizbox-rig/`: WDA.ipa, DDI, CA bundle) are present. I did not use them: that script is
  someone else's work in progress, not landed or checked, and taking the phone outside its lock while T58 may be
  driving it could break that run.
- Blocked the task with `--after T58`, so the run reopens it once T58 merges.

## Tried and failed

none

## Not verified

- Everything the brief asks for on the phone (IPA install, Chariz sign-in, Add to App into Clock, tweak loads,
  re-sign without a new Chariz download, the Price / Sign In / Buy group in pixels): not run, because the
  iPhone 15 rig (T58) is not on main yet.
