# F88: record apps installed in the jailbreak app

## What I did
- `screens/altstore.js` `installRows`: the jailbreak row ("With the jailbreak") no longer calls `onInstall` on the
  tap; it passes it as `openIpaInstall`'s `onInstalled`, so the record is made only when the helper's install
  succeeds. New options `jailbreak` (default `ipaInstallAvailable()`) and `ipaInstall` (default `openIpaInstall`)
  so tests can drive the row without the bridge or the console modal.
- `renderApp`: `record` is made in every mode; the app queue / Custom Install hooks stay off in jailbreak mode
  (`queued`). The Installed group (Mark as Installed / Change Installed Version / Mark as Not Installed) now shows
  in the jailbreak app too, and redraws on `onAppsChange` so a record that lands after the console shows at once.
- `screens/browse.js` `recordApp`: no jailbreak early return; the Version History tap only builds the queue hooks
  outside jailbreak mode (they were keyed on `record`, which is now always defined).
- `screens/ipa-install.js`: `rememberIpa(r, name)` records an IPA installed from Settings > Install from URL or a
  tapped .ipa link by the helper's bundle id, version empty (I4's real version fills it in), and leaves an
  existing record (one from the source page, with its source key) alone. The share sheet (share.js) already
  recorded its own installs.
- Test: `web/app/screens/ipa-record.test.js`.

## Decisions
- Record on success, not on tap: a failed helper install (no_adhoc etc.) shouldn't leave a phantom record. The
  site/sideload paths are unchanged (they still record on tap, or on signAndInstall's success).
- The app page in jailbreak mode now shows both trackingSection's "Installed" (remembered version, the marking
  rows) and F87's "Installed App" (the real version with I4's note). Kept both: Mark as Installed lives in the first,
  the real version in the second.

## Not verified
- On a device: the jailbreak app's IPA install, the record appearing on #installed/apps and the app page, and
  I4 correcting the version. No jailbroken iOS 15+ phone here (the 4S is iOS 6 and the task doesn't say to use it);
  covered by the unit tests with a stubbed `ipaInstall` and an in-memory store only.
- The app page's redraw on `onAppsChange` in a browser: not rendered, only read.
