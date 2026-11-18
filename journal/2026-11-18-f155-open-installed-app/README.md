# F155: Open <app> on the install progress page

## What I did
- `native/Sources/Sideload.swift`: new bridge call `signing.openApp {bundleId}` -> `{opened}`, through
  `Workspace.open` (private `LSApplicationWorkspace openApplicationWithBundleID:`, looked up at run time like the
  other Workspace calls; false when the selector is missing or iOS refuses). Runs on the main queue.
- `web/app/nav/progress.js`: progressHUD's interface gains `finish({ label, action, status })`, ending the page on a
  caller's button instead of Return to Cydian.
- `web/app/signing-sheet.js`: `followInstall` takes `name`; when iOS reports the app installed and the HUD has
  `finish` (the progress page), it ends on "Open <name>" (`openLabel`: cut past 24 chars, "Open App" with no name),
  whose action is `openInstalled` (signing.openApp; an alert when iOS won't open it or the shell is older; the page
  closes either way). A HUD without `finish` (liveHUD, test fakes) keeps the old Installed-then-hide.
- `web/app/signing-client.js`: My IPAs' install (`installFromLibrary`) passes the app's name to followInstall. The
  Custom Install sheet (`inspectAndInstall`) passes the name it signed as.
- Tests: progress.test.js (finish), signing-sheet.test.js (followInstall's Open, openLabel, openInstalled).

## Decisions
- The website can't launch an app by bundle ID (no shell), so its installs stay on Return to Cydian; the task's
  "sideload/website" is covered for the sideload paths that follow iOS's install.
- Plain Install (signAndInstall -> installOnDevice without `after`) doesn't follow iOS's install at all today: it
  ends on Done once iOS has the link. Making it follow is a behaviour change outside this task's brief, filed as
  F156 (low).

## Not verified
- The Swift change compiles (the gate builds Cydian.deb and Cydian.ipa) but was not run.
- Not run on a phone: whether `openApplicationWithBundleID:` opens an app from the sideloaded Cydian on iOS 15+ is
  taken from Feather doing the same (docs/sideload.md); no device was in this task's scope.
