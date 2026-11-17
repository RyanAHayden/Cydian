# B1: dist repos' source icon

## What
- The brief says Cydia looks for CydiaIcon.png at the repo's top level. docs/cydia.md (R2, from Cydia's source)
  says otherwise: Cydia uses `<base>CydiaIcon.png`, and base is `MetaIndexURI("")`, i.e. `URI/dists/<dist>/`
  for dist repos. I kept the docs' Cydia order and added the fallback the brief asks for.
- `core/sources.js`: new `sourceIconUrls(source)`. Dist repo: `[<URI>dists/<dist>/CydiaIcon.png, <URI>CydiaIcon.png]`.
  Flat repo: just `[<base>CydiaIcon.png]` (flat repos were fine; no root fallback even for a `sub/` flat dir).
  `sourceIconUrl` is unchanged (other code may use it).
- `screens/sources.js`: the row's `<img>` tries the next URL on `error`, and is removed after the last.
- `docs/cydia.md`: Sources tab note on Cydian's fallback.
- Test: `sources.test.js` "icon URLs: …" (Procursus, Chariz, akemi `./`, a flat subdir).

## Failed attempts
- First version deduped base and root for every repo, so a flat subdir repo also fell back to the root; changed
  to flat = one URL, as the brief says flat repos are fine.

## Not verified
- I didn't load the Sources tab in a browser or the app, so the fallback in the browser (onerror → next src
  through `backend.assetUrl`) was never seen running. Only the URL list has a node test (there's no DOM in node).
- I didn't fetch https://apt.procurs.us/CydiaIcon.png (no network check in this task), so I haven't confirmed
  Procursus actually serves the icon at its top level.
