# B117: "This iPhone's UDID isn't known" with several profile candidates

## What I did
- Looked for the files the brief changes: `web/app/screens/devaccount.js` and `native/Sources/ASC.swift` are not on
  main. F273's merge (0b86186) merged the earlier attempt ea5447c with `-s ours`, so it kept only core/asc.js and the
  Worker pass-through. Those two files exist only on wip/F273 (ea5447c).
- F278 (open, critical) ports them onto main. B117 changes the screen and the Swift client, so it has to wait for
  F278. I did not port them here: that is F278's job, and doing it twice would make the merges conflict.
- Blocked with `--after F278`, so the run reopens B117 when F278 lands.

## Not verified
- Nothing in the brief was built or tested: the files it changes aren't on main yet (see above).
