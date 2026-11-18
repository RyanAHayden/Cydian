# R20: Teehan+Lax iOS 7 and iOS 8 kits converted

Source: `ref/teehanlax/src/` (copied from the MBA's Downloads 2026-11-18). Output (gitignored, main checkout's `ref/`):

| | `ref/teehanlax/ios7/` | `ref/teehanlax/ios8/` |
|---|---|---|
| PSD | `teehanlax-iOS7-iPhone.psd` (46 MB, Oct 2013) | `teehanlax-iOS8-iPhone.psd` (111 MB, Oct 2014) |
| canvas | 5000 x 3921, 1268 layers | 6350 x 9100, 2567 layers |
| device | iPhone 5s/5c, screens 640 x 1136 (2x) | iPhone 6, screens 750 x 1334 (2x), plus "Zoomed" home screen |
| `sheet.svg` | 980 `<title>`s, 655 bitmaps in `img/` | 1995 `<title>`s, 1335 bitmaps in `img/` |
| `original-2x.png` | Photoshop's stored composite | same |
| `img-hd/`, `sheet-hd.svg` | 4xHDcube4, saved at 2x RGBA | same |

## How (repeatable)

ios5/ios6 were made with **psd2svg 0.15.0** (it is in the uv cache; the SVG's `id="shape"`/`mask_N`/`transform-origin`
gradients match). Nobody wrote the command down, so here it is:

- iOS 7: `cd ref/teehanlax/ios7 && uvx --from psd2svg==0.15.0 psd2svg --enable-title --image-prefix img/ --image-format png ../src/teehanlax-iOS7-iPhone.psd/teehanlax-iOS7-iPhone.psd sheet.svg`
- iOS 8: the same command dies with `psd_tools ParseLimitError: max_objects exceeded: 1000001 > 1000000` (the text
  engine data of its 600+ text layers). `--unlimited-resources` does not help: it lifts psd2svg's limits, not
  psd-tools' parse limits. A small driver opens the PSD with
  `PSDImage.open(path, parse_limits=ParseLimits(max_objects=None, max_nesting_depth=None))`, then calls
  `SVGDocument.from_psd(psd, enable_title=True, resource_limits=ResourceLimits.unlimited())` and
  `doc.save('sheet.svg', embed_images=False, image_prefix='img/', image_format='png')`. Run with
  `uv run --no-project --with psd2svg==0.15.0 python -I driver.py`.
- `original-2x.png`: `psd.topil().convert('RGB')` (the merged image Photoshop saved in the file). Same size as the sheet.
- `img-hd/`: chaiNNer's bundled Python (`~/.local/bin/chainner-app/python/python/bin/python3.11`, has torch 2.8 ROCm +
  spandrel 0.4.1; `bin/python3` there is an empty file) loads `~/.local/bin/chainner-app/Models/HDcube/4xHDcube4.pth`.
  Each `img/*.png` goes through the model at 4x in 512 px tiles (32 px overlap, fp16 on the GPU), alpha as a separate
  grey pass, then Lanczos down to 2x RGBA, which is what ios6's `img-hd/` holds (e.g. `07.png` 640x1136 grey ->
  1280x2272 RGBA). `sheet-hd.svg` = `sheet.svg` with `href="img/` -> `href="img-hd/`.
  Took about 15 min for iOS 7 (655 files, 54 Mpx) and 25 min for iOS 8 (1335 files, 84 Mpx) on the shared GPU.

### Upscaling: what failed first
- One run with tiles cut to whatever fits (512 + 32 overlap, edge tiles smaller) wrote nothing in 17 min, then died:
  `HIP out of memory. Tried to allocate 3.65 GiB ... 2.09 GiB is free` (other sessions held most of the 16 GB).
  On ROCm each new input shape also starts a MIOpen kernel search, and ragged edge tiles plus 600+ small bitmaps
  are hundreds of shapes.
- What works: the model only ever sees three input sizes (128, 256 or 384 px square: the image cut into cores of
  size-64 with 32 px of edge-replicated context each side, smallest size that fits, else 384 tiles) and
  `MIOPEN_FIND_MODE=FAST`. Small bitmaps take 0.1 s, a 640x1136 screen about 8 s.

## Checks

Rendered each `sheet.svg` with headless Chromium at 1x and compared it with `original-2x.png` by eye (PSNR 22.4 dB for
iOS 7, 17.7 dB for iOS 8). `sheet-hd.svg` renders match the plain renders at 43 dB (iOS 7) and 45 dB (iOS 8, top
7000 rows), so every HD bitmap sits exactly where its original did. Against the composite the HD renders score 22.4 dB
(iOS 7) and 19.6 dB (iOS 8, whole sheet). Bars, buttons, switches, tables, keyboards, maps and icons line up. Known psd2svg gaps,
the same kind ios6 has: use `original-2x.png` for these.
- Paragraph (box) text is one unwrapped line that runs past its box (mail previews, footers, bubbles, the Info blurb).
- Some layer-effect colour overlays are lost: iMessage blue bubbles render grey, the share sheet's second row
  (Bookmark, Add to Reading List...) loses its icons, the white switch-off track loses its grey outline in places.
- Lock-screen photo smart objects (iPhone 6 lock screen, iOS 7 Control Center backdrop) render dark or missing.
- iOS 8 needs `--virtual-time-budget=120000` in Chromium, or the screenshot is taken before the bitmaps load and
  only the top third is painted. Even with it, one plain `sheet.svg` render dropped the bottom row (keyboards,
  logo) that the `sheet-hd.svg` render drew. Render twice if something is missing.

## What each kit covers (layer group names, for F201-F203)

**iOS 7** (standalone elements down the left, then full screens):
- Status bars: black, white, black/white lock-screen variants (with Bluetooth and battery %), and inside every screen.
- Navigation Bar (title + Done + segmented control), Navigation Bar (with back), Navigation Bar (search), Toolbar
  (Button (Blue Text)), Tab Bar (Favorites/Recents/Contacts/Keypad/Voicemail), Segmented Control, Back button, Button.
- Switch (on) / Switch (off) (105 x 65 incl. shadow, 59 px knob), slider, Page Control, icon badges
  ("icon notification (1)/(36)"), glyphs: Delete icon, selection, Add, +, info icon, Check, Chevron, Sort, Text
  cursor, Loading spinner, Siri wait, Wifi icon, Locked, Star, Attachment.
- Contextual menu (Select / Select All / Paste), keyboards (stacked variants), Alert (two buttons), Actions Sheet
  (6 rows + Cancel, red destructive row), Send to (AirDrop share sheet).
- Screens: Table View 1 (Settings-style grouped list with coloured icons, Chevrons, Dividers), Table View 2 (Contacts:
  search bar, A/B sections, Index), Table View 3 (grouped with switches, footers, section header, check rows),
  Mail (Mailboxes, inbox, search), Safari (address bar, toolbar), Map (address bar, callout, pin, toolbar),
  iMessage (with and without keyboard), Control Center, lockscreen Siri, Notifications (Today/All/Missed,
  Calendar, Stocks, Tomorrow), lock screens on iPhone 5S Black/Gold and 5C Blue.

**iOS 8** (an "iOS 8 Elements" panel, then screens grouped by app):
- Elements: status bars (black, white, lock-screen pair), Switch (on/off) (same 105 x 65), slider, Select / Select All
  (/ Paste) menu, map Callout ("1 min" car badge), full-width white Button ("Button copy goes here"), a 3-segment
  control, glyph row (back chevron, page dots, reload, check, lock, wifi, info, share, bookmarks, tabs, add, compose,
  camera, mic), home-screen Icons with badges, Bookmark/Home Screen share tiles, Speech bubbles (blue, grey),
  Recorder elements (x, send arrow, play, record, audio waveform pill).
- Navigation: Navigation Bar, (with back), (with menu: Standard/Zoomed segmented + page dots), (with search), Menu.
- Keyboards: 'Go', with Siri (mic key), General, Search, Emoji (new category bar along the bottom).
- Screens: Settings (3 sections), Sounds (slider, switches, ringer section), Wifi (network list with lock/wifi/info,
  spinner by "Choose a network...", Ask to Join), Contacts (search, side index, tab bar), Button List (action sheet:
  One-Six + Something Else + Cancel), Mail (Mailbox x2, Swipe Left with More/Flag/Archive, Swipe Right with Mark as
  Unread), Maps (Location, Directions with Drive/Walk/Apps), iMessage (collapsed keyboard, New message, Messaging
  using Siri / audio recorder), Safari (browser, Share sheet with More and Print), Spotlight (search, results),
  Control Centre, Notification Centre (Today/Notifications, Calendar, Stocks, Tomorrow, Edit), phones (iPhone 6
  Black/Gold/White: lock screen, Touch ID passcode, dialer), home screens Standard and Zoomed.

## How iOS 8 differs from iOS 7 in these kits

- **Device and size**: iPhone 6, 750 x 1334 (375 x 667 pt) instead of 640 x 1136. The kit notes that "Zoomed" mode
  scales the 640 x 1136 layout up. Status bar is still 40 px (20 pt), bars 128-133 px with status bar. Rows,
  switches (105 x 65 incl. shadow), back chevron and glyph sizes are unchanged; things just get wider.
- **Same palette**: tint #0079fe/#0079ff (iOS's #007aff), switch green rgb(77,216,101), grouped background
  rgb(239,239,244), cells white, tab bar rgb(249,249,249), dividers #adadad / black at 0.2-0.3. The nav bar in the
  iOS 8 composite samples rgb(246,246,247) vs rgb(248,248,248) in iOS 7: translucent bars over different content,
  not a real change.
- **New in 8**: emoji keyboard with bottom category bar; keyboard variants (Go/Search action keys in blue); mail
  swipe actions (More/Flag/Archive, Mark as Unread); Messages audio recording (record button, waveform pill, send
  arrow); share sheet "More" and Print; Control Centre AirDrop shows "Everyone"; Notification Centre has two tabs
  (Today/Notifications) instead of three (Today/All/Missed) and an Edit button; Spotlight moved to its own screen
  with grouped results; Touch ID passcode screen; Maps Directions with Drive/Walk/Apps segmented control;
  Navigation Bar (with menu).
- **Type**: both are Helvetica Neue (iOS 7/8 system font) with weights 100-700. iOS 8 adds Avenir only for the
  sample web page and the kit's own header text, not for UI.
- **Same look otherwise**: flat bars, hairline dividers, chevron back button with label, borderless text buttons,
  rounded 1 px outline segmented control: iOS 8 is the iOS 7 style on a bigger screen.

## iPhone_Sketch_Elements.ai

`ref/teehanlax/src/iPhone_Sketch_Elements_v1/iPhone_Sketch_Elements.ai` is Teehan+Lax's **"iPhone IA Elements
version 1.0"**: an Adobe Illustrator CS4 file (PDF 1.5 compatible, one 738 x 959 pt artboard, made 2010-05-17) of
grey, hand-sketched **wireframe** stencils for iPhone OS 3 at 1x (320 x 480): status bars, nav bars ("Screen Name"),
toolbars, segmented controls, URL and search fields, buttons, table rows, a map with pins and an "Apple" callout,
an "Example YouTube screen" (video list, tab bar, video player), picker wheels, a checked selection list, keyboards
(with a popped key), copy/paste menu, an alert, ON/OFF switches, sliders and page dots. It is for sketching
information architecture, not pixels: no exact colours or sizes for any era. Not converted (`pdftoppm` renders it if
anyone needs a look: `pdftoppm -r 150 -png <ai> out`). `__MACOSX/` folders beside the files are zip resource forks.

## Not verified

- `img-hd/` quality was looked at by eye on one crop only (iOS 7 `03.png`, the phone earpiece: sharp, alpha kept).
  The full-sheet renders above prove placement and sizes, not upscale quality file by file.
- The helper scripts (driver, upscaler, sheet-hd writer) lived in the session scratchpad and are not committed.
  ref/ is gitignored and AGENTS.md keeps the gate stdlib-only; the steps above are enough to redo the work.
- The `render-4x.png` that ios6 has (sheet-hd.svg rendered at 4x for `tools/kitmatch.py`) was not made for ios7/ios8:
  the brief lists only sheet.svg, original-2x.png, img/ and img-hd/, and kitmatch matches 4S iOS 6 artwork, which
  these kits do not contain.
- No iOS 7/8 device was compared against the kits (none to hand; the 4S is iOS 6).
