# B248: icon/assets.sh fails silently on an empty glass/

## Cause
`glass.py car` writes only the `CAR_SETS` documents, and `CAR_SETS` is empty, so `glass/` exists but holds nothing.
`compile()` listed it with `glass=($(cd glass && ls -d *.icon | sed …))`: `ls` fails on the unmatched glob, pipefail
fails the pipeline, the array assignment takes that status and `set -e` ends the script, with `2>/dev/null` hiding
the only message.

## Fix
`native/icon/assets.sh` collects the documents with a `nullglob` loop over `"$1"/glass/*.icon`: an empty or missing
`glass/` is no documents, and there is no `ls` left to fail.

## Checked
- Linux, a stand-in `xcrun` on PATH: `assets.sh --compile` with an empty `glass/` exits 0 (main's script: exit 2,
  no output); with two `.icon` folders both reach actool's arguments.
- MBA (`ssh mba`, Xcode actool): the real `--compile` of the plain catalog with an empty `glass/` exits 0 and writes
  a 19.9 MB Assets.car (into a temp dir there, deleted after; the committed .car files are untouched).

## Not verified
- The full `assets.sh mba` run (both catalogs, copy back, assets.sources): not run, since it rewrites the committed
  Assets.car/AssetsLite.car/assets.sources, which this task does not change. The plain `--compile` above is the step
  that failed; the lite one runs the same code.
