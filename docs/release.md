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
  | `com.ryha.cydian_<ver>-<build>_iphoneos-arm64.deb` | the same .deb under Debian's name | `debFor`'s exact arch match |

  `debFor` takes the asset ending `_<arch>.deb` first, and uses plain `Cydian.deb` only for iphoneos-arm64. So a
  roothide (iphoneos-arm64e) or rootful build would only need its own `<pkg>_<ver>_<arch>.deb` added. Nothing
  builds those yet.
- The update offer compares the tag with the app's `CFBundleShortVersionString`. Both come from `native/VERSION`,
  and the script refuses a build where they differ. Otherwise the app would offer the same version again and again.

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

v0.1.0 and v0.1.1 were published by hand, before this script. They have `Cydian.ipa` and `Cydian.deb` but no
Debian-named .deb. That is fine for iphoneos-arm64, which falls back to `Cydian.deb`.
