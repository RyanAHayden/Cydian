// F200: the theme menu's extra palettes (palettes.css). Each theme the menu offers has a token block, overrides only
// tokens its base defines, and keeps its text readable (WCAG contrast) on its tables and grounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DARK_PALETTES, LIGHT_PALETTES } from "./core/settings.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const ios6 = read("./ios6.css");
const palettes = read("./palettes.css");
const blockIn = (css, selector) => {
  const at = css.indexOf(selector + " {");
  if (at < 0) return null;
  return css.slice(at, css.indexOf("\n}", at));
};
const tokens = (css) => new Map([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const root = tokens(blockIn(ios6, ":root"));
const oled = tokens(blockIn(ios6, 'html[data-theme="dark"]'));
const NEW_DARK = ["midnight", "linen", "nord", "dracula", "leather", "felt", "wood"];
const NEW_LIGHT = ["sepia", "solarized", "legalpad", "metal"];
const block = (tone, p) => tokens(blockIn(palettes, `html[data-theme="${tone}"][data-palette="${p}"]`) ?? "");

// WCAG relative luminance and contrast of two #rgb/#rrggbb colours.
const lum = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("every theme in the menu has a palette block", () => {
  assert.deepEqual(DARK_PALETTES.slice(2), NEW_DARK);
  assert.deepEqual(LIGHT_PALETTES.slice(1), NEW_LIGHT);
  for (const p of NEW_DARK) assert.ok(block("dark", p).size > 30, p);
  for (const p of NEW_LIGHT) assert.ok(block("light", p).size > 15, p);
});

test("dark palettes override only OLED Black's tokens (--weave is Linen's own); light ones :root's or --lt-*", () => {
  // --weave: Linen's texture; F325's textured palettes (dark and light) have one too
  for (const p of NEW_DARK) for (const k of block("dark", p).keys()) assert.ok(oled.has(k) || k === "--weave", `${p}: ${k}`);
  // every --lt-* token the chrome rules read, each light palette sets
  const lt = [...new Set([...palettes.matchAll(/var\((--lt-[\w-]+)\)/g)].map((m) => m[1]))];
  assert.ok(lt.length >= 8, lt.join());
  for (const p of NEW_LIGHT) {
    const t = block("light", p);
    for (const k of t.keys()) assert.ok(root.has(k) || lt.includes(k) || k === "--weave", `${p}: ${k}`);
    for (const k of lt) assert.ok(t.has(k), `${p} lacks ${k}`);
    // the chrome rules list it
    assert.match(palettes, new RegExp(`html\\[data-theme="light"\\]:is\\([^)]*\\[data-palette="${p}"\\]`), p);
  }
  const list = [...palettes.matchAll(/html\[data-theme="light"\]:is\(([^)]*)\)/g)].map((m) => m[1]);
  for (const l of list) assert.equal(l, NEW_LIGHT.map((p) => `[data-palette="${p}"]`).join(", "));
});

test("text stays readable: body text 7:1, subtitles, headers, details and links 4.5:1 on their grounds", () => {
  const all = [...NEW_DARK.map((p) => ["dark", p]), ...NEW_LIGHT.map((p) => ["light", p])];
  for (const [tone, p] of all) {
    const t = block(tone, p);
    const get = (k) => t.get(k) ?? (tone === "dark" ? oled.get(k) : root.get(k));
    const table = get("--table"), plain = get("--plain");
    const ground = get("--pin-light");
    assert.ok(contrast(get("--text"), table) >= 7, `${p}: text on table ${contrast(get("--text"), table).toFixed(2)}`);
    assert.ok(contrast(get("--text"), plain) >= 7, `${p}: text on plain list`);
    for (const [k, on] of [["--subtitle", table], ["--subtitle", plain], ["--detail", table], ["--head", ground], ["--field-text", table]]) {
      const c = contrast(get(k), on);
      assert.ok(c >= 4.5, `${p}: ${k} on ${on}: ${c.toFixed(2)}`);
    }
    if (tone === "dark") for (const k of ["--dk-link", "--dk-ok", "--dk-bad", "--dk-index"]) {
      const c = contrast(get(k), table);
      assert.ok(c >= 4.5, `${p}: ${k}: ${c.toFixed(2)}`);
    }
  }
});

test("index.html loads palettes.css after the sheets it overrides", () => {
  const html = read("./index.html");
  const at = (f) => html.indexOf(`href="${f}"`);
  assert.ok(at("palettes.css") > at("ios6.css") && at("palettes.css") > at("packages.css") && at("palettes.css") > at("reviews.css"));
});
