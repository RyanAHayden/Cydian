# B216: Version History sheet's sideloader line

## What I did

- The version sheet on Version History (screens/browse.js renderVersions) always titled itself
  "<name> <version>\nA sideloader signs it on the iPhone with your Apple ID." unless the version had a source's
  signed link. In the sideload build the sheet's rows are Install (signed with your certificate) / Custom Install /
  Download IPA, so the line was wrong.
- New exported `versionSheetTitle(name, version, rows, options)` in browse.js: the line stays only when no row
  installs the version here (every row is Download IPA and there is no itms link). Any Install row (certificate,
  jailbreak, website, source-signed) or Custom Install drops it.
- Test: web/app/screens/versionsheet.test.js builds the rows with the real `installRows` for the sideload, jailbreak
  and itms cases, plus a Download-only row list.

## Tried and failed

none

## Not verified

- On the iPhone 15 Pro (where R29 saw it): not re-checked on the device; the unattended run did not drive the phone
  through Version History. The test covers the same rows installRows makes there.
