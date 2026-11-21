# Eras

iOS 6 is the base style. An era is another iOS look (iOS 7, iOS 13, iOS 26) over the same markup, chosen by
`<html data-style="ios7">` (or `ios13`, `ios26`) and drawn by one stylesheet, `web/app/ios<N>.css`, loaded after
`ios6.css`. This page says what makes an era clean, how the look is split from the layout so it can be, and what is
clean today.

## Definition of clean

An era is clean when all of these hold:

1. **One stylesheet plus named hooks.** Everything the era changes is in `web/app/ios<N>.css`: token values, hook
   values and look-only rules. No other file gains an `html[data-style=…]` selector, except a named hook in `nav/`
   that the era turns on (large titles, a floating tab bar, card sheets), listed under [Hooks](#hooks).
2. **Zero layout overrides.** No rule in the era sets a layout property. Geometry it needs to change (a cell's height,
   a group's inset, a bar button's padding) moves only through the hooks in `style.css`. A look rule in the era may
   restyle any look property of an iOS 6 rule.
3. **A test that fails if a look rule sets layout.** `web/app/ios6-css.test.js` holds it:
   - every era stylesheet (`web/app/ios<N>.css` other than `ios6.css`) contains only look properties and custom
     properties;
   - every look-only stretch in any `web/app/*.css` (below) contains only look properties;
   - the nav bar, bar button, tab bar and grouped table selectors have no rule in `ios6.css` outside a look-only
     stretch, with or without an `html[…]` qualifier in front.
4. **No visible change in iOS 6.** Splitting a component for eras keeps every pixel and every computed style of the
   iOS 6 page: check it with a 3x screenshot and computed-style diff against main
   (`journal/2026-11-20-c44-era-readiness/shots.mjs` then `diff.py`, both themes and every palette).

An era is ready to build when the components it restyles meet 1 to 4. Today only the four below do.

### Look and layout

Look is what paints: `color`, `background*`, `border*` (including radius, image and width), `box-shadow`,
`text-shadow`, `filter`, `backdrop-filter`, `opacity`, `mask*`, `outline*`, `font*`, `line-height`,
`letter-spacing`, `word-spacing`, `text-align`, `text-transform`, `text-decoration*`, `caret-color`,
`color-scheme`, `content`, `fill`, `stroke*`, `list-style*`. The test's `LOOK` pattern is the list.

Everything else is layout: the box (`display`, size, `margin`, `padding`, `box-sizing`), position (`position`,
insets, `z-index`, `transform`), flex and grid, `overflow`, wrapping and truncation (`white-space`, `text-overflow`,
`overflow-wrap`), and behaviour (`cursor`, `touch-action`, `pointer-events`, `user-select`, `will-change`,
transitions and animations). Type sizes, line heights and border widths count as look on purpose: an era's
titles, labels and hairlines are its own. With `box-sizing: border-box` everywhere they don't resize a box that has
a fixed size. They do resize a box sized by its content (a group header, a label, a table's outline), and that
change is part of the era's look. The test cannot tell those cases apart, so this is a choice and not something it
enforces.

Some geometry of the four components has no hook yet and stays fixed: the icon bar button's 43px, the cell icon's
29px, the cell count pill, the chevron's 9x13px box and the badge's offset over the tab icon. A hook goes in
`style.css` the first time an era needs to move one.

### Look-only stretches

A stylesheet marks the rules that only paint:

```css
/* ==== look-only { ==== what these rules paint */
.navbar { background: var(--nav-bar); }
/* ==== } look-only ==== */
```

Stretches do not nest and are always closed. For the shared chrome (`ios6.css`), the layout of what a stretch paints
lives in `style.css`'s "Era hooks". A component stylesheet (`packages.css`, `sources.css`, …) keeps its layout in
its own rules beside its stretches.

## Tokenising, not overriding

A spike restyled the nav bar, tab bar, grouped tables and bar buttons as iOS 7 both ways
(`journal/2026-11-20-c44-era-readiness/`, renders in `spike-ios7-*.png`).

| | Overriding (era rules over today's `ios6.css`) | Tokenising (after the split) |
|---|---|---|
| Rules in the era | 42 | 12, all look-only |
| Declarations | 97 | 24, plus 85 token values |
| Layout declarations | 17 | 0 |
| Declarations undoing iOS 6 (`none`, `0`, `transparent`) | 46 | 4 |
| Specificity fights | dark and red bar buttons (`:not(.back):not(.done)`) need their own heavier rules | none: dark rules read the same tokens |

Overriding makes every era undo iOS 6 property by property, and every later iOS 6 change leaks into each era.
Tokenising puts iOS 6's decorations and geometry behind custom properties that an era sets, so the era is mostly two
token blocks. `@layer` would have let an era sit under iOS 6 without specificity work, but it needs Safari 15.4 and
the app supports iOS 15.0, so cascade layers are out.

## Writing an era

- **Hooks** (geometry) go on `html[data-style="ios7"]`: they are the same in both tones.
- **Colours and decorations** go on `html[data-style="ios7"][data-theme="light"]` and
  `html[data-style="ios7"][data-theme="dark"]`. A colour token on bare `html[data-style=…]` has the same specificity
  as `ios6.css`'s `html[data-theme="dark"]` block and comes later, so it wins in dark too.
- **Dark** keeps `ios6.css`'s dark rules, which paint with `--dk-*` tokens (`--dk-nav-bar`, `--dk-tabbar`,
  `--dk-btn`, `--dk-back`, …): the era sets those in its dark block, plus the shared tokens (`--table`, `--head`, …).
- **Palettes** set the same tokens from `html[data-theme][data-palette]` (the light ones map their `--lt-*` colours
  onto `--nav-bar`, `--bar-btn*`, `--bar-back*`, `--search-*`, `--scope-seg*` and `--store-head*` in one
  `html[data-theme="light"]:is(…)` block), never heavier than html plus two attributes: the weight of an era's tone
  block, which wins because it is linked later (`palettes.test.js` holds both). So every token an era sets beats
  every palette, light or dark, and the era's dark block needs no extra weight. The tokens it does not set would
  still come from the palette, half-painting it, so **an era offers only its own themes** (White and OLED Black):
  the theme menu must hide the palettes while an era is chosen, and the app set no `data-palette` under it (a saved
  palette waits for iOS 6). Two palette rules still paint chrome: the App Store segmented control (`ios6.css`'s has
  no tokens yet) and Brushed Metal's etched text; with the palettes hidden they never meet an era.
- **Order**: link `ios<N>.css` after `palettes.css`; `wide.css` is layout and can stay last.

## Hooks

### Geometry (style.css, "Era hooks")

| Hook | iOS 6 | What it moves |
|---|---|---|
| `--bar-btn-h`, `--bar-btn-min-w`, `--bar-btn-pad` | 29px, 50px, 0 9px | a bordered bar button |
| `--bar-back-h`, `--bar-back-pad` | 30px, 0 5px 0 1px | the back button (its arrow is the border) |
| `--tab-item-h`, `--tab-item-margin`, `--tab-item-pad-top` | 44px, 3px 2px 0, 3.5px | a tab inside the 49 pt bar |
| `--tab-icon-size`, `--tab-label-gap` | 28px, 1px | the tab glyph and the space under it |
| `--badge-h`, `--badge-pad` | 20px, 0 5px | the red count badge |
| `--group-margin`, `--group-gap`, `--group-first-head` | 10px 10px 0, 23px, 10px | grouped tables: inset, space between, the first header |
| `--group-head-margin`, `--group-foot-margin` | 0 9px 7px, 7px 9px 0 | a group's header and footer |
| `--cell-min-h`, `--cell-pad`, `--cell-gap` | 43px, 0 10px, 8px | every table cell |

The bars' own heights (`--nav-h`, `--tab-h`) are layout that every screen depends on; an era that changes them
(large titles, a floating tab bar) does it through a nav hook, not by setting them.

### Look tokens (ios6.css)

- Nav bar: `--nav-bar`, `--nav-shadow`, `--nav-title`, `--nav-title-emboss`, `--site-strip`; dark `--dk-nav-bar`,
  `--dk-nav-shadow`, `--dk-ground`.
- Bar buttons: `--bar-btn`, `--bar-btn-edge`, `--bar-btn-edge-top`, `--bar-btn-text`, `--bar-btn-emboss`,
  `--bar-btn-shadow`, `--bar-btn-pressed`, `--bar-btn-pressed-edge`, `--bar-btn-pressed-edge-top`, `--bar-back`,
  `--bar-back-pressed` (a border-image drawn in a 13px left, 5px right slot); red `--lt-red*`; dark `--dk-btn`,
  `--dk-btn-edge`, `--dk-btn-pressed`, `--dk-back`, `--dk-red*`.
- Tab bar: `--tabbar`, `--tabbar-shadow`, `--tab-text`, `--tab-text-active`, `--tab-active`, `--tab-active-edge`,
  `--tab-icon`, `--tab-icon-active`, `--tab-icon-emboss`, `--tab-icon-emboss-active`, the glyph per tab
  (`.tab[data-tab] { --glyph }`); badge `--badge`, `--badge-ring`, `--badge-shadow`; dark `--dk-tabbar`.
- Grouped tables: `--grouped-ground` (also pull to refresh's area on a grouped page), `--table`, `--table-edge`,
  `--table-inset`, `--divider`, `--divider-hi`, `--head`, `--emboss`, `--text`, `--subtitle`, `--detail`, `--count`,
  `--chevron`, `--select`.

### Nav hooks

iOS 13 and iOS 26 need three, each off in iOS 6:

- **large titles**: `<html data-nav="large">`, set by the era's JS through `nav/navbar.js` `setLargeTitles(true)`.
  Each tab's root page draws its title as a 34px bold left `.large-title` at the top of its body, which scrolls with
  the content; as it goes under the nav bar it fades out and the bar's `.nav-title` fades in (from half way).
  Opacity only, once a frame. Pushed pages and
  pages whose title is a control keep the bar title. Hooks in `style.css`: `--large-title-h` (52px, also the
  collapse distance) and `--large-title-pad` (3px 16px 8px); its type is look an era may restyle on `.large-title`;
- a floating tab bar pill, Search as its own circle, content scrolling under it (`nav/tabbar.js`, `style.css`), not
  built yet;
- **card sheets**: `<html data-sheet="card">`, set by the era's JS when it is chosen. A modal sheet (`nav/sheet.js`)
  stops below the status bar as a card with rounded top corners, and the page behind it (the nav bar, the screens
  and the tab bar) scales back about the screen's centre and dims onto the black ground. It comes back when the
  last card sheet closes. Transform and opacity only. Hooks, with their card values from `packages.css` (an era may
  set its own on `html[data-style=…][data-sheet="card"]`):

  | Hook | iOS 6 | Card | What it moves |
  |---|---|---|---|
  | `--sheet-top` | 0px | safe top + 10px | the gap above the sheet |
  | `--sheet-bar-top` | safe top | 0px | the status bar's room inside the sheet's bar |
  | `--sheet-radius` (look) | 0px | 10px | the sheet's top corners |
  | `--sheet-behind-scale`, `--sheet-behind-shift`, `--sheet-behind-opacity` | not used | 0.92, 0, 0.75 | the page behind (shift in px, down) |

### Overlays (nav/)

The overlays `nav/` draws build markup with the classes below and nothing else: no colour, SVG art or inline style
that paints comes from their JS (inline styles left are geometry and motion: a menu's position, a banner's drag, a
row's swipe offset). Their art is CSS, so an era restyles an overlay by setting its tokens or writing look rules
against these classes. The classes and states are the hooks: keep them when an overlay's markup changes.

| Overlay | JS | Classes and states | Look today |
|---|---|---|---|
| Alert | `alert.js` | `.alert-scrim`, `.alert`, `.alert-title`, `.alert-message`, `.alert-field`, `.alert-field-row`, `.alert-paste`, `.alert-buttons` (`.stacked`), `.alert-button` (`.cancel`, `.green`, `.red`) | `sources.css`, literal |
| Action sheet | `actionsheet.js` | `.action-scrim`, `.action-dim`, `.action-sheet`, `.action-title`, `.action-list`, `.action-button` (`.destructive`, `.cancel`) | `packages.css`, literal |
| Share sheet | `sharesheet.js` | `.share-scrim`, `.share-dim`, `.share-sheet`, `.share-pages`, `.share-grid`, `.share-item`, `.share-icon` (`.system`, `.app`, `.has-image`), `.share-glyph` (`.glyph-copy`, `.glyph-qr`), `.share-letter`, `.share-image`, `.share-label`, `.share-dots` (`span.on`), `.share-cancel`; the nav bar's `.share-button` | `ios6.css`, tokens: `--share-*`, the glyphs `--share-glyph-copy`, `--share-glyph-qr`; an app's own colour comes in `--share-tint` |
| HUD | `hud.js` | `.hud-scrim`, `.hud`, `.hud-spinner`, `.hud-label`, `.hud-check` | `ios6.css`, tokens: `--hud`, `--hud-text`, `--hud-emboss`, `--spinner-large`, `--hud-check` (the checkmark's art) |
| Spinners | `spinner.js` | `.hud-spinner`, `.reload-spinner`, `.pull-spinner`, `.badge.spinning`, `.source-row.is-loading` | `ios6.css` tokens `--spinner-white`, `--spinner-gray`, `--spinner-large` |
| Reload bar | `reloadbar.js` | `.reload-bar`, `.reload-spinner`, `.reload-text`, `.reload-cancel` (a `.bar-button.done`) | `ios6.css`, literal |
| Section index | `sectionindex.js` | `.section-index` (`.held`), its letters (`.section-index span`) | `packages.css`, literal |
| Row swipe | `rowswipe.js` | `.row-swipe` (`.armed`, `.hint`, `.swiping`, `[data-kind="add"|"remove"|"cancel"]`), `.row-swipe-control` | `packages.css`, literal |
| Banner | `banner.js` | `.banner`, `.banner-icon`, `.banner-text`, `.banner-action` (a `.bar-button.done`), `.banner-timer` | `ios6.css`, literal |
| Undo bar | `undobar.js` | `.undo-bar` (`.shown`), `.undo-bar-text`, `.undo-bar-button` (a `.bar-button.done`) | `ios6.css`, literal |
| Menu | `menu.js` | `.menu` (`.below`), `.menu-items`, `.menu-item` (`.is-held`), `.menu-arrow` | `ios6.css`, literal |
| Placeholders | `ui.js` `placeholder()` | `.ph` (`.ph-list`, `.ph-page`), `.ph-head`, `.ph-lines`, `.ph-box` (`.ph-icon`, `.ph-icon-lg`), `.ph-bar` (`.ph-sub`, widths `.ph-w30`…`.ph-w70`) | `ios6.css`, tokens `--placeholder`, `--dk-placeholder` |
| Built-in lock | `lock.js` | `.name-lock`, `.source-lock`, `.lock-icon` | `sources.css`, token `--lock-icon` (the padlock's art) |
| Row icon tint | `ui.js` | `.cell-icon` | `ios6.css`, tokens `--cell-icon`, `--cell-icon-text`; a row's own colour (`icon.color`) comes in `--cell-icon-tint` |

`spinner.js` is not loaded by the app: it generates `ios6.css`'s three spinner tokens from the 4S's measurements, and
`spinner.test.js` keeps the two the same. An era draws its own spinner by setting those tokens in its stylesheet.
"Literal" means the look rules still hold their iOS 6 colours: an era restyles them with look rules of its own until
that sheet's cleanup turns them into tokens.

## What is clean today

Clean: the nav bar (bar, shadow, title, status-bar strip), bar buttons (bordered, back, red, the Share glyph), the
tab bar (bar, tabs, glyph fills, badge) and grouped tables with their cells.

Split, with their layout in their own rules and their paint in look-only stretches: `sources.css`, `home.css` and
`settings.css`. Their iOS 6 decorations are tokens an era sets:

- the Done bar button: `--done-btn`, `--done-btn-edge`, `--done-btn-edge-top`, `--done-btn-pressed` (`:root`);
- Home's tiles: `--tile`, `--tile-edge`, `--tile-radius`, `--tile-green`, `--tile-glyph-green`, `--tile-purple*`,
  `--by`, `--home-icon-shadow`, on `.home` (so an era sets them on `html[data-style=…] .home`);
- Theme's preview: `--preview-ground`, `--preview-shadow`, `--preview-grip` (the grabber's layers, from
  `--preview-grip-l`, `-r`, `-bar`), `--preview-grip-edge`, `--preview-grip-radius` (`:root`).

Their other colours (the alert, Delete, trust pills, Find More, the certificate tile, the status tiles) are still
literal look rules: an era restyles them with look rules of its own.

Not yet clean, each queued as its own cleanup:

- the rest of `ios6.css` (switch, plain tables and section header, button pair, HUD, menu, banner, share sheet,
  reload bar, segmented control, undo bar, pull to refresh, placeholders);
- the other stylesheets (`packages.css`; the small ones);
- the light palettes' segmented-control rules in `palettes.css` (they move onto tokens with that control);
- the floating-tab-bar nav hook above.

The screens' inline SVG art comes from the icon map below; the overlays `nav/` draws take theirs from CSS tokens
([Overlays](#overlays-nav)).

## Icon map

Every SVG a screen draws from JS comes from one map, `ICON_SETS` in `web/app/icons/rowicons.js`, keyed by style and
then by kind and icon name. iOS 6's set is `ICON_SETS.ios6`:

| Kind | Keyed by | What it draws | Read through |
|---|---|---|---|
| `rows` | icon name -> `[tile colour, glyph]` | the 29pt row tiles (Settings, Manage, Account, Why, …) | `rowIcon(name)`, `tileSvg(name)` |
| `glyphs` | glyph name -> paths | the white glyph on a row tile, 24 units | through `rows` |
| `tile` | | the row tile's size, corners and glyph size | through `rows` |
| `guides` | name -> `[light, colour, body]` | Copying Files' app and computer tiles | `guideSvg(name)` |
| `home` | name -> `{ colour, gradient, svg }` | Home tiles a screen paints in its own CSS (Why) | `homeTileCss(name)` |
| `tabs` | tab -> SVG | the tab bar's glyphs, the `--glyph` token of `.tab[data-tab]` | `tabGlyphTokens(style)` |

An era adds `ICON_SETS.ios<N>` with only what it redraws (outline or filled glyphs, a tile shape, other colours):
anything it leaves out falls back to iOS 6's entry, per name. The functions read the style from
`<html data-style>` (`iconStyle()`), or take it as their last argument. The tab glyphs stay CSS tokens, in the stylesheet with the
rest of a style's look: `ios6.css` holds `tabGlyphTokens("ios6")` and an era's stylesheet holds
`tabGlyphTokens("ios<N>")`, and `rowicons.test.js` fails when either drifts from the map. The same test fails if a
screen (`why.js`, `notiphone.js`, `manage.js`, `handoff.js`, `guides.js`, `account.js`) gains an inline SVG of its
own. QR codes (`core/qr.js`) are data, not art, and stay out of the map.
