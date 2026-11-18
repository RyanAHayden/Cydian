# F180: build outputs and release assets named from BRAND_NAME (no old names)

## Starting point

F171 had already renamed the literal files: native/build.sh made `iFizBox.deb`/`iFizBox.ipa`, release.sh and
publish.sh published `iFizBox.ipa`/`iFizBox.deb`, the extensions were `iFizBoxShare`/`iFizBoxWidget`, and the
Debian-named .deb was `com.ryha.ifizbox_*` (from deb/control's package, BRAND_PACKAGE). What was left:

- the names were spelled out in the scripts, not taken from `native/brand.env`;
- `isSelfIpa` (web/app/signing-client.js) still took *any* IPA of a `v<X.Y.Z>` release, to cover the old-named ones;
- `selfupdate.js parseRelease` fell back to any `.ipa` asset when `<NAME>.ipa` was missing;
- testrepo/'s AltStore sources pointed at `test-fixtures/<old>-<v>.ipa`;
- web/app/source.json lists 20 releases (v0.2.5 to v0.9.3) whose IPA really is the old-named asset.

## What I did

- native/build.sh, share/build.sh, widget/build.sh, Makefile: the app dir, executable, module, .deb, .ipa and the
  extensions' names are `$BRAND_NAME…`. Info.plist templates: `CFBundleExecutable` (and the share extension's
  name and principal class) are `$(BRAND_NAME)…`, filled in by the existing sed. deb/postinst and prerm now say
  `$(BRAND_NAME).app` and build.sh runs the same sed over them.
- mkipa.py, mkdeb.py: paths and messages from `brand.NAME`.
- tools/release.sh, publish.sh: asset names from `$BRAND_NAME`, default repo `$BRAND_GITHUB_REPO`. The
  `releases/latest/download/$BRAND_NAME.ipa` check in publish.sh. (cydian.dev in release.sh/selfrepo.py is F172's.)
- tools/altsource.py: REPO/RAW from BRAND_GITHUB_REPO; `update` keeps only older entries whose downloadURL is
  exactly their release's `<NAME>.ipa` (`is_own_ipa`), so the next release drops the 20 old-named entries.
- signing-client.js `SELF_IPA`: only `releases/(latest/)download/[tag/]<NAME>.ipa` or `<NAME>-<v>.ipa` (case
  insensitive, so the test source's `ifizbox-0.2.8.1.ipa`). selfupdate.js: `<NAME>.ipa` only.
- test-fixtures pre-release: uploaded copies of the five old-named IPAs as `ifizbox-<v>.ipa` (same bytes), and
  pointed testrepo/altstore.json and altstore-required.json at them. I added copies rather than renaming so main's
  test source keeps working until this branch lands; F180a deletes the old ones.
- native/test_assetnames.py (new): no tracked file outside plan/ and journal/ names an old-named .ipa/.deb/.app,
  extension, icon or test-fixture IPA, except source.json's entries for releases up to v0.9.3 (which must be
  exactly `v<ver>/<old>.ipa`); the build/release scripts don't spell `<NAME>.ipa/.deb/.app/Share/Widget` in code; the
  Info.plist templates use `$(BRAND_NAME)` for the executable.
- Tests updated: test_native.py and share/test_share.py substitute `$(BRAND_NAME)` where they read the templates;
  signing-client-ready.test.js (old-named URLs refused), selfupdate.test.js, test_altsource.py, test_release.py.
- docs/release.md: where the names come from.
- Native build (`make -C native package`) with the toolchain: passes; the IPA holds
  `Payload/iFizBox.app/iFizBox`, `PlugIns/iFizBoxShare.appex/iFizBoxShare`, `PlugIns/iFizBoxWidget.appex/iFizBoxWidget`.
  Removed the stale `native/build/<old>.deb/.ipa` left in this worktree's (gitignored) build dir.

## Decisions

- **No release in this task.** The brief says to release only once F171 and F172 are both merged; F172 (the
  ifizbox.com URLs, B22) is still open (`after: F171, F180`), and cydian.dev answers 525. So, as the brief says:
  merge the renames, skip publishing, and leave the release to a follow-up after F172: **F180a** (`--after F172`),
  which also tightens altsource `check`, drops test_assetnames' source.json exception and test_brand's F172
  exception, and deletes the old fixture IPAs.
- **source.json keeps its 20 old URLs for now.** They name files that exist; rewriting them would 404, and
  dropping them all would leave the source with no version until 0.9.4 exists. Renaming the assets of 20
  published releases on GitHub was the other option; I didn't, since it rewrites published releases for no gain
  once `update` drops the entries at 0.9.4.
- Swift type names (`iFizBoxWidgets`, `iFizBoxShortcuts`), the bridging header name, `iconStem` and the helper's
  expected app path in helper/main.c stay literal: identifiers and a C string, not build outputs; test_brand
  already allows the Swift ones.

## Tried and failed

- Nothing failed beyond the expected test updates (test_release's source.json expectation, test_native/test_share
  reading the templates raw).

## Not verified

- The release itself and `releases/latest/download/iFizBox.ipa` answering: not done on purpose (F172 not merged),
  left to F180a.
- The new build on a phone (iPhone 7): not installed; the task didn't ask for a device check and the build's own
  checks (mkdeb/mkipa) pass with identical output names.
- `tools/release.sh` for real (only test_release.py's dry runs with `--dist`).
