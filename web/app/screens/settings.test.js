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

// F128: Settings' pages and their titles, like iOS 6's (the root, General, Display, Updates, a list page under one),
// and the older one-segment routes other screens still link to.
test("F128: page titles for the iOS 6-style routes and the old ones", async () => {
  const { nav } = await import("./settings.js");
  const t = (...path) => nav({ tab: "home", path }).title;
  assert.equal(t(), "Settings");
  assert.equal(t("general"), "General");
  assert.equal(t("display"), "Display");
  assert.equal(t("updates"), "Updates");
  assert.equal(t("about"), "About");
  assert.equal(t("general", "device"), "Device");
  assert.equal(t("updates", "holds"), "Ignored Upgrades");
  assert.equal(t("signing"), "Signing");
  assert.equal(t("signing", "resignReminder"), "Re-sign Reminder");
  assert.equal(t("device"), "Device"); // Home's hint
  assert.equal(t("iosVersion"), "iOS Version"); // a package page's link
  assert.equal(t("holds"), "Ignored Upgrades");
  assert.equal(t("account"), "Cydian Account");
});

// F134: Settings > Signing like an iOS 6 settings page: the certificate first, then its profile, the options, and How
// Signing Works as a link at the bottom.
test("F134: the Signing page's groups, in order, for each build and state", async () => {
  const { signingLayout, splitSummary, HELP } = await import("./settings.js");
  const { SIGNING_GROUPS } = await import("../core/settings.js");
  assert.deepEqual(SIGNING_GROUPS.slice(0, 4), ["certificate", "files", "profile", "options"]);
  assert.equal(SIGNING_GROUPS.at(-1), "help");
  // the sideload app, set up
  assert.deepEqual(signingLayout({ mode: "sideload", certificate: true, profile: true, options: true }),
    ["certificate", "profile", "options", "server", "status", "remove", "help"]);
  // nothing yet: the certificate's Import row, the options, the server, then the walkthrough's link
  assert.deepEqual(signingLayout({ mode: "sideload", options: true }), ["certificate", "options", "server", "status", "help"]);
  // a file picked, one still missing: the Files group under the certificate
  assert.deepEqual(signingLayout({ mode: "sideload", staged: true, options: true }), ["certificate", "files", "options", "server", "status", "remove", "help"]);
  // the website: no options, server or Signed Apps; Install Cydian App once the certificate works
  assert.deepEqual(signingLayout({ mode: "site", certificate: true, profile: true, ready: true }), ["certificate", "profile", "app", "other", "remove", "help"]);
  assert.deepEqual(signingLayout({ mode: "site" }), ["certificate", "other", "help"]);
  // each layout is in SIGNING_GROUPS order with no group twice
  for (const l of [signingLayout({ mode: "sideload", certificate: true, staged: true, profile: true, options: true }), signingLayout({ mode: "site", staged: true })]) {
    assert.deepEqual(l, SIGNING_GROUPS.filter((g) => l.includes(g)));
    assert.equal(new Set(l).size, l.length);
  }
  // the summary's rows split into the two groups, no row in both
  const rows = [{ label: "Certificate", detail: "iPhone Distribution: Jane Doe" }, { label: "Team", detail: "Jane" },
    { label: "Certificate Expires", detail: "1/1/27" }, { label: "Profile", detail: "Wild" }, { label: "Profile Expires", detail: "2/2/27" },
    { label: "Devices", detail: "3" }, { label: "App ID", detail: "ABC.*" }];
  const split = splitSummary(rows);
  assert.deepEqual(split.certificate.map((r) => [r.label, r.detail ?? r.subtitle]), [["Name", "iPhone Distribution: Jane Doe"], ["Team", "Jane"], ["Expires", "1/1/27"]]);
  assert.equal(split.certificate[0].subtitle, "iPhone Distribution: Jane Doe"); // long: under the label
  assert.deepEqual(split.profile.map((r) => r.label), ["Name", "Expires", "Devices", "App ID"]);
  assert.equal(HELP, "help");
});

test("F134: the walkthrough is How Signing Works, a page below Signing", async () => {
  const { nav } = await import("./settings.js");
  assert.equal(nav({ path: ["signing", "help"] }).title, "How Signing Works");
  assert.equal(nav({ path: ["signing", "showExpiry"] }).title, "Show Expiry Dates");
});
