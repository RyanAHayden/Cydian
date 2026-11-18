# F126: package icons like Cydia's

## Licence check
- Cloned Cydia's source (`git://git.saurik.com/cydia.git`; `https://` returned 503) at 837b7c8 (2019-05-20).
  `MobileCydia.app/Sections/` holds 39 section icons (120×120), `Purposes/` 7 badges (32×32), plus `unknown.png`.
  Their licence is the repo's `COPYING` (GPLv3). So I **copied** them (no redrawing) into `web/app/icons/sections/`
  (`purposes/` for the badges), with `icons/sections/README.md` (origin, commit, licence), a README.md line in
  place of "no Cydia artwork", and an Artwork group in Home > Credits.
- The 4S (Cydia 1.1.30) has 68 section icons: the same 39, plus 29 that third-party repos installed (`HYI_-_*`,
  `SiNfuL_iPhone`, `Planet-iPhones Mods`). Those aren't Cydia's and aren't included. I decoded the 4S's CgBI PNGs
  (tools/themecmp.py `load`) for Tweaks, Themes, unknown and extension: opaque pixels differ by at most 1 from the
  repo's (extension is identical), so the repo's files are what the 4S shows.
- `unknown.png` is a grey "?" tile, not Cydia's logo.

## What Cydia does (MobileCydia.mm) vs. the brief
- `Package -icon` (l.2863): own `file:///` Icon, else `Sections/<Simplify(section), spaces → _>.png`, else the
  source's Default-Icon, else `unknown.png`.
- PackageCell's corner badge (l.5393, 5487) is **not** the section icon: it's `Purposes/<primaryPurpose>.png`, from
  the package's first `purpose::` tag, drawn at half size centred at (36,36) over a 32 pt icon at (25,25), whatever
  the icon is.
- The brief asks for the section icon small in the corner on packages with their own icon. Both are done
  (core/sectionicons.js `packageIcon`): the purpose badge first (Cydia's), else, on a package showing its own
  icon, its section's icon. On the 4S the second case never shows (Cydia ignores http Icon: URLs in lists), so this
  can't make Cydian differ from what the user sees there. The section badge appears only once the own icon has
  loaded and goes away if it fails (then the section icon is the main icon).

## What changed
- `web/app/core/sectionicons.js`: section → icon (Sections.plist fixes via catalog.js `sectionName`, Simplify(),
  case-insensitive, aliases like Tweak/Theme/Utility/eBooks/Developer Tools, then the bracketed part, so AltStore's
  "Apps (Games)" gets Games), purpose badges, `packageIcon(row)`.
- `core/catalog.js`: rows carry `purpose` (first purpose:: tag), installed rows too (from the status stanza when no
  source has it).
- `screens/browse.js`: list rows and the package page header draw the fallback as the icon's background, the own
  icon over it, the badge over the corner (`createArt`/`paintArt`). The letter tiles and their tints are gone.
  Every package list (sources, sections, search, Installed, Changes, author, My IPAs' lists) goes through
  `packageList`, so all get it. `nav/vlist.js` needed no change.
- `packages.css`: `.pkg-art`, `.pkg-icon.cy`, `.pkg-badge` (16 px at 32, 32 px at 64).
- Tests: `core/sectionicons.test.js` (files exist, mapping, aliases, purpose badges, the badge rule, catalog rows).

## Checked
- `node --test web/app`: 788 pass.
- Headless Chromium render of a real `packageList` at 3x (`rows-3x.png`): Tweaks fallback, purpose badges
  (extension, uikit), section badge on own icons, Themes (SpringBoard) → Themes, Libraries → unknown.png, a failing
  own icon → section icon, no badge.

## Tried that failed
- First render was blank: the scratch page passed a string route; packageList wants `{ tab, path }`. Port 8765 was
  someone else's server; used a random port.

## Not verified
- The package page header (64 px icon, 32 px badge): same createArt/paintArt code as the rows, but not rendered —
  it needs a loaded catalog and backend, which the scratch page doesn't have.
- The native app (WKWebView) and the iPhone: not run; build.sh copies all of web/app, so the PNGs ship.
- Side by side with Cydia on the 4S: left to the user, as the brief says (no screen driving here).
- The 120 px section art at 64 pt on a 3x screen is upscaled (192 px needed); there is no larger original.
