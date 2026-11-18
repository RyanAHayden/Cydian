# F208: My IPAs: easy managing and deleting from the list

## What I did

- `core/myipas.js` (new section at the end, nothing above it changed):
  - `totalSize`, `libraryFooter`: "3 IPAs · 120 MB" (links count 0 bytes), shown as the My IPAs group's footer.
  - `listState` / `listStep`: the list's edit, swipe and selection state as pure data (edit, done, swipe left/right,
    minus, tap, selectAll, deselectAll, deleted, list). `tapOpens` says whether a tap is the row's link.
  - `holdActions`: Install, Sign Now, Save Signed IPA, Delete (app); Install, Delete (website); Delete only for an
    unreadable IPA.
  - `deleteEntries`: deletes several, one failing doesn't stop the rest. Website: `removeSiteEntry` (record and the
    IndexedDB bytes). App: `library.delete` per file (the shell answers `{ipas}`).
  - Labels: `deleteLabel(n)` "Delete (n)", `deleteButtonText(n)` "Delete n IPAs", `deleteSheetTitle`.
- `screens/myipas.js`:
  - `libraryGroup(list, {site, state, on})` draws the list (replaces `draw`'s body). Rows carry sources.css's
    `.source-row` controls (red minus, red Delete) as Installed's rows do. The swipe is Installed's B36
    `attachRowGestures` pattern (installed.js doesn't export it and isn't on this task's file list, so it is a
    copy rather than a shared import). A hold uses `nav/menu.js longPress`.
  - Nav bar: `[Add, Edit]`. Edit becomes the blue Done and hides Add. Edit hides itself when the list is empty.
  - Edit mode: a tap ticks a row (pale blue fill and a checkmark). The bottom toolbar (`.myipa-toolbar`, the nav
    bar's gradient, docked above the tab bar like the undo bar) holds Select All / Deselect All and a red
    Delete (n), disabled at 0. Leaving the page (hashchange, another tab) ends edit mode, so the toolbar never shows
    over another page.
  - Every delete (swipe Delete, the minus's Delete, Delete (n), the hold's Delete) goes through `deleteMany`: an
    action sheet ('Delete n IPAs' red / Cancel), then `deleteEntries`, then the list is drawn again with its new
    footer total. Failures come up in one "Couldn't Delete" alert naming the IPAs.
  - `rerender` now accepts a null body (the hold's Sign Now has no IPA page to redraw).
- `myipas.css`: the ticked row, the toolbar, the red bar button (light and dark themes), and room at the page
  end while the toolbar shows.
- Tests: `core/myipas-manage.test.js` (footer, labels, swipe/edit state machine, hold actions, multi-delete on the
  website with stored bytes freed, multi-delete in the app with a failure in the middle) and
  `screens/myipas-edit.test.js` (fake DOM: rows wear the controls, footer text, swipe arms one row and eats the tap,
  edit-mode minus/tick/Select All/Done, hold blocked while editing or armed, the confirm sheet's text, Cancel keeps
  everything, the failed-delete alert).

## Checked on the iPhone 7

- Built and installed the branch's .deb (0.9.6-1323, still installed). **In the jailbreak app `ifizbox://myipas`
  is "Not Found"** (`ref/7/screens/f208-list.png`): installed.js `pageKind` sends every path to browse when
  `recordsApps` is false, so the jailbreak app has no Install IPAs page at all, before and after this task. Fixing
  that is installed.js's routing, outside this task's files: filed as **F209**.
- So I checked the website build in Safari on the iPhone 7: the worktree's `web/app` served from the desktop through
  an `ssh -R` tunnel (the desktop's firewall blocks LAN port 8765), with a seed page that wrote three links into
  `ifizbox.myIpas`. Screenshots in `ref/7/screens/`:
  `f208-site-list` (Add + Edit, footer "3 IPAs"), `f208-site-swipe` (left swipe shows the red Delete),
  `f208-site-edit` (red minuses, two rows ticked, toolbar Select All / Delete (2)), `f208-site-minus` (minus turned
  upright, Delete showing), `f208-site-confirm` (sheet "Delete 2 IPAs" / Cancel), `f208-site-deleted` (one row left,
  footer "1 IPA", Delete disabled), `f208-site-hold` (hold sheet Install / Delete), `f208-site-picked` (the fill now
  covers the whole row, under the minus too), `f208-site-tabswitch` (switching tab ends edit mode, toolbar gone).
- After the edit screenshot I widened the ticked fill from `.cell-inner` to the whole row (it left a white strip
  under the minus); `f208-site-picked` shows the fix.

## Gate fallout, fixed

- `screens/myipas.test.js` read `nav().right.label`; the list's `right` is `[Add, Edit]` now, so the two asserts
  read the array.
- `theme-palette.test.js` allows only palette tokens (and black or white at .15/.18) in dark rules. The dark ticked
  fill is `rgba(255,255,255,.15)`. The red Delete (n) has no dark rule now: its one selector,
  `.myipa-toolbar .bar-button.myipa-delete-many:not(.back):not(.done)` (0,5,0), beats the dark bar button (0,4,1).
  That selector change came after the phone screenshots. In the light theme it draws the same as before, but I
  didn't take a new screenshot of it.

## Tried and failed

- Serving to the phone at `http://192.168.0.118:8765` directly: no connection (desktop firewall). The tunnel worked.
- Serving `web/app` under `/app/`: the app sends itself to the site root, so the scratch server links every file
  of `web/app` at its root instead.

## Not verified

- **The sideload app** (Sign Now / Save Signed IPA from the hold sheet, `library.delete` deleting several IPAs and
  their signed copies): the iPhone 7 runs the jailbreak build only, and the jailbreak build has no My IPAs page
  (F209). Covered by node tests with a fake `library.delete` only.
- **The jailbreak app**: unreachable (F209), see above.
- **Website stored IPAs (IndexedDB)**: on the phone I seeded links only (adding a picked file needs Files and
  taps through the picker). Deleting stored IPAs and freeing their bytes is covered by node tests with
  `memoryIpaStore`, not by real IndexedDB in Safari.
- **Share**: the brief says "Share/Save Signed IPA". The app's hold sheet has Save Signed IPA (`library.export`
  opens iOS's share sheet, which includes Files, AirDrop and other apps). The website's sheet has no Share: its
  stored IPA is unsigned, and a link has nothing to share but the link.
- **Dark theme** look of the toolbar, the red Delete (n) and the ticked row: written, not looked at on the phone.
- The two background helpers I started for the phone check (the scratch HTTP server and the ssh tunnel) were
  started without keeping their pids. They end by themselves on their `timeout` (30 and 25 minutes).
