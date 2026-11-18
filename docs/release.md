# Releases

Cydian's app checks GitHub for a newer release once a day and offers to install it (F61,
`web/app/core/selfupdate.js`). `tools/release.sh` (T6) publishes that release. Run it only when a person asks
for a release.

## What a release is

- Tag `vX.Y.Z`, where X.Y.Z is `native/VERSION`, on `RyanAHayden/Cydian`, at a commit that is already pushed.
- Title `Cydian X.Y.Z`. The app shows the first 4 lines of the notes (Markdown taken off) in its "Cydian X.Y.Z Is
  Available" alert, so the most important change goes first.
- Assets, under the names the app looks for:

  | asset | what | who takes it |
  |---|---|---|
  | `Cydian.ipa` | sideload build, ad hoc signed | sideload app: signs it on the phone and installs it over itself |
  | `Cydian.deb` | rootless jailbreak build (iphoneos-arm64) | jailbreak app on iphoneos-arm64, as the fallback |
  | `com.ryha.cydian_<ver>-<build>_iphoneos-arm64.deb` | the same .deb under Debian's name | `debFor`'s exact arch match; the APT repo's `Filename:` |
  | `com.ryha.cydian_<ver>-<build>_<arch>.deb` | any other arch build found in `--dist` under that name | its arch, and the APT repo |
  | `Packages`, `Packages.gz`, `Release` | Cydian's own flat APT repo over the Debian-named .debs (F72, `tools/selfrepo.py`) | the jailbreak app's built-in source |

  `debFor` takes the asset ending `_<arch>.deb` first, and uses plain `Cydian.deb` only for iphoneos-arm64. So a
  roothide (iphoneos-arm64e) or rootful build would only need its own `<pkg>_<ver>_<arch>.deb` added. Nothing
  builds those yet.
- The update offer compares the tag with the app's `CFBundleShortVersionString`. Both come from `native/VERSION`,
  and the script refuses a build where they differ. Otherwise the app would offer the same version again and again.

## Cydian's own sources (F72)

Like Cydia's apt.saurik.com, Cydian has a source of its own that is built in and can't be removed
(`web/app/core/essential.js` `builtinSources`). The release script regenerates both on every release:

- **APT repo** (the jailbreak app): `https://github.com/RyanAHayden/Cydian/releases/latest/download/`, a flat repo
  (`dist ./`). Decision: release assets, not GitHub Pages. `latest/download/<name>` always redirects to the newest
  published release's asset, so the URL never changes, there is no second branch or Pages setup to keep up, and the
  .debs are not committed to git. `Packages` names each .deb by its bare asset name (`Filename:
  com.ryha.cydian_0.1.3-12_iphoneos-arm64.deb`), which resolves against the same URL to the same release.
  Drafts and pre-releases don't count as latest, so a draft doesn't change what the app sees. The repo is unsigned,
  like most jailbreak repos.
- **AltStore source** (the sideload app and the site): `web/app/source.json`, served from
  `https://raw.githubusercontent.com/RyanAHayden/Cydian/main/web/app/source.json` (I7's URL, unchanged), rewritten by
  `tools/altsource.py update`: the new version first in `versions[]`, with its date and the notes' first lines,
  and the versions already listed kept below it (at most 20). Commit it after the release.

`--minimum X.Y.Z` sets Cydian's own field in both: `X-Cydian-Minimum-Version` in the Release (and in Cydian's
Packages stanza), `"minimumVersion"` on the app in the AltStore JSON. apt and other AltStore clients ignore it. A
running Cydian older than that gets the Essential Upgrade alert without Ignore (Temporary), and nothing else in the
app works until it upgrades. Without `--minimum` the field is left out and the alert can always be ignored. The
script refuses a minimum newer than the release itself.

The Essential Upgrade alert (Cydia's) runs on every launch in the app: when Cydian (or, jailbroken, apt, dpkg or an
installed `Essential: yes` package) has an upgrade on the built-in source, it shows Complete Upgrade, Essential Only and
Ignore (Temporary). It replaces F61's GitHub popup. F61's check still runs when the built-in source can't be read,
and Settings > About > Check for Updates still works. In the sideload app Cydian's own IPA never goes through the
local install server, because iOS closes Cydian, and the server with it, when it starts installing. Instead it is
signed on the Signing Server and installed from its itms-services link, or the user is sent to cydian.dev's Install
Cydian App.

## Cutting one

1. Bump `native/VERSION` (it is X.Y.Z: the script refuses a tag that already exists), commit it and push to main.
2. Write the notes in a file. The first lines are the ones the alert shows.
3. Look at the plan first: `tools/release.sh --dry-run --notes notes.md`. That builds `native/` (it needs the
   toolchain from `docs/native.md`: `SWIFT_TOOLCHAIN`, `IOS_SDK`), runs mkdeb/mkipa's checks, and prints the tag,
   the asset names and the notes. It publishes nothing and makes no network calls.
4. Publish: `tools/release.sh --notes notes.md`. It needs `gh`, logged in with push rights on the repo. It checks for
   a clean tree, a HEAD that is on origin, and a tag that doesn't exist yet locally, on origin or as a release. Then it
   runs `gh release create` with the three assets. GitHub creates the tag at HEAD.

Options:

- `--dist DIR`: publish `DIR/Cydian.deb` and `DIR/Cydian.ipa` as they are, without building.
- `--draft`: create a draft. The app ignores drafts (and GitHub's `releases/latest` doesn't return them) until it
  is published on the site.
- Without `--notes`, the notes are the commit subjects since the last `v*` tag (minus `plan:` commits), followed by
  the standard footer about the two files. Those subjects are long, so write notes for a real release.
- `CYDIAN_RELEASE_REPO=owner/name` publishes somewhere else, for a trial run on a fork.
- `--minimum X.Y.Z`: the oldest Cydian that may keep running without upgrading first (above).
- `--out DIR`: also leave `Packages`, `Packages.gz`, `Release`, the notes and the updated `source.json` in DIR. With
  `--dry-run`, the source is written there only, never into `web/app/source.json`, so you can look before publishing.

v0.1.0 and v0.1.1 were published by hand, before this script. They have `Cydian.ipa` and `Cydian.deb` but no
Debian-named .deb. That is fine for iphoneos-arm64, which falls back to `Cydian.deb`.
