# C55: leave web/app/icons/themes/ out of the native bundles

## What I did
- Grepped for readers of `icons/themes/` (web/app JS/HTML/CSS/manifest, native/Sources, tools): only
  tools/icons.sh writes it, web/app/icons/test_icons.py checks it, tools/concept/build.py already skips it.
  The app's icons come from `appicon/<name>.png` (web/app/appicon.js iconSrc, screens/appicon.js) served by the
  shell; the Home header and banner use `icons/icon{,-lite,-web}-glossy-*.png` at the top of icons/, which stay.
- native/build.sh: `! -path './icons/themes/*'` in the find that copies web/app/, next to vendor/zsign.
  The website is untouched (it serves web/app/ directly).

## Checks
- `native/build.sh all` passed (mkdeb.py/mkipa.py check included), and the bundled web/ passed
  web/app/startup.test.js (1 pass, 0 skipped).
- Sizes, against the build in this worktree from earlier today (F329 era, same toolchain):
  iFizBox.ipa 45,719,610 → 35,338,345 bytes; iFizBox.deb 28,809,144 → 18,919,680 bytes.
- `unzip -l` of the new IPA: 0 entries under icons/themes/.

## Tried that failed
none

## Not verified
- On a phone: not installed; no app code reads the folder (grep above), and startup.test.js covers that the
  bundled page loads in every mode.
- The earlier 45.7 MB IPA was a build left in native/build/ of this worktree, not a release IPA; the 0.17.x
  release IPAs weren't rebuilt for comparison.
