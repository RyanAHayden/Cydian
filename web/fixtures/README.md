# Fixtures

Trimmed apt index files for `node --test` (`web/app/core/apt.test.js`). Taken from the 4S's
`/var/lib/apt/lists` (pulled into `ref/4s/var/lib/apt/lists`, R1), stanzas copied byte for byte.

- `dist-Packages`: 9 stanzas from `apt.saurik.com/dists/ios/793.00/main/binary-iphoneos-arm/Packages`
  (epochs `1:…`, multi-line Descriptions, `file:///` Icons, `debs/…` Filenames).
- `dist-Release`: the head of that dist's `Release`, with 4 of its `MD5Sum:` lines (the `Packages.diff`
  lines dropped).
- `flat-Packages`: 7 stanzas from BigBoss (`1:` epoch, `~` versions, the malformed Icons real repos ship:
  `files:///`, `file://Applications/…`, a relative device path; a lower-case `homepage:` field; a CJK
  Description; a Description continuation with extra leading spaces), 1 from ModMyi (an `http://` Icon),
  and one synthetic stanza, `org.example.flat`, last: `./`-relative Filename, repo-relative Icon,
  `2:` epoch with `~`, a ` .` paragraph break and a verbatim line. None of the pulled lists is a flat repo
  (`deb <url> ./`), and the Packages format is the same either way; only the URL layout differs.
- `dpkg-status`: 10 stanzas from the 4S's `/var/lib/dpkg/status` (`ref/4s/var/lib/dpkg/status`), byte for byte:
  `install ok installed` packages (an epoch-less `apt7`, `cydia` with a `file:///` Icon), two `hold ok installed`
  (`org.herf.flux`, `winterboard`), one `deinstall ok config-files` and one `install ok not-installed` stanza
  (`web/app/core/installed.test.js`).
- `upgrades-Packages`, `upgrades-Packages-2`: synthetic repos for those packages (written for the test, not
  pulled): newer, equal and older candidates, a `~` pre-release, an epoch bump on the second repo, a candidate for
  the wrong arch and one tagged `cydia::obsolete`, and candidates for packages that are only in config-files or
  not installed.

## Signing

- `missing-exe.ipa` (B21): `web/app/core/fixtures/signing/tiny-ifizbox.ipa` plus `YTUHD.bundle/` and
  `Frameworks/Kit.framework/`, each with an XML Info.plist naming an executable (`YTUHD`, `Kit`) that isn't in the
  IPA, as modded IPAs inject tweak bundles (YouMod), and `DontEatMyContent.bundle/` (with its folder entry) whose
  Info.plist has an empty `CFBundleExecutable`, as YouMod ships it. Signed by `native/test_sign.py` (the on-device signer) and
  `web/app/websign-missing-exe.test.js` (zsign WebAssembly): both seal those files as resources of the app.
