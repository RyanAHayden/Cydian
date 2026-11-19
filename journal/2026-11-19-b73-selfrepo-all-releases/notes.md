# B73: iFizBox's APT source lists every release

## Problem

`tools/release.sh` ran `tools/selfrepo.py` over the new release's .debs only, so `https://ifizbox.com/repo/Packages`
named one version. Downgrade and Version History showed "1 version". Each `Filename:` was a bare asset name that the
Worker fetched from `releases/latest/download/`, so an older .deb wasn't reachable anyway.

## What changed

- `tools/selfrepo.py`
  - `--tag vX.Y.Z` makes this release's Filenames `<tag>/<asset>`.
  - `--history DIR` reads the older releases from `DIR/<tag>/`. For each release it takes that release's `Packages`
    asset, keeping only the stanzas with a bare Filename or one under `<tag>/`, so a post-B73 Packages that already
    lists older releases doesn't add them twice. A release without a Packages asset gives its Debian-named .debs
    instead.
  - At most `KEEP = 20` releases in all, sorted by version (not by name).
  - The `X-iFizBox-Minimum-Version` of older stanzas is dropped: only the new release sets it.
  - Older stanzas are kept only for package IDs the new release ships. v0.9.0–v0.9.3 shipped `com.ryha.cydian`,
    which would have appeared as a second, stray package in the source (F171 made a clean break with that ID).
  - Older stanzas whose (Package, Version, Arch) the new release has again are dropped. The new release's own .debs
    are never dropped: an arm64e copy can have the same control fields.
  - New `fetch OWNER/NAME DIR [--skip TAG]` subcommand. It runs `gh api --paginate --slurp repos/.../releases`,
    leaves out drafts, pre-releases and non-vX.Y.Z tags, then calls `gh release download` with `Packages`, or with
    the Debian-named .debs when a release has no Packages.
- `tools/release.sh`
  - A real run fills `$stage/.history` with `selfrepo.py fetch` and stops if that fails, so it never publishes a
    one-version Packages without saying so.
  - A dry run stays offline and prints "older releases not read", unless `IFIZBOX_RELEASE_HISTORY=DIR` is set.
  - New output line: `release: apt repo versions: ...`.
- Worker
  - New route `/repo/v<X>.<Y>.<Z>/<name>.deb`, which fetches `releases/download/<tag>/<name>`.
  - It uses `upstream()` like the other repo files: redirect followed by the Worker, no Location passed on (Zebra),
    429/5xx retries.
  - Only .deb names with the existing character rule are allowed. Packages/Release under a tag get a 404 without
    asking GitHub.
  - Cache-Control is a day, since a published asset never changes.
- `docs/release.md`: describes the new Packages.

## Tests

- `tools/test_selfrepo.py`
  - Two releases: an old-style Packages (bare Filename plus minimum) and then the next release reading a post-B73
    Packages, for three releases in all.
  - History made of .debs, plus the cap and version ordering.
  - Old package ID left out.
  - `pick_releases`.
  - `fetch` with a fake `gh` runner.
- `tools/test_release.py`
  - Filenames are now `v<VERSION>/...`.
  - New `test_repo_keeps_older_releases`, through `IFIZBOX_RELEASE_HISTORY`.
- `worker/test.mjs`
  - Tagged route: GitHub URL, no redirect, cache header, 404s, bad paths never asked of GitHub.

## Checked by hand

- `selfrepo.py fetch RyanAHayden/iFizBox` against the real releases downloaded 9 Packages assets (v0.9.0–v0.9.8;
  the oldest release has neither a Packages asset nor a Debian-named .deb).
- I built Packages with v0.9.8's real .deb as the current release and the real history. It lists 0.9.8-1557,
  0.9.7-1337, 0.9.6-1301, 0.9.5-1278 and 0.9.4-1201, each under its own tag. The cydian builds are left out.
- `worker/node.mjs` (the Worker under Node) served `/repo/v0.9.7/com.ryha.ifizbox_0.9.7-1337_iphoneos-arm64.deb`
  from real GitHub: 200, no Location, `max-age=86400`, SHA256 equal to the Packages stanza.
- iPhone 7: I served that repo over `ssh -R` and ran apt with throwaway lists and cache dirs in /tmp, so the phone's
  own sources were untouched.
  - `apt-cache policy com.ryha.ifizbox` showed all five versions from the test repo, besides the installed
    0.9.8-1622 and ifizbox.com's 0.9.8-1557.
  - `apt-get download com.ryha.ifizbox=0.9.7-1337` fetched `v0.9.7/...`, and apt checked the hash.
  - Afterwards I removed /tmp/b73 on the phone.
- `web/app/core/catalog.js` `history()` (the data behind Version History and Downgrade), fed this Packages, lists
  all five versions with debUrls `https://ifizbox.com/repo/v0.9.x/...`.

## Failed attempts

- On the phone, `O="-o ..."; apt-get $O` passed no options: mobile's shell is zsh, which doesn't word-split. I
  passed the options inline instead.
- `Dir::State::Lists` (capital L) didn't move the lists dir: the key is `Dir::State::lists`.

## Not verified

- **iFizBox's own Modify > Downgrade on the phone.** The app's built-in source is `https://ifizbox.com/repo/`, which
  serves the latest release's Packages. That file only gets the new format with the next release cut by the new
  `release.sh`, and the `/repo/<tag>/` route only exists once the Worker is deployed. This task may not publish a
  release or deploy. In its place I checked the same data through `catalog.history()` and apt on the phone (above).
  After the next release, check Modify > Downgrade on the 7 lists 0.9.4 and later.
- **A real `release.sh` run calling `selfrepo.py fetch`:** no release was cut. The fetch subcommand itself ran
  against the real repo (above), and the dry-run path is covered by tests.
- **Sileo and Zebra with `<tag>/` Filenames:** not tried. Relative Filenames with a directory are ordinary in
  repos (`debs/x.deb`).
