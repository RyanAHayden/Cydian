# F176: Copying Files guide: icons on every row, current computer options

## What I did
- `web/app/screens/guides.js`: `glyph(id, letter)` / `glyphSvg(id)` draw our own 29px iOS 6 tiles as inline SVG
  (top-lit gradient, white glyph with a dark drop, gloss over the top): Files (folder), AirDrop (radio waves),
  LocalSend (swap arrows), PairDrop (two phones), Mac (monitor), Windows (a generic app window, not the Microsoft
  logo), Linux (a penguin of our own), Filza (folder with a tree). The row's tile colour and letter stay under the
  picture as a fallback. No Apple, Microsoft or LocalSend artwork.
- No-jailbreak page (lite, and the jailbreak page's No Jailbreak segment): On iPhone rows now use glyphs;
  iTunes File Sharing is replaced by **From a Computer** with Mac (Finder, sidebar, Files tab, macOS 10.15+),
  Windows (Apple Devices app from the Microsoft Store, Files; replaced iTunes on Windows 10/11; or LocalSend) and
  Linux (LocalSend, PairDrop, `ifuse --documents <bundle id> <dir>` via libimobiledevice), footer "reach only apps
  that share their documents" with the brand NAME from brand.js; then **On Every System**: LocalSend and PairDrop
  (pairdrop.net, same Wi-Fi).
- Jailbreak Computer segment: SFTP fields kept; Apps is now one row per system with icon: Mac (Cyberduck,
  FileZilla), Windows (WinSCP, FileZilla), Linux (file manager's sftp://, FileZilla), plus a footer on sftp://.
- `web/app/guides.css`: `.guide-glyph` (picture over the tile) and `.guide-wrap-row` (subtitles that wrap).
- Tests (guides.test.js): every app/system row in both builds has an icon with an SVG glyph; glyph SVGs hold no
  external refs or text; no "iTunes File Sharing"; Mac/Windows/Linux rows in both builds with the named apps.

## Decisions
- "Every row has an icon" read as every row naming an app or a computer. The SFTP field rows (Protocol, Server,
  User, Port), Filza Can's feature list and the OpenSSH How-To link stay without icons: they're settings-style
  fields and a list, and icons there would not match iOS 6 tables. The test lists these exemptions.
- Gradient ids are per glyph (`b-<id>`), so inlining several SVGs in one document doesn't make them all one colour
  (found while rendering a preview sheet).

## Checked
- `node --test web/app/screens/guides.test.js` passes (9 tests).
- Rendered with headless Chromium at 2x: lite Copying Files page and the jailbreak build's Computer segment
  (Settings device set to rootless via localStorage on a local http.server). Shortened LocalSend's subtitle that
  truncated at 320pt.

## Not verified
- Not looked at on a real iPhone (the 7 or in the sideload IPA): the task didn't call for the phone; Chromium's
  render at 320pt width is the check.
- Dark theme render not checked: the glyph tiles carry their own colours and the rows use ios6.css's cells, so
  nothing theme-specific was added.
- The external facts (Apple Devices app on Windows 10/11, Finder since macOS 10.15, ifuse's `--documents` flag,
  pairdrop.net) come from the brief and my knowledge; not re-checked online.
