# C16: AppTesters out of Known Safe and the defaults

User 2026-11-20: AppTesters IPA Repo (repository.apptesters.org) should be neither Known Safe nor a default.

## What changed

- `web/app/core/safe-sources.js`: dropped its `KNOWN_SAFE_EXTRA` entry (it was the only reason it was Known Safe;
  Recommended never listed it). A comment says it is left out on purpose.
- `web/app/app-sources.json`: dropped from the default AltStore list. Seeding happens once per browser/app
  (`meta.seeded`), so people who already have it keep it; it now shows Unknown like any added source.
- `web/app/core/recommended.js`: nothing to change, it never listed AppTesters.
- Other mentions (core/applookup.js, ipainfo.js, altstore.js, sources/ipa.js, worker/src/index.js, the fixture
  README) use AppTesters only as an example of a source *format* (ESign entries, no iOS range, many-app GitHub repo).
  None of them treats it as trusted or a default, so I left them as they are.
- Tests: `altstore-sources.test.js` keeps the AppTesters fixture as a test source that is no default (`NOT_DEFAULT`):
  shape parse, catalog rows and Add Source by hand still cover it; the "deleted default stays deleted" check now
  removes RyukSign. `safety.test.js`: AppTesters is not Known Safe (URL, bare host, alt: key), not Recommended, not a
  default.

## Not verified

- Existing installs on a real phone or browser: not opened. The seeding code adds defaults only on the first open, and
  the backend test (seeded list then removal) covers that path, but I didn't look at a phone that has the source.
