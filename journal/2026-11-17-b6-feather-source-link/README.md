# B6: Feather source link

## What I did
- `core/altstore.js`: each `SIDELOADERS` entry now carries a `source(url)` builder. AltStore and SideStore keep
  `<scheme>://source?url=<encoded>`; Feather now gets `feather://source/<url>` (URL unencoded after the path),
  matching the `/install/` form F37's `sideloaderLink` already uses and what `core/sources/detect.js` parses.
  `installOptions` maps over the builders, so the "Open in Feather" row (screens/altstore.js) picks it up unchanged.
- `core/altstore.test.js`: expected Feather URL updated.

## Tried and failed
none

## Not verified
- The link opening Feather on a real device: no non-jailbroken phone with Feather here (the 4S runs iOS 6), and
  the task didn't call for device work. The form is taken from the brief's reading of FeatherApp.swift
  (`validatedScheme(after: "/source/")`); I did not re-read Feather's source myself.
