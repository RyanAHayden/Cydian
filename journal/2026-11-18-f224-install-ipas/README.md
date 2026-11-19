# F224: Install IPAs as one page for the user's own IPAs

User 2026-11-18 (concept artifact, board 'Install IPAs'): Install IPAs shows only the user's IPAs, iOS 6 style, with
App Store price buttons, Mail-style swipe Delete and Installed's Manage (F222).

## What I did

- `web/app/core/myipas.js`, a new F224 section (pure): `installedIdOf`, `ipaLine` ('Version x · size · Signed|Not
  signed'), `matchIpa`, `ipaSections` (Not Installed, then Installed, A-Z, with no empty groups), `priceButton` / `priceTap` /
  `priceAway` (grey SIGN, which reads INSTALL when a signed copy exists; the first tap turns it green INSTALL, the
  second installs; OPEN when installed; one tap in the jailbreak app and for a website link; nothing on a broken file),
  `priceProgress` (signing fills the first 60% of the button, installing the rest, and it never goes back), Manage's
  `ipaSelectSheet` / `ipaPresetFiles` / `ipaSelectLabel` (Select…/Deselect are imported from core/installed.js, F222's
  words), `ipaCounts`, `ipaSummary`, `ipaToolbar`, `ipaSheet`, `unsignEntries`.
- `web/app/screens/myipas.js`, the list page:
  - Browse is gone from the page (browseGroups, the placeholder rows, loadBrowse). The F79 sub-routes (search / apps /
    category) still render, for older links only.
  - Nav bar: back | Install IPAs | Manage (no Add). The page has a search bar ("Search IPAs") and an 'Add an IPA' group
    (Choose from Files / Download from URL; on the website, Choose File / Download from URL). Then `libraryGroup`
    draws the sections with the price button left of the chevron. The footer says you can share an .ipa from Files,
    Safari or Mail (the website and jailbreak app use their own wording).
  - Installed or not: `installedOf` asks the shell `apps.isInstalled` (it works in every build, F219; signing.* is
    refused in the jailbreak build) with the bundle ID the app was signed as. An unknown answer, and the website, fall
    back to Installed's records (recordInstall). The list is re-checked when the page becomes visible again.
  - Price button: `onPrice` → `priceInstall`. In the sideload app this is `installFromLibrary` with `buttonHud`, a HUD
    drawn on the button (SIGNING / INSTALLING, `--fill`), so no progress page opens. Errors still come up as
    installFromLibrary's alerts. The website's kept file uses `siteFileInstall` (its own progress page; the button
    shows SIGNING until it ends), a link uses `siteInstallSheet`, and the jailbreak app uses `jailbreakInstall` (as
    before). OPEN uses `signing.openApp` in the sideload app; elsewhere it shows an alert saying to open the app from
    the Home Screen. Tapping anywhere else turns a green INSTALL back to SIGN.
  - Swipe left (not managing): the red Delete replaces the button (sources.css .source-row .armed). `swipeDelete`
    deletes at once, with no sheet (the IPA and its signed copy: library.delete). A tap elsewhere hides it. The hold
    sheet's Delete still asks first (`deleteMany`).
  - Manage (`setManaging`): uses listStep with `editing` as Manage. Rows get packages.css `.manage-check` circles and
    `.picked` (F222's CSS, shared). Select… replaces the back button (`selectButton`: All IPAs / Not Installed (n) /
    Signed (n), or Deselect). The grey `.manage-summary` line reads 'N selected · X IPAs · Y signed · Z installed'.
    Search and the Add group hide. The toolbar is packages.css `.manage-toolbar`: Sign (n) blue, Unsign (n), Delete (n)
    red. `runManage` confirms with an action sheet, then: Sign goes through `signMany` (installFromLibrary per IPA
    with Installed's `bulkHud`, "Signing Delta (1 of 3)"; the first that doesn't install stops the run). Unsign and
    Delete show a HUD per IPA ("Unsigning Car (2 of 2)"). The jailbreak build shows Delete only; the website has no
    Unsign (it keeps no signed copies), and its Sign counts kept files only.
- `native/Sources/MyIPAs.swift`: a new `library.unsign {file}` (sideload only, SignBridge.run): `library.url` checks
  the name, then `IPALibrary.dropSigned`, and it answers the list. Unsign needed it; no existing call removes only the
  signed copy.
- `web/app/myipas.css`: the price button (packages.css `.store-btn`'s grey; the green confirm with its gloss split
  at half; a pale blue `::before` fill driven by `transform: scaleX(var(--fill))`), its place before the chevron
  (kept as the chevron's margin, given back when a row is swiped or Manage is on), and the Manage slide for
  `.myipa-row`. Dark rules use palette tokens. Removed F208's checkmark/Edit toolbar rules and the Browse placeholders.
- `home.js` needed no change: its Install IPAs tile is in every build (F222 already removed the way in from
  Installed).
- Tests: `core/myipas-page.test.js` (sections, line, the price button per build, the two-tap, the fill, presets,
  counts/summary/toolbar per build, sheets, Unsign against a fake library) and `screens/myipas-page.test.js`
  (groups, buttons and footer in the fake DOM, two-tap through on.price, the button HUD, swipe Delete with no sheet,
  Manage taps, Select… presets, runManage Unsign keeping files / Delete / Sign against a fake library backend,
  installedOf). `screens/myipas-edit.test.js` (F208's Edit with red minus, which no longer exists) is replaced by
  these. myipas.test.js and myipas-jailbreak.test.js were updated for the Manage button and the new wording.
- 3x render: `render.html` → `page-3x.png` (the list: SIGN, green INSTALL, INSTALLING at 62%, a swiped Delete,
  OPEN, then Manage with circles, the summary and the toolbar), `price-zoom.png`, `toolbar-zoom.png`.

## Decisions

- A signed but not installed IPA shows a grey INSTALL (not SIGN). It is still two taps (the second is green INSTALL),
  so a stray tap never installs.
- The jailbreak app and website links install in one tap: the jailbreak console and the link sheet each come with
  their own screen to back out of.
- On the website, OPEN can't launch an app, so it shows an alert. In the jailbreak app signing.openApp is refused,
  so it shows the same alert.
- Unsign's sheet is red: it deletes data.
- Swipe Delete deletes at once, as the brief says; the hold sheet's Delete still asks first.
- Manage's buttons share F222's CSS classes. I didn't touch installed.js; `bulkHud` is imported from it
  dynamically, which avoids an import cycle (installed.js imports myipas.js).

## Mistakes on the way

- I appended the new core/myipas.js section with a heredoc (`cat >>`) before remembering that the rules ask for the
  edit tool. Every change after that used the edit tool. The appended code is covered by the new tests.
- The first render drew the chevron left of the price button: the chevron is the cell's last flex item, and my
  padding pushed it inward. The button's room is now the chevron's left margin.

## Not verified

- On a phone: the price button's real install (installFromLibrary driving the button, followInstall's Done, and
  OPEN appearing once `apps.isInstalled` says yes), Sign (n)'s progress pages, Unsign and the swipe. No sideload test
  phone in this task, and the iPhone 7 is the jailbreak build (not driven: the task didn't ask for it). Only node
  tests with fakes cover these.
- `library.unsign` in Swift was not compiled: no Swift toolchain on this Linux machine, so check.sh skips the native
  builds here. The code is four lines over existing calls (`library.url`, `dropSigned`, `list`).
- The live page in a browser: the Select… swap in the nav bar, the circles sliding, the toolbar, hiding search and
  Add, and the "tap elsewhere" disarming were not clicked through. The app needs a bridge or backend to show the
  list; only the static still was rendered.
- On the website, bulk Sign signs kept files one after another in the browser; iOS may want a fresh tap for each
  install prompt (F121). Not tried.
- At 320pt wide the row line ellipsizes ("Version 1.5 · 10.0 …") because of the button's room. Wider phones show
  more. Not measured on device widths.
- Dark theme: not rendered.
