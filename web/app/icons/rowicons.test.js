// F205: the iOS 6 Settings row tiles (rowicons.js): every icon draws, the sizes are the 4S's, and every setting or
// page they name exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_ICONS, GLYPHS, SETTING_ICONS, PAGE_ICONS, tileSvg, rowIcon } from "./rowicons.js";
import { SETTINGS, PAGES } from "../core/settings.js";

test("every row icon has a colour and a glyph, and draws a 29pt tile with 5pt corners", () => {
  for (const [name, [colour, glyph]] of Object.entries(ROW_ICONS)) {
    assert.match(colour, /^#[0-9a-f]{6}$/, name);
    assert.ok(GLYPHS[glyph], `${name}: glyph ${glyph}`);
    const svg = tileSvg(name);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="29" height="29" viewBox="0 0 29 29">/);
    assert.match(svg, /<rect width="29" height="29" rx="5"\/>/);
    assert.equal((svg.match(/<path /g) || []).length >= 2, true, name); // the gloss and at least one glyph part
    assert.doesNotMatch(svg, /NaN|undefined/, name);
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
  const bare = (d) => d.kind === "choice" || d.kind === "segmented" || d.tone;
  for (const d of SETTINGS) if (d.modes.length && !bare(d)) assert.ok(SETTING_ICONS[d.key], d.key);
  for (const p of PAGES) assert.ok(ROW_ICONS[PAGE_ICONS[p.id]], p.id);
});

test("ios6.css places the tile as the 4S does: 7pt in, the label 11pt after", () => {
  const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8");
  const rule = css.match(/\.cell-icon\.row-icon \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /background: none/);
  assert.match(rule, /box-shadow: none/);
  assert.match(rule, /margin: 0 3px 0 -3px/); // .cell-inner: 10px padding, 8px gap -> 7 and 11
  assert.match(css, /\.cell-inner \{[^}]*gap: 8px;[^}]*padding: 0 10px;/);
});
