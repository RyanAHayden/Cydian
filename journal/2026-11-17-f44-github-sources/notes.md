# F44: GitHub-hosted sources read better

## What I did
- `core/sources.js`:
  - `githubRepo(url)` -> `{ user, repo }` or null for github.com/<u>/<r>/raw/..., github.com/<u>/<r>/releases/...,
    raw.githubusercontent.com/<u>/<r>/..., and <u>.github.io/<r>/... (repo null for a file at a user site's root).
    The user keeps the URL's case (FIZL0 on github.com; github.io hosts are lower case, so "fizl0").
  - `displayName` falls back to the GitHub user after `name` and `origin`, before the host. So a seeded (never
    loaded) source, a failed one, or a JSON with no `name` shows the user; a source's own name always wins.
  - `sourceSubtitle(source)`: "github.com/<user>/<repo>" (or "<user>.github.io" for a root file), else the URL.
  - `githubAvatarUrl(source)`: `https://github.com/<user>.png?size=120`; `sourceIcons(source)`: AltStore iconURL,
    else the avatar; APT: CydiaIcon.png places, then the avatar (a 404 on CydiaIcon.png = "no icon of its own").
- `screens/sources.js`: rows (also in Edit mode, same rows) use `sourceSubtitle` and `sourceIcons`, through
  `backend.assetUrl` as before, so the site's proxy caches the avatar like any other icon.
- `screens/altstore.js` (an AltStore source's page header): icon falls back to the avatar when the JSON has no
  `iconURL`. Not in the task's file list, but the brief names "a source page's header"; it is a one-line change.
  The header's title already falls back to `displayName`, so it gets the user too. The nav-bar title of a source
  page comes from `displayName` via `browse.nav`.
- `core/github.test.js`: parse across the four shapes and edge cases (no repo, reserved paths, look-alike hosts),
  title/subtitle/icon fallbacks, and the 8 GitHub-hosted F28 defaults.

## Decisions
- No change was needed in `core/altstore.js` (listed in files): the fallbacks work on any record by its `uri`, so
  `seedRecord`/`altRecord` stay as they are, and stored records need no migration.
- The parse lives in `core/sources.js` beside `displayName` (sources.js already imports altstore.js; the other
  way round would make an import cycle).

## Not verified
- In a browser or on the phone: no browser run in this unattended session. Screen changes are `node --check`ed and
  the logic is unit-tested.
- That the site's fetch proxy follows github.com/<user>.png's redirect to avatars.githubusercontent.com: not
  fetched live (no network calls from tests). F28 notes say the proxy follows each hop; if it refuses, the icon
  falls back to the letter as before.
