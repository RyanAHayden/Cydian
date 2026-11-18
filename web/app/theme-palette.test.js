// F198: OLED Black is the dark palette by default, Gunmetal the second one. <html data-palette> beside data-theme;
// every dark rule paints with palette tokens, so each palette repaints all of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { themeFor, paletteFor, DARK_PALETTES } from "./core/settings.js";
import { applyTheme, settings, THEME_COLORS } from "./screens/settings.js";

const here = new URL(".", import.meta.url);
const read = (f) => readFileSync(new URL(f, here), "utf8");

test("paletteFor: classic in light; OLED Black in dark unless Gunmetal is chosen", () => {
  assert.deepEqual(DARK_PALETTES, ["oled", "gunmetal"]);
  assert.equal(paletteFor("light", "gunmetal"), "classic");
  assert.equal(paletteFor("dark", null), "oled");
  assert.equal(paletteFor("dark", "gunmetal"), "gunmetal");
  assert.equal(paletteFor("dark", "neon"), "oled");
  assert.deepEqual(THEME_COLORS, { classic: "#4f698b", oled: "#000", gunmetal: "#5f656f" });
});

// theme-boot.js in a sandbox: what it puts on <html> before first paint for a stored Appearance and dark theme.
function boot({ appearance = null, darkTheme = null, systemDark = false } = {}) {
  const attrs = {};
  const meta = { attrs: { content: "#4f698b" }, setAttribute(k, v) { this.attrs[k] = v; } };
  const store = { "ifizbox.appearance": appearance, "ifizbox.darkTheme": darkTheme };
  const ctx = {
    localStorage: { getItem: (k) => store[k] ?? null },
    matchMedia: () => ({ matches: systemDark }),
    document: {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      querySelectorAll: (q) => (q.startsWith('meta[name="theme-color"]') ? [meta] : []),
    },
  };
  ctx.window = ctx;
  runInNewContext(read("theme-boot.js"), ctx);
  return { theme: attrs["data-theme"], palette: attrs["data-palette"], color: meta.attrs.content };
}

test("theme-boot.js agrees with themeFor and paletteFor for every Appearance, dark theme and system", () => {
  for (const appearance of [null, "auto", "light", "dark"]) {
    for (const darkTheme of [null, "oled", "gunmetal"]) {
      for (const systemDark of [false, true]) {
        const theme = themeFor(appearance ?? "light", systemDark);
        const palette = paletteFor(theme, darkTheme);
        assert.deepEqual(boot({ appearance, darkTheme, systemDark }), { theme, palette, color: THEME_COLORS[palette] },
          JSON.stringify({ appearance, darkTheme, systemDark }));
      }
    }
  }
  assert.deepEqual(boot({ appearance: "dark" }), { theme: "dark", palette: "oled", color: "#000" });
});

test("applyTheme: data-palette and a black theme-color for OLED Black, Gunmetal when chosen", () => {
  const metas = [];
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => metas };
  const meta = (media = "") => ({ media, content: "", cloneNode() { return meta(this.media); }, replaceWith(f) { metas[metas.indexOf(this)] = f; } });
  metas.push(meta(), meta("(prefers-color-scheme: light)"));
  const win = (dark, chosen = null) => ({ matchMedia: () => ({ matches: dark }), localStorage: { getItem: () => chosen } });
  const was = settings.get("appearance");
  try {
    settings.set("appearance", "dark");
    applyTheme(doc, win(false));
    assert.equal(doc.documentElement.dataset.palette, "oled");
    assert.deepEqual(metas.map((m) => m.content), ["#000", "#000"]);
    applyTheme(doc, win(false, "gunmetal"));
    assert.equal(doc.documentElement.dataset.palette, "gunmetal");
    assert.deepEqual(metas.map((m) => m.content), ["#5f656f", "#5f656f"]);
    settings.set("appearance", "auto"); // the bare meta takes what shows; one with a media query its own scheme's
    applyTheme(doc, win(true));
    assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.palette], ["dark", "oled"]);
    assert.deepEqual(metas.map((m) => m.content), ["#000", "#4f698b"]);
    settings.set("appearance", "light");
    applyTheme(doc, win(true));
    assert.equal(doc.documentElement.dataset.palette, "classic");
  } finally { settings.set("appearance", was); }
});

// ---- the stylesheets ----
const sheets = readdirSync(here).filter((f) => f.endsWith(".css")).map((f) => [f, read(f)]);
const ios6 = read("ios6.css");
const block = (selector) => {
  const at = ios6.indexOf(selector + " {");
  assert.ok(at >= 0, selector);
  return ios6.slice(at, ios6.indexOf("\n}", at));
};
const tokens = (css) => new Map([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const oled = tokens(block('html[data-theme="dark"]'));
const gunmetal = tokens(block('html[data-theme="dark"][data-palette="gunmetal"]'));

test("OLED Black is the mockup's palette", () => {
  const want = { "--pin-dark": "#000", "--pin-light": "#000", "--table": "#0e0e0f", "--table-edge": "#1f1f22",
    "--divider": "#1c1c1f", "--divider-hi": "transparent", "--table-inset": "transparent", "--head": "#d6d6db",
    "--emboss": "none", "--text": "#fff", "--subtitle": "#8d8d93", "--detail": "#5fa2ff", "--dk-ground": "#000",
    "--dk-nav-shadow": "none", "--dk-btn-edge": "#000", "--dk-btn": "linear-gradient(#3a3a3e, #121214)" };
  for (const [k, v] of Object.entries(want)) assert.equal(oled.get(k), v, k);
  assert.match(oled.get("--chevron"), /%2355555b/);
  assert.match(oled.get("--dk-nav-bar"), /#333336, #151517 50%, #070708 51%, #000/);
  assert.match(oled.get("--dk-nav-bar"), /rgba\(255,255,255,\.16\)/);
  assert.match(oled.get("--dk-nav-bar"), /linear-gradient\(#1a1a1c, #1a1a1c\) bottom/);
  assert.match(oled.get("--dk-tabbar"), /^linear-gradient\(#1c1c1e, #1c1c1e\) top \/ 100% 1px no-repeat, #000$/);
});

test("Gunmetal keeps F13's colours and overrides only tokens OLED Black defines", () => {
  assert.equal(gunmetal.get("--table"), "#3b3f46");
  assert.equal(gunmetal.get("--dk-ground"), "#5f656f");
  assert.match(gunmetal.get("--dk-nav-bar"), /#5f656f, #3b4048 50%, #30343b 51%, #23262b/);
  for (const k of gunmetal.keys()) assert.ok(oled.has(k), `${k} is Gunmetal's only: OLED Black would keep the light value`);
});

test("every dark rule paints with tokens: no fixed colours but black and the kit's black action sheet", () => {
  const allowed = /^(#000|rgba\(0,0,0,[.\d]+\)|rgba\(255,255,255,\.(15|18)\))$/;
  for (const [file, css] of sheets) {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter((r) => /data-theme="dark"/.test(r.split("{")[0]));
    for (const rule of rules) {
      const [sel, body = ""] = rule.split("{");
      if (/^html\[data-theme="dark"\](\[data-palette="\w+"\])?$/.test(sel.trim())) continue; // the palettes themselves
      if (/\.action-sheet|\.action-button/.test(sel)) continue; // UIAlertSheetBlack*: the kit's own black sheet
      if (/\.scope-filter\.done/.test(sel)) continue; // shared with light: the nav bar's blue Done
      for (const c of body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []) {
        assert.match(c, allowed, `${file}: ${sel.trim()} has ${c}`);
      }
      for (const [, v] of body.matchAll(/var\((--dk-[\w-]+)\)/g)) assert.ok(oled.has(v), `${file}: ${v} is not a palette token`);
    }
  }
});
