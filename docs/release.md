# Releases

iFizBox's app checks GitHub for a newer release once a day and offers to install it (F61,
`web/app/core/selfupdate.js`). `tools/release.sh` (T6) publishes that release. Run it only when a person asks
for a release.

## What a release is

- Tag `vX.Y.Z`, where X.Y.Z is `native/VERSION`, on `RyanAHayden/iFizBox`, at a commit that is already pushed.
- Title `iFizBox X.Y.Z`. The app shows the first 4 lines of the notes (Markdown taken off) in its "iFizBox X.Y.Z Is
  Available" alert, so the most important change goes first.
- Assets, under the names the app looks for:

  | asset | what | who takes it |
  |---|---|---|
  | `iFizBox.ipa` | sideload build, ad hoc signed | sideload app: signs it on the phone and installs it over itself |
  | `iFizBox.deb` | rootless jailbreak build (iphoneos-arm64) | jailbreak app on iphoneos-arm64, as the fallback |
  | `com.ryha.ifizbox_<ver>-<build>_iphoneos-arm64.deb` | the same .deb under Debian's name | `debFor`'s exact arch match; the APT repo's `Filename:` |
  | `com.ryha.ifizbox_<ver>-<build>_<arch>.deb` | any other arch build found in `--dist` under that name | its arch, and the APT repo |
  | `Packages`, `Packages.gz`, `Release` | iFizBox's own flat APT repo over the Debian-named .debs (F72, `tools/selfrepo.py`) | the jailbreak app's built-in source |

  F180: the names come from `native/brand.env` (`BRAND_NAME` gives `iFizBox.ipa`, `iFizBox.deb`, `iFizBox.app`;
  `BRAND_PACKAGE` gives the Debian name), in `native/build.sh`, `mkipa.py`/`mkdeb.py`, `release.sh` and
  `publish.sh`. The app takes only `iFizBox.ipa` (no other IPA of the release) and nothing under the old name;
  `tools/altsource.py update` drops older `source.json` entries whose IPA is named otherwise (the releases up to
  v0.9.3). `native/test_assetnames.py` checks all of this.

  `debFor` takes the asset ending `_<arch>.deb` first, and uses plain `iFizBox.deb` only for iphoneos-arm64. So a
  roothide (iphoneos-arm64e) or rootful build would only need its own `<pkg>_<ver>_<arch>.deb` added. Nothing
  builds those yet.
- The update offer compares the tag with the app's `CFBundleShortVersionString`. Both come from `native/VERSION`,
  and the script refuses a build where they differ. Otherwise the app would offer the same version again and again.

## iFizBox's own sources (F72)

Like Cydia's apt.saurik.com, iFizBox has a source of its own that is built in and can't be removed
(`web/app/core/essential.js` `builtinSources`). The release script regenerates both on every release:

- **APT repo** (the jailbreak app, and what the website's Install Full iFizBox sheet adds to Sileo and Zebra):
  `https://ifizbox.com/repo/`, a flat repo (`dist ./`). Its files are the latest release's assets: the Worker's
  `/repo/<file>` fetches `https://github.com/RyanAHayden/iFizBox/releases/latest/download/<file>`, follows GitHub's
  redirect itself and answers with the file (B17; only `Release`, `Packages`, `Packages.gz` and `*.deb`). Zebra
  can't take GitHub's address directly: the redirect ends at a signed `release-assets.githubusercontent.com` URL,
  and Zebra 1.1.36 names its cache file after it ("the file name is invalid"). (F171 dropped the postinst that rewrote the old
  GitHub address in old installs: no old install carries over.) Decision: release assets, not GitHub Pages. `latest/download/<name>`
  always redirects to the newest published release's asset, so the URL never changes, there is no second branch or Pages setup to keep up, and the
  .debs are not committed to git. `Packages` names each .deb by its bare asset name (`Filename:
  com.ryha.ifizbox_0.1.3-12_iphoneos-arm64.deb`), which resolves against the same URL to the same release.
  Drafts and pre-releases don't count as latest, so a draft doesn't change what the app sees. The repo is unsigned,
  like most jailbreak repos.
- **AltStore source** (the sideload app and the site): `web/app/source.json`, served from
  `https://raw.githubusercontent.com/RyanAHayden/iFizBox/main/web/app/source.json` (I7's URL, unchanged), rewritten by
  `tools/altsource.py update`: the new version first in `versions[]`, with its date and the notes' first lines,
  and the versions already listed kept below it (at most 20). Commit it after the release.

`--minimum X.Y.Z` sets iFizBox's own field in both: `X-iFizBox-Minimum-Version` in the Release (and in iFizBox's
Packages stanza), `"minimumVersion"` on the app in the AltStore JSON. apt and other AltStore clients ignore it, and
since F183 so does iFizBox: the field is still read (`core/essential.js minimumOf`) but nothing blocks or pops up on
it. Without `--minimum` the field is left out. The script refuses a minimum newer than the release itself.

F183: the app checks for a new iFizBox on every launch, Home's Reload and return, silently: the sideload app reads
its own AltStore source and GitHub's latest release, the jailbreak app reads GitHub's release (its row comes from apt
and the built-in repo). A newer iFizBox is only an upgrade row on top of Changes, counted in its badge, installed from
there; there is no popup, no Essential Upgrade alert and no Settings > About. In the sideload app iFizBox's own IPA
never goes through the local install server, because iOS closes iFizBox, and the server with it, when it starts
installing. Instead it is signed on the phone and held on the Signing Server (worker/, `POST /sign/host`) for iOS to install from, or, with no
bridge to sign with, the user is sent to ifizbox.com's Install iFizBox App (AltStore, SideStore, Feather or the IPA: F89).

## Cutting one

One command does all of it: `tools/publish.sh X.Y.Z [--notes FILE] [--minimum X.Y.Z] [--dry-run]`. It checks main is
clean and current and the version is new, commits and pushes `native/VERSION`, builds that exact commit in a clean
temporary worktree, publishes it with `tools/release.sh` as the repo owner's GitHub account (whichever gh account
is active), commits and pushes the updated `web/app/source.json`, and checks that `releases/latest/download/iFizBox.ipa`
is the new version. Run it from an interactive shell (it needs `SWIFT_TOOLCHAIN` and `IOS_SDK`). `--dry-run` builds
and prints what would be published and changes nothing. There is no release on tag push in CI: the build needs the
iOS SDK, which can't go on a hosted runner. The steps below are what it runs.


1. Bump `native/VERSION` (it is X.Y.Z: the script refuses a tag that already exists), commit it and push to main.
2. Write the notes in a file. The first lines are the ones the alert shows.
3. Look at the plan first: `tools/release.sh --dry-run --notes notes.md`. That builds `native/` (it needs the
   toolchain from `docs/native.md`: `SWIFT_TOOLCHAIN`, `IOS_SDK`), runs mkdeb/mkipa's checks, and prints the tag,
   the asset names and the notes. It publishes nothing and makes no network calls.
4. Publish: `tools/release.sh --notes notes.md`. It needs `gh`, logged in with push rights on the repo. It checks for
   a clean tree, a HEAD that is on origin, and a tag that doesn't exist yet locally, on origin or as a release. Then it
   runs `gh release create` with the three assets. GitHub creates the tag at HEAD.

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

v0.1.0 and v0.1.1 were published by hand, before this script. They have `iFizBox.ipa` and `iFizBox.deb` but no
Debian-named .deb. That is fine for iphoneos-arm64, which falls back to `iFizBox.deb`.
