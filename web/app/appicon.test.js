// F323: the app icon follows the theme (core/settings.js iconFor/iconState/iconGroups, appicon.js tellIcon).
import test from "node:test";
import assert from "node:assert/strict";
import { createSettings, iconFor, iconState, iconGroups, clearOffered, APP_ICONS, LIGHT_PALETTES, DARK_PALETTES } from "./core/settings.js";
import { iconMessage, tellIcon, resetTold, iconSrc, clearHere } from "./appicon.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const store = (mode = "jailbreak") => createSettings({ storage: memStorage(), mode });

test("every theme has an icon, and Clear is one more", () => {
  assert.deepEqual(APP_ICONS.map((i) => i.value), [...LIGHT_PALETTES, ...DARK_PALETTES, "clear"]);
});

test("Match Theme (the default) gives each tone its theme's icon", () => {
  const s = store();
  const get = (k) => s.get(k);
  assert.equal(s.get("iconMatch"), true);
  assert.equal(iconFor("light", get), "classic");
  assert.equal(iconFor("dark", get), "gunmetal");
  s.set("darkTheme", "nord");
  s.set("lightTheme", "sepia");
  assert.deepEqual(iconState(get, "dark"), { light: "sepia", dark: "nord", onScreen: "nord" });
  assert.deepEqual(iconState(get, "light"), { light: "sepia", dark: "nord", onScreen: "sepia" });
  s.set("darkIcon", "clear"); // a pick does nothing while Match Theme is on
  assert.equal(iconFor("dark", get), "nord");
});

test("off, the picks start on the themes' own icons and apply to their mode only", () => {
  const s = store("sideload");
  const get = (k) => s.get(k);
  s.set("iconMatch", false);
  assert.deepEqual(iconState(get, "light"), { light: "classic", dark: "gunmetal", onScreen: "classic" });
  s.set("darkIcon", "clear");
  assert.deepEqual(iconState(get, "dark"), { light: "classic", dark: "clear", onScreen: "clear" });
  s.set("lightIcon", "oled"); // any icon in either mode
  assert.deepEqual(iconState(get, "light"), { light: "oled", dark: "clear", onScreen: "oled" });
  s.set("lightIcon", "theme");
  s.set("lightTheme", "metal");
  assert.equal(iconFor("light", get), "metal");
});

test("the website has no App Icon rows", () => {
  const s = store("site");
  assert.equal(s.isShown("iconMatch"), false);
  assert.equal(s.isShown("lightIcon"), false);
  assert.equal(store("jailbreak").isShown("darkIcon"), true);
  assert.equal(store("sideload").isShown("iconMatch"), true);
});

test("the sideload build's footers say iOS shows an alert; the jailbreak app's switch is quiet", () => {
  assert.match(store("sideload").footerOf("iconMatch"), /alert/);
  assert.match(store("sideload").footerOf("lightIcon"), /alert/);
  assert.equal(store("jailbreak").footerOf("iconMatch"), "The icon changes with your theme.");
  assert.equal(store("jailbreak").footerOf("lightIcon"), "Pick an icon for each mode.");
});

test("the grid: this mode's themes, then Clear and the other mode's", () => {
  const [themes, special] = iconGroups("dark");
  assert.equal(themes.header, "Themes");
  assert.deepEqual(themes.icons.map((i) => i.value), DARK_PALETTES);
  assert.equal(special.header, "Special");
  assert.deepEqual(special.icons.map((i) => i.value), ["clear", ...LIGHT_PALETTES]);
  assert.deepEqual(iconGroups("light")[1].icons.map((i) => i.value), ["clear", ...DARK_PALETTES]);
  // every icon is in one of each mode's groups exactly once
  for (const tone of ["light", "dark"]) {
    assert.deepEqual(iconGroups(tone).flatMap((g) => g.icons.map((i) => i.value)).sort(), APP_ICONS.map((i) => i.value).sort());
  }
});

test("Clear is offered from iOS 18 on only (user 2026-11-20: not on the iPhone 7's iOS 15)", () => {
  assert.equal(clearOffered("15.8.8"), false);
  assert.equal(clearOffered("17.6"), false);
  assert.equal(clearOffered("18.0"), true);
  assert.equal(clearOffered("26.1"), true);
  assert.equal(clearOffered(null), true);
  assert.ok(!iconGroups("dark", { clear: false })[1].icons.some((i) => i.value === "clear"));
  assert.equal(iconGroups("light", { clear: false })[1].icons.length, DARK_PALETTES.length);
  const ua = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;
  assert.equal(clearHere(ua("15_8_8")), false);
  assert.equal(clearHere(ua("18_1")), true);
});

test("tellIcon sends app.icon once per change, only in the apps", () => {
  const s = store();
  const calls = [];
  const native = { call: (m, p) => { calls.push([m, p]); return Promise.resolve({}); } };
  globalThis.ifizboxNative = native;
  try {
    resetTold();
    assert.equal(tellIcon("light", s, native), true);
    assert.equal(tellIcon("light", s, native), false); // nothing changed
    s.set("darkTheme", "oled");
    assert.equal(tellIcon("light", s, native), true);
    assert.deepEqual(calls, [["app.icon", { light: "classic", dark: "gunmetal", onScreen: "classic" }],
      ["app.icon", { light: "classic", dark: "oled", onScreen: "classic" }]]);
    resetTold();
    assert.equal(tellIcon("dark", store("site"), native), false);
  } finally {
    delete globalThis.ifizboxNative;
  }
  assert.deepEqual(iconMessage((k) => s.get(k), "dark").params.onScreen, "oled");
  assert.equal(iconSrc("clear"), "appicon/clear.png");
});
