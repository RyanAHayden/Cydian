# AltStore source fixtures (F28)

Trimmed snapshots of the user's own AltStore sources, taken 2026-11-17 through `curl -L` (the same bodies the
proxy returns after following redirects), for `web/app/core/altstore-sources.test.js`. Trimmed by
`journal/2026-11-17-f28-user-altstore-sources/tools/trim.py`: every top-level field kept, at most 3 apps (6 entries
for AppTesters, 4 for RyukSign, so their repeated bundle ids stay in), 2 versions per app, 2 news items, lists cut
to 3 items and strings to 160 characters. Nothing else is taken from those projects.

| file | URL | shape |
|---|---|---|
| `ifizbox.json` | https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json | iFizBox's own source (I7), a copy of `web/app/source.json`: 2.0, one app |
| `provenance-emu.json` | https://provenance-emu.com/apps.json | AltStore 2.0: versions[], news, appPermissions; no source icon |
| `fizl0-apps.json` | https://fizl0.github.io/apps/source.json | 1.x fields (version, downloadURL) beside versions[] |
| `feather.json` | https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json | 1.x beside versions[], news |
| `flycast-ios.json` | https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json (redirects to raw.githubusercontent.com) | AltStore 1.x only: no versions[] |
| `itorrent.json` | https://xitrix.github.io/iTorrent/AltStore.json | 2.0 with featuredApps, headerURL, both appPermissions and 1.x permissions |
| `crystall1ne.json` | https://alt.crystall1ne.dev | 2.0; the host serves this JSON at **every** path (/Packages, /Release too) |
| `apptesters.json` | https://repository.apptesters.org | ESign-style (META, bundleID, down, type), one entry per version, sent as text/html, 10 MB whole |
| `mountainofpenguin.json` | https://raw.githubusercontent.com/MountainofPenguin/Altstore-Repository/main/apps.json | 2.0 with apiVersion |
| `ryuksign.json` | https://source.ryuksign.com/source.json | variants sharing bundle ids, per-version appPermissions and sha256 |
| `unbound.json` | https://repo.unbound.rip/app-repo.json | 2.0, buildVersion, minOSVersion 18.0 |
| `opentennis.json` | https://github.com/FIZL0/opentennis/releases/latest/download/altstore-source.json (redirects twice) | 1.x beside versions[] |
| `partyboard.json` | https://github.com/FIZL0/partyboard/releases/latest/download/altstore-source.json | same |
| `openmx.json` | https://github.com/FIZL0/openmx/releases/latest/download/altstore-source.json | same |
