# B108: show the build number

The user couldn't tell whether a phone ran the updated build. The line under the version footer now reads
"Version 0.9.9 (1926) · d4d4175" instead of just the commit.

## What changed

- `web/app/screens/version-foot.js`: new `buildLine({version, build, commit})` does the formatting and leaves out
  any part it doesn't know. `versionLines` fills the second line (`.home-commit`) with it:
  - in the apps: version and build come from Bridge `app.info` (`CFBundleShortVersionString` /
    `CFBundleVersion`, so they belong to the binary that is actually running), and the commit comes from the bundled
    build.json. Until app.info answers, or if it fails, the line shows build.json's version and commit.
  - on the site: all three come from build.json.
- `tools/buildinfo.sh`: build.json gains `build`, which is `git rev-list --count HEAD`, the same count
  `native/build.sh` puts in `CFBundleVersion`. That way the site and the apps show the same number for the same
  commit.
- `web/app/screens/version-foot.test.js`: tests for the formatting and for both sources (web/app).

## Decisions

- The brief names `settings.js` and a new `about.js`. There is no About page: F183 removed it, and
  `settings.test.js` checks that settings.js has no `"about"`. Settings' root and Home both show the version through
  the shared `versionLines`, so the change belongs in version-foot.js. settings.js needed no change, and I created
  no about.js.
- The Cydia-style first line ("iPhone9,3, iOS 15.8.8, iFizBox 0.9.9 (en-us)") stays as it was. The build line
  replaces the bare commit line under it.

## Not verified

- I didn't look at it on a phone (iPhone 7 / sideload IPA) or on the live site. The task didn't ask for device
  use, and native builds need the MBA or toolchain. The logic is covered by node tests that use a fake bridge.
- I didn't deploy the site's build.json. I checked the `build` field by running `tools/buildinfo.sh` into a scratch
  directory, which gave 1926 at d4d4175.
