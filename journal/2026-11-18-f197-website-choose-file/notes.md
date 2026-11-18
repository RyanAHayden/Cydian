# F197 Website Install IPAs: Add > Choose File

User 2026-11-18: "the add button on the webpage doesnt have a browse button only a link... add the browse option".

## What changed
- `screens/myipas.js`: on the website Add opens an action sheet **Choose File / From URL**. Choose File makes a hidden
  `<input type=file accept=".ipa,application/octet-stream">` and clicks it from the sheet's tap (showActionSheet resolves
  inside the click, so Safari still counts the user activation). `addPickedFile` (HUD "Adding", alert on failure, then
  the IPA's page). A kept IPA's page shows Details (version, bundle ID, size, iOS) and Delete. Install calls
  `siteFileInstall` without awaiting anything first, so signInBrowser's F121 early itms link still opens inside the tap;
  the bytes are read from IndexedDB after.
- `core/myipas.js`: `addSiteFile` (checks .ipa name, `SITE_FILE_MAX` 400 MB, `navigator.storage.estimate` room, reads
  the IPA's info, stores the File in IndexedDB `cydian-myipas`/`files` keyed by its My IPAs name, then lists it as
  `{ stored: true, … }` in the same localStorage list as URL entries); `removeSiteEntry` (list + bytes);
  `openIpaStore` / `memoryIpaStore`. stateOf: a stored site entry is kind `file`, "Kept in this browser: Install signs it here".
- `core/ipainfo.js`: `readIpaFile` (zip directory via Blob.slice, so only the directory, Info.plist and icon PNGs are
  read, never the whole IPA; deflate via DecompressionStream) and `parseBplist` (Xcode writes binary Info.plists).
  The icon is the largest listed icon PNG that is not CgBI; most App Store builds only have CgBI or Assets.car, so
  their rows keep the letter placeholder.
- `signing-client.js`: `signInBrowser({ bytes })` (Uint8Array/ArrayBuffer/Blob, or a function answering one) signs
  those bytes instead of `downloadIpa(url)`; the page starts at "Reading". Missing bytes (Safari evicted them) give a
  clear "isn't kept in this browser any more" error. `signAndInstall` passes `bytes` through (also the F177
  No Certificate -> rememberInstall retry).

## Decisions
- Cap 400 MB: Safari before iOS 17 lets a site keep about 1 GB; one IPA plus its signed copy in memory while signing
  should fit. Bigger ones are told to use From URL (the Worker path caps at 512 MB anyway).
- The room check runs after reading the info (cheap) and before storing; a QuotaExceededError from the put gets the
  same "no room" message.

## Tests
`web/app/screens/myipas-file.test.js`: builds IPAs in node (stored + deflated entries, a hand-made bplist), checks
readIpaFile, a picked file becoming a My IPAs row, refusals (not .ipa, too big, no room, quota), Install handing the
kept bytes to the signer with no `/api/fetch` call and the early link opened first, evicted bytes, and Delete freeing them.

## Tried and failed
- Named the bytes helper `ipaBytes`: clashed with signInBrowser's existing local `ipaBytes` (TDZ error). Renamed `keptBytes`.

## Not verified
- On a real iPhone/Safari: the Files picker opening from the action sheet's tap, Blob storage in IndexedDB for a
  large IPA, `navigator.storage.estimate` values, and a full sign + install of a picked IPA. No phone driving was in
  this task's scope (and the iPhone 7 is for the jailbreak app); covered only by node tests with stubs.
- Zip64 IPAs are not read (refused as "zip directory can't be read"); not expected under the 400 MB cap.
- Private Browsing: if IndexedDB is refused the store falls back to memory for this visit (the entry stays listed but
  its bytes are gone after reload; Install then says so). Not tried in Safari.
