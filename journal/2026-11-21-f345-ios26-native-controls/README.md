# F345: iOS 26 style with the real native controls (research and plan)

User, 2026-11-21: "the ios 26 liquid style should just use the actual native input boxes if possible". This task is
the research and the plan; the era itself is F203, and the native controls on top of it are filed as F345a–F345c
(below).

## What I did

1. Wrote `probe/index.html`: every HTML form control (text, search, select, date, time, `<input type=checkbox switch>`,
   checkbox, radio, range, progress, meter, button, submit, color, file, textarea, datalist), each with its default
   appearance (`appearance: auto`, no styling), once under `color-scheme: light` and once under `dark`. It also prints
   the user agent and whether `switch` is supported.
2. Served it over `tailscale serve --https` and opened it in Safari on the iPhone 15 Pro (iOS 27) through
   `tools/ui-15.sh` under its lock. Safari's form controls are drawn by the same WebKit as the app's WKWebView (the
   rendering is in WebKit's RenderTheme and the pickers are WebKit's UI-process code, not Safari's), so what Safari
   shows is what the app's web view shows.
3. Tapped the `<select>`, the date field and the search field and shot each.

Shots (not committed: they hold iOS's own status bar, keyboard and Safari chrome): `ref/15/screens/f345-probe-1.png`,
`f345-select.png`, `f345-date.png`, `f345-search-focus.png` in the main checkout's `ref/`.

## Findings: what WKWebView draws natively on iOS 26+

Seen on iOS 27 (the 15 Pro). The user agent says `iPhone OS 18_7` (WebKit froze the OS version in the UA on 26+), so
the UA can't tell iOS 26 apart in a web view.

| Control | Default look on iOS 26+ | When tapped | Native? |
|---|---|---|---|
| `<input type=text>`, `<textarea>` | white rounded rect with a hairline (dark: black with a grey hairline), system font | system keyboard (glass), blue focus ring, the form bar (up/down/✓) over the keyboard | yes, WebKit |
| `<input type=search>` | grey **capsule with the magnifier** and placeholder: the iOS 26 search field | as text; a blue ring round the capsule | yes, WebKit |
| `<select>` | grey capsule with the up/down chevrons: iOS 26's pull-down button | a **real glass UIMenu** anchored to it, check on the current item | yes, UIKit menu |
| `<input type=date>`, `time` | grey capsules ("Nov 21, 2026", "9:41 AM"), as iOS 26's compact UIDatePicker | a **real glass UIDatePicker** calendar with Reset and a blue ✓ | yes, UIKit |
| `<input type=checkbox switch>` | **iOS 26's switch**: wide track, wide pill knob, green on, grey off (dark: dark grey) | toggles | yes, WebKit (Safari 17.4+ has the attribute; the 26 shape is new) |
| checkbox, radio | rounded blue box / blue circle | — | yes, but iOS lists use checkmarks, not these |
| `<input type=range>` | blue track, white pill knob (iOS 26 slider) | drag | yes |
| `<progress>`, `<meter>` | blue / green capsule bars | — | yes |
| `<button>`, submit | grey capsule / blue filled capsule (iOS 26's gray and filled buttons) | — | yes |
| `<input type=color>`, `file` | colour well; "Choose File" capsule | UIColorPicker / the file menu (not opened: known WebKit behaviour) | yes |
| `<datalist>` | text field with a chevron | suggestions | yes |
| `alert()`, `confirm()`, `prompt()` | — | in Safari a UIAlertController; **in the app nothing**: the shell's `WKUIDelegate` (`App.swift` WebController) has no `runJavaScript…Panel` methods, and these calls block the page anyway | shell only |
| segmented control | none in HTML | — | **no** |
| nav bar, tab bar, bar buttons (glass) | none in HTML; CSS `backdrop-filter` blurs but can't refract (WebKit takes no SVG filter in `backdrop-filter`) | — | **no** (the shell draws no bars, `Bridge.swift` R3 (a)) |
| context menu at a point (long press) | none in HTML; WebKit's own menu is for links and images only | — | shell only |

Other things the probe showed:

- **Focus zoom.** Safari zoomed the page when the 15px search field took focus. The app's `index.html` viewport has
  `maximum-scale=1, user-scalable=no`, so the app doesn't zoom; the site in Safari does unless the field's text is
  at least 16px. The iOS 26 style's fields use 17px (UIKit's body size), which also avoids it.
- **The focus ring** is WebKit's blue ring outside the capsule. UIKit's search field shows no ring; the style should
  keep `outline: none` on focus and let the caret show the focus, as UISearchBar does.
- **Old WebKit draws old controls.** The style can be picked on any phone (the iPhone 7 runs iOS 15, the site runs in
  any browser). There `switch` is a plain checkbox and the search field is iOS 15's rounded rect. So "native" can't
  just be "appearance: auto": it needs to know the web view draws the iOS 26 controls.
- **Menus and pickers follow the shell's interface style**, which the shell already sets from the page's theme
  (`Bridge.swift` `Theme`), so a native menu goes dark with OLED Black without more work.

## Plan: the iOS 26 style

The iOS 26 era is F203: `web/app/ios26.css` plus its nav hooks (large titles, floating tab bar, card sheets), as
`docs/eras.md` lays out, with the floating tab bar, Search circle and capsule bar buttons drawn by the shell as
UIGlassEffect views on iOS 26+ (the user's call, in F203's note). On top of that, F345's rule: **a native control where WebKit or the shell has one; a CSS
look-alike only where nothing native exists, and on phones and browsers whose WebKit draws pre-26 controls.**

### One switch: the native controls hook

`<html data-controls="native">`: set only under `data-style="ios26"`, and only where the web view draws the iOS 26
controls:

- in the app: the shell's `app.info` `ios` is 26 or later (the UA can't say);
- on the site: Safari or a WebKit browser on iPhone/iPad whose `Version/` is 26 or later (Safari's UA keeps the
  real Safari version), or a feature test of something WebKit first shipped in 26, whichever the build finds
  reliable on both the 15 Pro and the iPhone 7.

Without it (iPhone 7, desktop Chrome, an old iPad) the same markup gets ios26.css's look-alikes.

### Per control

| What | With the native controls hook | Fallback (look-alike) |
|---|---|---|
| Search bar field (`nav/searchbar.js`, already `<input type=search>`) | `appearance: auto`: WebKit's capsule and magnifier; drop packages.css's `-webkit-search-*` hiding only where it hides the native clear; 17px; no focus ring | CSS capsule, the magnifier as a mask |
| Text fields in cells (signing rows, Add Source, Settings fields) | plain `<input>` with `appearance: auto` but no border or background inside a cell, as UIKit's cell fields are; standalone fields keep WebKit's rounded box | CSS |
| Switches (`nav/switch.js`, `screens/settings.js` makeSwitch) | an `<input type=checkbox switch>` in place of today's `<button class="switch">` art: WebKit's iOS 26 switch, `change` drives `onToggle`; the drag stays WebKit's | the button switch, restyled by ios26.css tokens (`--sw-*`) |
| Choice menus (sort orders, pickers with a fixed list) | a real `<select>`: its capsule is iOS 26's pull-down button and the tap opens the glass UIMenu; works on the site too | the CSS menu |
| Dates and times (if any screen grows one) | `<input type=date/time>` | — |
| Progress bars (the run page) | `<progress>` | CSS bar |
| Alerts and text prompts (`nav/alert.js` showAlert) | app: a bridge call `ui.alert` → UIAlertController (`.alert`), text field via `addTextField`, `cancel` → `.cancel`, `colors` red → `.destructive`, green → `preferredAction`; the page waits on its promise as today. Alerts using a countdown (F96) keep the CSS alert (UIAlertAction titles can't change); `input.paste` is dropped (the native field has Paste in its own menu) | CSS iOS 26 alert (34pt corners, glass ground, plain text buttons) |
| Action sheets (`nav/actionsheet.js`) | app: `ui.actionSheet` → UIAlertController `.actionSheet`, its popover's `sourceRect` from the tapped element's rect | CSS |
| Long-press menus (`nav/menu.js` showMenu) | app: `ui.menu` → a UIMenu at the anchor's rect: an invisible UIButton over that rect with `menu` and `showsMenuAsPrimaryAction`, opened with `performPrimaryAction()` (iOS 17.4+); if that doesn't open it, `UIEditMenuInteraction.presentEditMenu` (iOS 16+, public, at a point) | CSS menu |
| Segmented controls (`nav/ui.js` segments / segmented, Theme's Mode) | **look-alike in every case**: iOS 26's capsule track with a sliding selected pill. A UISegmentedControl laid over the page would have to follow WebKit's scroll views frame by frame and sit under the page's own sheets and alerts; not worth it | same |
| Nav bar, bar buttons, tab bar | F203's: UIGlassEffect views from the shell on iOS 26+ (the user decided this there) | CSS blur plus edge highlights (iOS 15–25, the site) |

Native calls are only made under `data-controls="native"` in the app (`hasNativeCall` and the shell answering the
method; an older shell without `ui.*` falls back to the CSS overlay), so iOS 6, 7 and 13 never change.

### Order

1. **F203** ios26.css, the Style row and the glass bars (the era itself; already queued, blocked on F202 and F324).
2. **F345a** the native controls hook plus native inputs, search field, switches, `<select>` menus, `<progress>`.
3. **F345b** `ui.alert` (UIAlertController) behind showAlert.
4. **F345c** `ui.actionSheet` and `ui.menu` (UIMenu) behind showActionSheet and showMenu.

Each checks on the iPhone 15 Pro (native) and the iPhone 7 (look-alike fallback).

### Notes for the builders

- `appearance` is not in `ios6-css.test.js`'s `LOOK` list, so an era stylesheet can't set it today. It paints and
  sizes nothing on its own; F345a adds it to `LOOK` (and says so in `docs/eras.md`'s Look list).
- WebKit's switch has its own size (about 64x28pt on iOS 26); the switch hooks (`--sw-w`, `--sw-h`) must match it
  so a row doesn't move between native and fallback.

## Tried and failed

Nothing failed. The phone was held by B272 and F346 for about ten minutes before the lock came free.

## Not verified

- **The app's WKWebView itself.** I probed in Safari, not in iFizBox: building and installing a probe build of Lite
  was more than the research needed, since form controls and their pickers are WebKit's, not Safari's. F345a's phone
  check sees them in the app.
- **iOS 26.0–26.x.** The phone runs iOS 27. The controls are expected to be the same on 26 (the shapes are the
  Liquid Glass ones 26 introduced), but no 26 phone is here.
- **`performPrimaryAction()` opening a button's menu, and the action sheet's popover look on iOS 26** are from
  memory of UIKit, not tried here; F345c tries them first and falls back as written.
- **The file and colour pickers** were not opened (nothing in iFizBox uses a colour well; file inputs already exist
  and work).
- **Dark mode menus/pickers in the app** follow the shell's interface style by design (`Bridge.swift` Theme); not
  shot in dark here.
