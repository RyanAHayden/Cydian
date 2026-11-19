# B80: My IPAs, IPAs that share a bundle ID

## What changed

- `web/app/screens/myipas.js`
  - `sharedInstalls(list, installed, { records })`: for each installed bundle ID that two or more IPAs in the library
    share, `{ file, name }`. `file` is the IPA that matches Installed's record for that ID: first the record's key
    (`library:<file>`), then the only IPA whose name (Sign Options name or IPA name) and version equal the record's.
    A tie, no record, or a record from outside the app gives `file: null`. `name` is the record's name, or the bundle
    ID when there is no record. IDs with only one IPA are left out, so they work as before.
  - `sharedSections(...)`: `ipaSections` with those IDs worked out per IPA. Only the matching IPA is Installed. The
    others are Not Installed, with `Replaces <name> · ` in front of their usual line. That keeps the iOS 6 grouped-row
    subtitle and adds no new controls.
  - `confirmReplace(entry)`: an iOS 6 alert titled "Replace App?" with the message "<installed> is already on this
    iPhone with the same ID. Installing <this> will replace it." and the buttons Cancel and Replace. The brief gave
    only the message; I added a short title because alerts here all have one.
    It runs in `queueLibraryInstall` (Cancel returns `"cancelled"`, which is truthy, so `install()` doesn't go on to
    `installFromLibrary`), in `priceInstall` (the row's button), in `install()` for the website and jailbreak
    branches, and in `signMany` (Cancel skips only that IPA).
  - Installs from the library now record `key: library:<file>`: the page Install's record, the row/bulk `recorder`,
    and the queued job's `key`, which `screens/queue.js recordApp` saves. This needed no change to
    `core/installed.js`, because `appRecord` already keeps `key`.
  - `refreshInstalled` stores `lib.shared` next to `lib.installed`, and redraws when either one changes.
- Tests: two new tests at the end of `myipas-page.test.js` and one at the end of `myipas-queue.test.js`.

## Notes

- The two RyukGram IPAs probably both say "RyukGram" in their Info.plist, so a record from before this change
  (no file key) can't tell them apart. Both rows then show the replace subtitle until one of them is installed again
  through iFizBox. That is what the brief asks for when nothing tells them apart.

## Not verified

- Not checked on a phone (the iPhone 7 or a sideload build). The task names only node tests and the gate, and the
  phone is shared with other slots. Not checked: how the subtitle looks on a real row and how long it can get before
  it is cut off.
- The website's link-only entries (`siteInstallSheet`) also show the warning. Whatever app opens the link is what
  replaces the installed app, and it can't record a key. This was not tested in a browser.
