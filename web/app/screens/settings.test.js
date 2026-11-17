import { test } from "node:test";
import assert from "node:assert/strict";
import { themeMessage, applyTheme, settings } from "./settings.js";

test("the shell gets the fixed theme, or auto while Appearance is Automatic (F23)", () => {
  assert.deepEqual(themeMessage("dark", "dark").params, { style: "dark", theme: "dark" });
  assert.deepEqual(themeMessage("light", "light").params, { style: "light", theme: "light" });
  assert.deepEqual(themeMessage("auto", "dark").params, { style: "auto", theme: "dark" });
  assert.equal(themeMessage("auto", "light").method, "app.theme");
});

test("applyTheme posts app.theme to the bridge once per change", () => {
  const sent = [];
  const win = {
    matchMedia: () => ({ matches: true }),
    webkit: { messageHandlers: { cydian: { postMessage: (m) => { sent.push(m); return Promise.resolve(null); } } } },
  };
  const doc = { documentElement: { dataset: {} }, querySelectorAll: () => [] };
  settings.set("appearance", "dark");
  applyTheme(doc, win);
  applyTheme(doc, win);
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.deepEqual(sent.map((m) => m.params), [{ style: "dark", theme: "dark" }]);
  settings.set("appearance", "auto");
  applyTheme(doc, win);
  assert.deepEqual(sent.at(-1).params, { style: "auto", theme: "dark" });
  // the site: no handler, no throw
  applyTheme(doc, { matchMedia: () => ({ matches: false }) });
});
