# D16: Credits name ElleKit

ElleKit 1.2 has been bundled for tweak injection since F295 (`web/app/vendor/ellekit/`, BSD-3-Clause), but neither
the Credits screen nor the README credited it.

## Done

- `web/app/screens/home.js` `renderCredits`: a new "Software" group after Artwork with one ElleKit row (author
  Évelyne Bélanger from the LICENSE's copyright line, "Tweak injection, BSD-3-Clause", opens the GitHub repo), and
  a footer saying when the dylib is added and the copyright/licence. Row style matches the existing thanks rows;
  letter icon only (no remote picture, ElleKit has no org avatar worth fetching).
- `README.md` Credits: an ElleKit bullet beside zsign, pointing at `web/app/vendor/ellekit/` for the package and
  licence.
- `web/app/screens/ellekit-credits.test.js`: checks both mention ElleKit, BSD-3-Clause, and the author/vendor path.
  A new file rather than an edit to `cydia-credits.test.js`, to stay inside this task's files.

Decision: zsign is still not on the Credits screen (only the README); left as is, the task asked only for ElleKit.

## Not verified

- The Credits screen was not looked at rendered (browser or phone): the change reuses the existing `grouped` row
  shape (label/subtitle/chevron/icon/onClick) used by Special Thanks, so it should draw the same way, but no
  screenshot was taken.
