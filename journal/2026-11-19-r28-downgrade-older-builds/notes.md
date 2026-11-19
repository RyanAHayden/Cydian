# R28: Downgrade and Version History list older iFizBox builds (iPhone 7)

## Precondition check (2026-11-19)

The task needs a release cut with `tools/release.sh` **after** B73 merged, so that the live
`https://ifizbox.com/repo/Packages` lists older builds under `Filename: <tag>/<asset>`.

- Newest tag: `v0.9.8`, dated 2026-11-18 23:12 -0500. B73 merged at 2026-11-19 08:29 -0500 (`1f2d0dd`).
  No release since.
- `curl https://ifizbox.com/repo/Packages` gives one stanza: `com.ryha.ifizbox` `0.9.8-1557`, with a bare
  `Filename: com.ryha.ifizbox_0.9.8-1557_iphoneos-arm64.deb` (the pre-B73 shape).
- `HEAD https://ifizbox.com/repo/v0.9.4/ifizbox.deb` returns 200, so the Worker's `/repo/<tag>/<file>.deb` route
  looks deployed (not checked further: the name is a guess, and a 200 there alone doesn't prove the right file).

So Modify > Downgrade on the phone would show only 0.9.8: nothing to check yet. I did not touch the iPhone 7.

## Outcome

Blocked: it waits on a person cutting the next release (`tools/release.sh`, a publish step a task run must not do
on its own). No product change.

## Not verified

- Everything the task asks (Downgrade / Version History lists on the iPhone 7, a downgrade install fetching
  `/repo/<tag>/...`): no post-B73 release exists, the live Packages names one version.
