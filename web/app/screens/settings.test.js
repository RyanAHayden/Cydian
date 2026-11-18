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

test("Update Alerts: what iOS allows, the last background check, and a way to Settings when something is off", async () => {
  const { notifyRows } = await import("./settings.js");
  const now = Date.parse("2026-11-18T12:00:00Z");
  const off = notifyRows({ badges: false, alerts: true, backgroundRefresh: true, lastCheck: null }, now);
  assert.deepEqual(off.rows.map((r) => [r.label, r.detail ?? ""]), [["Check in the Background", "On"], ["Icon Badge", "Off"], ["Notifications", "On"],
    ["Background App Refresh", "On"], ["Last Background Check", "Not yet"], ["Turn On in Settings", ""]]);
  const on = notifyRows({ badges: true, alerts: true, backgroundRefresh: true, lastCheck: "2026-11-18T09:00:00Z" }, now);
  assert.equal(on.rows.at(-1).detail, "3 h ago");
  assert.equal(on.rows.length, 5);
  const quiet = notifyRows({ backgroundOn: false, badges: false, alerts: false, backgroundRefresh: false }, now);
  assert.equal(quiet.rows[0].detail, "Off"); // turned off here: no nudge to Settings
  assert.equal(quiet.rows.some((r) => r.open), false);
});
