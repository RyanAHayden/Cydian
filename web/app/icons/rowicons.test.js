// F205: the iOS 6 Settings row tiles (rowicons.js): every icon draws, the sizes are the 4S's, and every setting or
// page they name exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_ICONS, GLYPHS, SETTING_ICONS, PAGE_ICONS, tileSvg, rowIcon } from "./rowicons.js";
import { SETTINGS, PAGES, SECTIONS } from "../core/settings.js";

test("every row icon has a colour and a glyph, and draws a 29pt tile with 6pt corners", () => {
  for (const [name, [colour, glyph]] of Object.entries(ROW_ICONS)) {
    assert.match(colour, /^#[0-9a-f]{6}$/, name);
    assert.ok(GLYPHS[glyph], `${name}: glyph ${glyph}`);
    const svg = tileSvg(name);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="29" height="29" viewBox="0 0 29 29">/);
    assert.match(svg, /<rect width="29" height="29" rx="6" fill="#[0-9a-f]{6}"\/>/);
    assert.equal((svg.match(/<path /g) || []).length >= 1, true, name); 
    assert.doesNotMatch(svg, /NaN|undefined|Gradient/, name); // flat: no gloss
  }
  assert.throws(() => tileSvg("nope"));
});

test("rowIcon is a grouped() row icon: the tile as a data: picture, the same object text for the same name", () => {
  const a = rowIcon("general");
  assert.equal(a.cls, "row-icon");
  assert.ok(a.src.startsWith("data:image/svg+xml,%3Csvg"));
  assert.equal(decodeURIComponent(a.src.slice("data:image/svg+xml,".length)), tileSvg("general"));
  assert.equal(rowIcon("general").src, a.src);
});

test("SETTING_ICONS and PAGE_ICONS name real settings, pages and icons", () => {
  for (const [key, icon] of Object.entries(SETTING_ICONS)) {
    const d = SETTINGS.find((s) => s.key === key);
    assert.ok(d, key);
    assert.notEqual(d.kind, "choice", `${key}: a choice's options stay bare`);
    assert.ok(ROW_ICONS[icon], icon);
  }
  // every setting a row shows has a tile, except choices (their options are the rows) and Theme's (F199): Mode is a
  // segmented control with no row, and Themes' Light and Dark rows are its tones, bare as Appearance's options were
  // F285: nor a setting no SECTIONS group draws (selfUpdateAlerts sits among the bare Update Alerts rows)
  const bare = (d) => d.kind === "choice" || d.kind === "segmented" || d.tone || !SECTIONS.some((s) => s.id === d.section);
  for (const d of SETTINGS) if (d.modes.length && !bare(d)) assert.ok(SETTING_ICONS[d.key], d.key);
  for (const p of PAGES) assert.ok(ROW_ICONS[PAGE_ICONS[p.id]], p.id);
});

test("ios6.css places the tile as the 4S does: 7pt in, the label 11pt after", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const rule = css.match(/\.cell-icon\.row-icon \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background: none/);
  assert.match(rule, /box-shadow: none/);
  // C44: the layout is style.css's (its Era hooks): .cell-inner's 10px padding, 8px gap -> 7 and 11
  const layout = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(layout, /\.cell-icon\.row-icon \{ margin: 0 3px 0 -3px; \}/);
  assert.match(layout, /--cell-pad: 0 10px;/);
  assert.match(layout, /--cell-gap: 8px;/);
  assert.match(layout, /\.cell-inner \{[^}]*gap: var\(--cell-gap\);[^}]*padding: var\(--cell-pad\);/);
});

test("F223: Home's Settings row and Settings > General draw one gear, from this file", async () => {
  const { homeLinks, SETTINGS_ICON } = await import("../screens/home.js");
  const settingsRow = homeLinks()[0].rows.find((r) => r.label === "Settings");
  assert.equal(PAGE_ICONS.general, "general");
  assert.deepEqual(settingsRow.icon, rowIcon(PAGE_ICONS.general), "Home's Settings row is General's tile");
  assert.equal(SETTINGS_ICON.src, rowIcon("general").src);
  assert.equal(ROW_ICONS.general[1], "gear");
  const home = readFileSync(new URL("../home.css", import.meta.url), "utf8");
  assert.doesNotMatch(home, /\.glyph-settings/, "no second gear drawn in home.css");
});

// C51: the per-style icon map (docs/eras.md, "Icon map").
test("C51: ios6.css's tab glyph tokens are the map's iOS 6 tabs, as tabGlyphTokens prints them", async () => {
  const { ICON_SETS, tabGlyphTokens, cssSvgUrl } = await import("./rowicons.js");
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const inCss = {};
  for (const m of css.matchAll(/^\.tab\[data-tab="(\w+)"\]\s*\{ --glyph: (url\("[^"]*"\)); \}/gm)) inCss[m[1]] = m[2];
  const tabs = ICON_SETS.ios6.tabs;
  assert.deepEqual(Object.keys(inCss), Object.keys(tabs), "one ios6.css rule per tab in the map, in its order");
  for (const [tab, svg] of Object.entries(tabs)) assert.equal(inCss[tab], cssSvgUrl(svg), tab);
  // the same rules, ios6.css only lines the braces up
  assert.equal(tabGlyphTokens("ios6"),
    Object.entries(inCss).map(([tab, url]) => `.tab[data-tab="${tab}"] { --glyph: ${url}; }`).join("\n"));
});

test("C51: an era stylesheet carries the tab glyph tokens of its own set", async () => {
  const { ICON_SETS, tabGlyphTokens } = await import("./rowicons.js");
  for (const style of Object.keys(ICON_SETS)) {
    if (style === "ios6" || !ICON_SETS[style].tabs) continue;
    const css = readFileSync(new URL(`../${style}.css`, import.meta.url), "utf8");
    for (const line of tabGlyphTokens(style).split("\n")) assert.ok(css.includes(line), `${style}.css: ${line}`);
  }
});

test("C51: the page's data-style picks the set, and an era falls back to iOS 6 for what it leaves out", async () => {
  const { ICON_SETS, iconStyle, icon, tileSvg, rowIcon, guideSvg, homeTileCss } = await import("./rowicons.js");
  assert.equal(iconStyle({ documentElement: { dataset: {} } }), "ios6");
  assert.equal(iconStyle({ documentElement: { dataset: { style: "ios7" } } }), "ios7");
  assert.equal(iconStyle(undefined), "ios6");
  ICON_SETS.test = { rows: { general: ["#000000", "outline"] }, glyphs: { outline: [["s", "M2 2h20v20H2z", 1.5]] },
    tile: { radius: 7 } };
  try {
    assert.equal(icon("rows", "general", "test")[0], "#000000");
    assert.deepEqual(icon("rows", "theme", "test"), ICON_SETS.ios6.rows.theme, "left out: iOS 6's");
    assert.equal(icon("rows", "general", "nope"), ICON_SETS.ios6.rows.general, "an unknown style draws iOS 6");
    const svg = tileSvg("general", "test");
    assert.match(svg, /rx="7" fill="#000000"/);
    assert.match(svg, /stroke-width="1.5"/);
    assert.match(tileSvg("theme", "test"), /rx="7"/, "the era's tile shape, iOS 6's glyph");
    assert.notEqual(rowIcon("general", "test").src, rowIcon("general", "ios6").src, "cached per style");
    assert.equal(guideSvg("files", "test"), guideSvg("files", "ios6"));
    assert.equal(homeTileCss("why", "test"), homeTileCss("why", "ios6"));
  } finally {
    delete ICON_SETS.test;
  }
  assert.throws(() => guideSvg("nope"));
  assert.throws(() => homeTileCss("nope"));
});

test("C51: the screens draw no inline SVG of their own: their art comes from the map (QR codes from core/qr.js)", () => {
  for (const f of ["why", "notiphone", "manage", "handoff", "guides", "account"]) {
    const src = readFileSync(new URL(`../screens/${f}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /<svg|%3Csvg|viewBox|<path /i, f);
  }
});

test("C51: Why's tile and Copying Files' tiles are the map's", async () => {
  const { homeTileCss, guideSvg, GUIDE_TILE_NAMES, ICON_SETS } = await import("./rowicons.js");
  const why = await import("../screens/why.js");
  assert.ok(why.WHY_CSS.includes(`.home-glyph.glyph-why { ${homeTileCss("why", "ios6")}`));
  assert.match(homeTileCss("why", "ios6"), /^background-color: #d8820f; background-image: url\("data:image\/svg\+xml,%3Csvg [^"]*%3C\/svg%3E"\), linear-gradient\(#f4b03f, #d8820f\);$/);
  const guides = await import("../screens/guides.js");
  assert.deepEqual(guides.GLYPH_IDS, GUIDE_TILE_NAMES);
  for (const id of GUIDE_TILE_NAMES) {
    assert.equal(guides.glyphSvg(id), guideSvg(id, "ios6"), id);
    assert.equal(guides.glyph(id, "X").color, ICON_SETS.ios6.guides[id][1], id);
  }
});
