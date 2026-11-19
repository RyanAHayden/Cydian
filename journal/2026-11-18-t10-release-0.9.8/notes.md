# T10: release 0.9.8

**Version shipped: 0.9.8** (build 1557), <https://github.com/RyanAHayden/iFizBox/releases/tag/v0.9.8>.
Before this, `native/VERSION` was 0.9.7 and the newest tag was v0.9.7, so the next patch was 0.9.8.

## What I did
- Checked that everything T10 waited on had merged. The plan showed only R19 (research, no product change) and
  F233 (which waits for this release) still open ahead of it.
- `SWIFT_TOOLCHAIN` and `IOS_SDK` were both set.
- `tools/publish.sh` refuses to run anywhere but on `main`, and this session must not touch the main checkout.
  So I ran it from a fresh clone of origin in the session scratchpad, checked out on main. As the task requires, it
  pushed `Version 0.9.8` (45eecb1) and `iFizBox's AltStore source: 0.9.8` (086a780) to origin/main. This
  branch changes no files, so nothing conflicts with it.
- Ran `--dry-run` first (exit 0), then the real run with notes I wrote by hand. The default notes would open with
  "Version 0.9.8", and the app shows the first line in its update banner, so I put the user-facing changes first.
  The notes stayed in the scratchpad and were not committed.

## Checks after publishing
- `https://ifizbox.com/repo/Packages`: `Package: com.ryha.ifizbox`, `Version: 0.9.8-1557`.
- `releases/latest/download/iFizBox.ipa`: `CFBundleShortVersionString` 0.9.8, `CFBundleVersion` 1557.
- `https://ifizbox.com/repo/source.json` still listed 0.9.7 first when I checked. The Worker serves the copy
  deployed with the site, and the committed `web/app/source.json` (0.9.8) goes live when the runner publishes main.

## Not verified
- The deployed `/repo/source.json` showing 0.9.8: it depends on the site redeploying after the runner publishes main.
  That happens after this session ends.
- I didn't install 0.9.8 on the iPhone 7 or any other phone, because the task asked only for the release and the
  server checks above.
