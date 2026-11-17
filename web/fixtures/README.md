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
