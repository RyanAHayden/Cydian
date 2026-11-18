# F180a: release 0.9.4 with the new asset names, then tighten the old-name exceptions

## What I found
- Release v0.9.4 was already published (2026-11-18T20:15Z, someone ran tools/publish.sh 0.9.4 after F180 and F172
  landed): assets `iFizBox.ipa`, `iFizBox.deb`, `com.ryha.ifizbox_0.9.4-1201_iphoneos-arm64.deb`, `Packages`,
  `Packages.gz`, `Release`. It's marked Latest. So I didn't cut another release: 0.9.5 would have nothing new to
  ship (no product commits since v0.9.4, only plan notes).
- Step 4's commit (bc9f77c "iFizBox's AltStore source: 0.9.4") reached origin/main after this worktree branched off.
  I cherry-picked it onto task/F180a, so the stricter checks see the real source.json. The change is the same, so
  the merge stays clean. source.json now lists one entry: v0.9.4/iFizBox.ipa.
- Step 5 checked by hand: releases/latest/download/iFizBox.ipa redirects to v0.9.4/iFizBox.ipa, and its Info.plist
  CFBundleShortVersionString is 0.9.4.

## Changes
- `tools/altsource.py check`: versions[0].downloadURL must equal `ipa_url(version)` exactly (it used to accept any
  `*.ipa` of that release).
- `tools/test_altsource.py`: test that check refuses other IPA names, and that the published source.json lists only
  `<NAME>.ipa` entries.
- `native/test_assetnames.py`: dropped the source.json skip and `LAST_OLD`. The source.json test now wants every
  versions[] entry to be its release's `<BRAND_NAME>.ipa`, and no old asset names anywhere in the file.
- `native/test_brand.py`: dropped `NoOldIds.F172`, the exception for test-fixtures URLs and old-named release IPAs.
- test-fixtures pre-release (GitHub): deleted the five `<oldname>-0.x.x.1.ipa` copies (0.1.1.1, 0.2.2.1, 0.2.4.1,
  0.2.5.1, 0.2.8.1). The pre-release also held stale `source.json` / `source-required.json` copies that still
  pointed at those IPAs (and at the old repo slug and bundle ID). Nothing in the repo uses them; testrepo/ is served
  from raw main. After the old name is mapped to the new one, their only differences from `testrepo/altstore.json`
  and `testrepo/altstore-required.json` are the case of the name. I replaced them with the current testrepo copies
  (`gh release upload --clobber`), so nothing there points at a deleted file.

## Not verified
- I didn't run publish.sh myself: v0.9.4 was already out, and step 1 refuses a version that isn't newer. Its
  outputs (assets, latest/download, source.json) are checked above.
- I didn't install the new IPA or .deb on a phone; the task doesn't ask for it.
