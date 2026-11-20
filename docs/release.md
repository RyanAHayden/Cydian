# Releases

iFizBox's app checks GitHub for a newer release and offers it as an upgrade in Changes
(`web/app/core/selfupdate.js`; see "How the app finds it" below). `tools/release.sh` publishes that release. Run it only when a person asks
for a release.

## What a release is

- Tag `vX.Y.Z`, where X.Y.Z is `native/VERSION`, on `RyanAHayden/iFizBox`, at a commit that is already pushed.
- Title `iFizBox X.Y.Z`. The app keeps the first 4 lines of the notes (Markdown taken off) and shows the first as
  the short line of its upgrade row in Changes, so the most important change goes first.
- Assets, under the names the app looks for:

  | asset | what | who takes it |
  |---|---|---|
  | `iFizBox.ipa` | sideload build, ad hoc signed | sideload app: signs it on the phone and installs it over itself |
  | `iFizBox.deb` | rootless jailbreak build (iphoneos-arm64) | jailbreak app on iphoneos-arm64, as the fallback |
  | `com.ryha.ifizbox_<ver>-<build>_iphoneos-arm64.deb` | the same .deb under Debian's name | `debFor`'s exact arch match; the APT repo's `Filename:` |
  | `com.ryha.ifizbox_<ver>-<build>_<arch>.deb` | any other arch build found in `--dist` under that name | its arch, and the APT repo |
  | `Packages`, `Packages.gz`, `Release` | iFizBox's own flat APT repo over the Debian-named .debs (`tools/selfrepo.py`) | the jailbreak app's built-in source |
  | `source.json` | the updated AltStore source | the Worker's `/repo/source.json` (the deployed copy only when GitHub fails) |

  The names come from `native/brand.env` (`BRAND_NAME` gives `iFizBox.ipa`, `iFizBox.deb`, `iFizBox.app`;
  `BRAND_PACKAGE` gives the Debian name), in `native/build.sh`, `mkipa.py`/`mkdeb.py`, `release.sh` and
  `publish.sh`. The app takes only `iFizBox.ipa` (no other IPA of the release);
  `tools/altsource.py update` drops `source.json` entries whose IPA is named otherwise (the releases up to
  v0.9.3). `native/test_assetnames.py` checks all of this.

  `debFor` takes the asset ending `_<arch>.deb` first, and uses plain `iFizBox.deb` only for iphoneos-arm64. So a
  roothide (iphoneos-arm64e) or rootful build would only need its own `<pkg>_<ver>_<arch>.deb` added. Nothing
  builds those yet.
- The update offer compares the tag with the app's `CFBundleShortVersionString`. Both come from `native/VERSION`,
  and the script refuses a build where they differ. Otherwise the app would offer the same version again and again.

## iFizBox's own sources

Like Cydia's apt.saurik.com, iFizBox has a source of its own that is built in and can't be removed
(`web/app/core/essential.js` `builtinSources`). The release script regenerates both on every release:

- **APT repo** (the jailbreak app, and what the website's Jailbroken? Install iFizBox sheet adds to Sileo and Zebra):
  `https://ifizbox.com/repo/`, a flat repo (`dist ./`). Its files are the latest release's assets: the Worker's
  `/repo/<file>` fetches `https://github.com/RyanAHayden/iFizBox/releases/latest/download/<file>`, follows GitHub's
  redirect itself and answers with the file (only `Release`, `Packages`, `Packages.gz` and `*.deb`). Zebra
  can't take GitHub's address directly: the redirect ends at a signed `release-assets.githubusercontent.com` URL,
  and Zebra 1.1.36 names its cache file after it ("the file name is invalid"). Release assets, not GitHub Pages:
  `latest/download/<name>` always redirects to the newest published release's asset, so the URL never changes, there is no second branch or Pages setup to keep up, and the
  .debs are not committed to git. Drafts and pre-releases don't count as latest, so a draft doesn't change what the
  app sees. The repo is unsigned, like most jailbreak repos.

  `Packages` lists every published release's iFizBox, not just the newest (the newest 20 releases, like the
  AltStore source), so apt (`apt-cache policy com.ryha.ifizbox`), the app's Modify > Downgrade and its Version
  History offer the older builds too. Each `Filename:` names the release the .deb belongs to,
  `v0.9.7/com.ryha.ifizbox_0.9.7-1337_iphoneos-arm64.deb`. The Worker's `/repo/<tag>/<file>.deb` fetches it from
  `releases/download/<tag>/<file>` the same way: redirect followed by the Worker, only `vX.Y.Z` tags and `.deb`
  names, cached for a day because a published asset never changes. To build that list, a real release reads the older
  releases with `gh` (`tools/selfrepo.py fetch`). For each one it takes the release's `Packages` asset, keeping
  only that release's own stanzas, or, for a release without one, its Debian-named .debs. Only package IDs
  the new release ships are kept, so builds from before the rename (another package ID) aren't listed. Drafts and
  pre-releases are left out. The new release's `--minimum` field goes on its own stanza only. A dry run stays
  offline and lists the new release only, unless `IFIZBOX_RELEASE_HISTORY=DIR` points at a directory laid out as
  `DIR/<tag>/Packages` (which `tools/selfrepo.py fetch OWNER/NAME DIR` fills).
- **AltStore source** (the sideload app and the site): `web/app/source.json`, served at
  `https://ifizbox.com/repo/source.json`, rewritten by
  `tools/altsource.py update`: the new version first in `versions[]`, with its date and the notes' first lines,
  and the versions already listed kept below it (at most 20). The Worker answers with the latest release's
  `source.json` asset, so a new version is listed the moment the release is published (cached 5 minutes), like
  `/repo/Packages`; the deployed copy of `web/app/source.json` is only the fallback for when GitHub fails. Commit it
  after the release anyway, so that fallback stays current.

`--minimum X.Y.Z` sets iFizBox's own field in both: `X-iFizBox-Minimum-Version` in the Release (and in iFizBox's
Packages stanza), `"minimumVersion"` on the app in the AltStore JSON. apt and other AltStore clients ignore it, and
so does iFizBox: the field is read (`core/essential.js minimumOf`) but nothing blocks or pops up on
it. Without `--minimum` the field is left out. The script refuses a minimum newer than the release itself.

## How the app finds it

The app checks for a new iFizBox on every launch, Home's Reload and return, silently: the sideload app reads
its own AltStore source and GitHub's latest release, the jailbreak app reads GitHub's release (its row comes from apt
and the built-in repo). A newer iFizBox is only an upgrade row on top of Changes, counted in its badge, installed from
there; there is no popup, no Essential Upgrade alert and no Settings > About. In the sideload app iFizBox's own IPA
never goes through the local install server, because iOS closes iFizBox, and the server with it, when it starts
installing. Instead it is signed on the phone and held on the Signing Server (worker/, `POST /sign/host`) for iOS to install from, or, with no
bridge to sign with, the user is sent to ifizbox.com in Safari.

## Cutting one

One command does all of it: `tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]`. It checks main is
clean and current and the version is new, commits and pushes `native/VERSION`, builds that exact commit in a clean
temporary worktree, publishes it with `tools/release.sh` as the repo owner's GitHub account (whichever gh account
is active; `tools/release.sh --check-auth` runs first, so a missing login stops it before the version commit is
pushed), commits and pushes the updated `web/app/source.json`, and then waits for the site with
`tools/release.sh --verify-live X.Y.Z` (step 6 below): it finishes only once `https://ifizbox.com/repo/` lists the
new version, and fails when the deploy doesn't serve it within 15 minutes. Run it from an interactive shell (it needs `SWIFT_TOOLCHAIN` and `IOS_SDK`). `--dry-run` builds
and prints what would be published and changes nothing. There is no release on tag push in CI: the build needs the
iOS SDK, which can't go on a hosted runner. The steps below are what it runs.


1. Bump `native/VERSION` (it is X.Y.Z: the script refuses a tag that already exists), commit it and push to main.
2. Write the notes in a file. The first line is the one Changes shows.
3. Look at the plan first: `tools/release.sh --dry-run --notes notes.md`. That builds `native/` (it needs the
   toolchain from `docs/native.md`: `SWIFT_TOOLCHAIN`, `IOS_SDK`), runs mkdeb/mkipa's checks, and prints the tag,
   the asset names and the notes. It publishes nothing and makes no network calls.
   Both builds bundle `web/app/` as it is on disk, so this run and the real one (and `tools/setup/release.sh`)
   stop first when `web/app/` holds files git doesn't track, ignored ones included (`tools/stray-check.sh` lists
   them): delete them, or commit the ones that belong.
4. Publish: `tools/release.sh --notes notes.md`. It needs `gh` with a login for the repo's owner (`RyanAHayden` for
   `RyanAHayden/iFizBox`): when `GH_TOKEN` isn't set it takes the owner's token with
   `gh auth token --user <owner>`, so it doesn't matter which gh account is active (an account with pull rights
   only would get HTTP 404 from `gh release create`). If gh has no login for the owner it stops and says so:
   `gh auth login` as the owner (gh keeps the other accounts), or set `GH_TOKEN`. `tools/release.sh --check-auth`
   shows which account it would publish as. It checks for
   a clean tree, a HEAD that is on origin, and a tag that doesn't exist yet locally, on origin or as a release. Then it
   runs `gh release create` with the assets above. GitHub creates the tag at HEAD.
   Before building it refreshes `web/app/core/piracy-list.js` from Canister (`tools/sync-piracy-list.py`),
   warns when the committed copy is older than cnstr/manifests' newest piracy-list commit, and stops if the file
   changed: commit and push it, then run again (with `publish.sh`, run that again). A dry run stays offline and only
   names the copy's Canister commit; `--sync-piracy` makes it compare too, without writing the repo's copy.
   After `gh release create` it checks that the release is really up and fails otherwise: `gh release view` lists
   `iFizBox.ipa`, `iFizBox.deb`, `Packages`, `Packages.gz`, `Release` and `source.json`, and
   `https://github.com/RyanAHayden/iFizBox/releases/latest/download/iFizBox.ipa` redirects to this tag's
   `iFizBox.ipa`, which answers (retried for 2 minutes while GitHub catches up). A draft only gets the asset check,
   because it is never "latest". `tools/release.sh --verify-release X.Y.Z` runs the same checks on their own, e.g.
   after publishing a draft on the site.
5. Commit `web/app/source.json` (the script rewrote it to name the new IPA) and push it to main.
6. Verify it is live: `tools/release.sh --verify-live X.Y.Z`. This polls
   `https://ifizbox.com/repo/source.json` and `https://ifizbox.com/repo/Packages` every 15 seconds until both list
   X.Y.Z for iFizBox (other apps and packages don't count), and fails loudly after 15 minutes, printing what each
   one says. Both read the latest release's assets, so if it fails, check the release is published and latest
   (`--verify-release`), then the Workers Builds deploy.

Both `/repo/Packages` and `/repo/source.json` read the latest release's assets, so `--verify-live` passes within
the 5-minute cache of the release (step 4) even before the push; step 5 keeps the Worker's fallback copy (used
only when GitHub fails) current.

Options:

- `--dist DIR`: publish `DIR/iFizBox.deb` and `DIR/iFizBox.ipa` as they are, without building.
- `--draft`: create a draft. The app ignores drafts (and GitHub's `releases/latest` doesn't return them) until it
  is published on the site.
- Without `--notes`, the notes are the commit subjects since the last `v*` tag (minus `plan:` commits), followed by
  the standard footer about the two files. Those subjects are long, so write notes for a real release.
- `IFIZBOX_RELEASE_REPO=owner/name` publishes somewhere else, for a trial run on a fork.
- `--minimum X.Y.Z`: the oldest iFizBox that may keep running without upgrading first (above).
- `--out DIR`: also leave `Packages`, `Packages.gz`, `Release`, the notes and the updated `source.json` in DIR. With
  `--dry-run`, the source is written there only, never into `web/app/source.json`, so you can look before publishing.

The releases v0.1.0 and v0.1.1 have `iFizBox.ipa` and `iFizBox.deb` but no
Debian-named .deb. That is fine for iphoneos-arm64, which falls back to `iFizBox.deb`.
