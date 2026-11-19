// F244: the sideload build's certificate-expiry tile on Home: stages, days, Certificate vs Profile, the Expiry Warning
// and Show Expiry Warning settings, and the tile's markup and CSS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expiryWarning, expiryWarningDays, EXPIRY_WARNING, RESIGN_WINDOW } from "../core/signing.js";
import { createSettings, SETTINGS, SECTIONS } from "../core/settings.js";
import { certWarning, certIdentity, showsCertTile, CERT_STAGES } from "./home.js";
import { needsShown } from "./settings.js";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-19T12:00:00Z");
const at = (days) => new Date(now.getTime() + days * DAY).toISOString();
const id = (cert, prof) => ({ name: "Dev", expires: cert, profile: prof === undefined ? null : { name: "P", expires: prof } });
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test("hidden with no identity, no dates, or outside the warning window", () => {
  assert.equal(expiryWarning(null, { now }), null);
  assert.equal(expiryWarning({ name: "x" }, { now }), null);
  assert.equal(expiryWarning(id("not a date"), { now }), null);
  assert.equal(expiryWarning(id(at(8)), { now }), null); // default window 1 week
  assert.equal(expiryWarning(id(at(7.5)), { now, warn: 7 }), null);
  assert.equal(expiryWarning(id(at(300), at(200)), { now }), null);
});

test("amber inside the warning window: Certificate Expires Soon / Expires in N days", () => {
  const w = expiryWarning(id(at(6.5)), { now });
  assert.deepEqual([w.stage, w.what, w.days, w.title, w.subtitle],
    ["soon", "Certificate", 6, "Certificate Expires Soon", "Expires in 6 days · Renew in Signing"]);
  assert.equal(expiryWarning(id(at(7)), { now }).stage, "soon"); // the window's edge counts
  assert.equal(expiryWarning(id(at(2.5)), { now }).stage, "soon"); // just outside the 2-day re-sign window
  assert.equal(expiryWarning(id(at(25)), { now, warn: 30 }).subtitle, "Expires in 25 days · Renew in Signing");
});

test("red tint inside the re-sign window: Tomorrow, Today, in N Days", () => {
  const t = expiryWarning(id(at(1.5)), { now });
  assert.deepEqual([t.stage, t.title, t.subtitle], ["close", "Certificate Expires Tomorrow", "Expires in 1 day · Renew in Signing"]);
  const today = expiryWarning(id(at(0.25)), { now });
  assert.deepEqual([today.stage, today.title, today.subtitle], ["close", "Certificate Expires Today", "Expires today · Renew in Signing"]);
  const three = expiryWarning(id(at(3.5)), { now, resign: 7 });
  assert.deepEqual([three.stage, three.title], ["close", "Certificate Expires in 3 Days"]);
  // Re-sign Reminder Off (0) still turns red RESIGN_WINDOW days out
  assert.equal(expiryWarning(id(at(1.5)), { now, resign: 0 }).stage, "close");
  assert.equal(expiryWarning(id(at(RESIGN_WINDOW + 0.5)), { now, resign: 0 }).stage, "soon");
  // the warning window is still the outer limit when it is shorter than the re-sign window
  assert.equal(expiryWarning(id(at(5)), { now, warn: 3, resign: 7 }), null);
  assert.equal(expiryWarning(id(at(2.5)), { now, warn: 3, resign: 7 }).stage, "close");
});

test("expired: solid red, Apps won't open", () => {
  const w = expiryWarning(id(at(-3)), { now });
  assert.deepEqual([w.stage, w.title, w.subtitle], ["gone", "Certificate Expired", "Apps won't open · Renew in Signing"]);
  assert.equal(expiryWarning(id(now.toISOString()), { now }).stage, "gone"); // the very moment counts as gone
});

test("the earlier of certificate and profile; Profile when the profile ends first", () => {
  const p = expiryWarning(id(at(300), at(5)), { now });
  assert.deepEqual([p.what, p.title], ["Profile", "Profile Expires Soon"]);
  assert.equal(expiryWarning(id(at(300), at(-1)), { now }).title, "Profile Expired");
  assert.equal(expiryWarning(id(at(1.5), at(-1)), { now }).title, "Profile Expired");
  assert.equal(expiryWarning(id(at(1.5), at(100)), { now }).title, "Certificate Expires Tomorrow");
  assert.equal(expiryWarning(id(null, at(1.5)), { now }).title, "Profile Expires Tomorrow"); // no certificate date
  assert.equal(expiryWarning(id(at(4), at(4)), { now }).what, "Certificate"); // a tie names the certificate
});

test("Show Expiry Warning off: no amber or red, but Expired still shows", () => {
  assert.equal(expiryWarning(id(at(5)), { now, show: false }), null);
  assert.equal(expiryWarning(id(at(1.5)), { now, show: false }), null);
  assert.equal(expiryWarning(id(at(-1)), { now, show: false }).stage, "gone");
  assert.equal(expiryWarning(id(at(300), at(-1)), { now, show: false }).title, "Profile Expired");
});

test("Settings: Show Expiry Warning (switch, on) above Expiry Warning (list, 1 Week), sideload build only", () => {
  const sw = SETTINGS.find((d) => d.key === "showExpiryWarning");
  const list = SETTINGS.find((d) => d.key === "expiryWarning");
  assert.equal(sw.kind, "toggle");
  assert.equal(sw.label, "Show Expiry Warning");
  assert.equal(list.kind, "list"); // an iOS 6 checkmark list, like Re-sign Reminder's
  assert.equal(list.label, "Expiry Warning");
  assert.deepEqual(list.options.map((o) => [o.value, o.label]),
    [[3, "3 Days"], [7, "1 Week"], [14, "2 Weeks"], [30, "1 Month"], [60, "2 Months"]]);
  assert.equal(list.needs, "showExpiryWarning");
  const s = createSettings({ storage: memStorage(), mode: "sideload" });
  assert.equal(s.get("showExpiryWarning"), true);
  assert.equal(s.get("expiryWarning"), 7);
  assert.equal(EXPIRY_WARNING, 7);
  const sec = s.sections().find((x) => x.id === "expiry");
  assert.equal(sec.page, "signing");
  assert.deepEqual(sec.settings.map((d) => d.key), ["showExpiryWarning", "expiryWarning"]);
  assert.ok(SECTIONS.findIndex((x) => x.id === "expiry") > SECTIONS.findIndex((x) => x.id === "signing"));
  for (const mode of ["site", "jailbreak"]) {
    const o = createSettings({ storage: memStorage(), mode });
    assert.equal(o.isShown("showExpiryWarning"), false, mode);
    assert.equal(o.isShown("expiryWarning"), false, mode);
  }
  s.set("expiryWarning", 30);
  assert.equal(expiryWarningDays((k) => s.get(k)), 30);
  assert.equal(expiryWarningDays(() => undefined), 7);
  assert.equal(expiryWarningDays(() => { throw new Error("x"); }), 7);
});

test("the Expiry Warning row hides while Show Expiry Warning is off", () => {
  const list = SETTINGS.find((d) => d.key === "expiryWarning");
  assert.equal(needsShown(list, () => true), true);
  assert.equal(needsShown(list, () => false), false);
  assert.equal(needsShown(SETTINGS.find((d) => d.key === "resignReminder"), () => false), true); // no `needs`
});

test("certWarning reads the settings: window, re-sign days, the switch", () => {
  const vals = { expiryWarning: 14, resignReminder: 3, showExpiryWarning: true };
  const get = (k) => vals[k];
  assert.equal(certWarning(id(at(10)), { get, now }).stage, "soon"); // 2 Weeks shows it
  assert.equal(certWarning(id(at(2.5)), { get, now }).stage, "close"); // 3-day reminder
  vals.expiryWarning = 3;
  assert.equal(certWarning(id(at(10)), { get, now }), null);
  vals.showExpiryWarning = false;
  assert.equal(certWarning(id(at(2.5)), { get, now }), null);
  assert.equal(certWarning(id(at(-0.5)), { get, now }).stage, "gone"); // expired, whatever the switch says
});

test("only the sideload build shows the tile", () => {
  assert.equal(showsCertTile("sideload", true), true);
  assert.equal(showsCertTile("jailbreak", true), false);
  assert.equal(showsCertTile("site", true), false);
  assert.equal(showsCertTile("sideload", false), false); // the setting's feature missing
});

test("certIdentity: the status's identity, JSON text too; null when none or the signer fails", async () => {
  const ident = id(at(3));
  assert.deepEqual(await certIdentity({ status: async () => ({ identity: ident }) }), ident);
  assert.deepEqual(await certIdentity({ status: async () => JSON.stringify({ identity: ident }) }), ident);
  assert.equal(await certIdentity({ status: async () => ({ identity: null }) }), null);
  assert.equal(await certIdentity({ status: async () => { throw new Error("no bridge"); } }), null);
});

test("home.js: the tile sits under the welcome, above GitHub | Discord, links to Signing, the failed glyph", () => {
  const js = src("./home.js");
  assert.match(js, /tileRow\("stack cert", tile\(\{ label: "", subtitle: " ", href: format\(settingsRoute\(\["signing"\]\)\), glyph: "failed" \}\)\)/);
  const order = js.slice(js.indexOf("home.append(\n    head,"));
  assert.ok(order.indexOf("certRow()") < order.indexOf("tileRow(\"pair\""));
  assert.ok(order.indexOf("head,") < order.indexOf("certRow()"));
  assert.deepEqual(CERT_STAGES, ["soon", "close", "gone"]);
  assert.match(js, /ifizbox:signing-status/); // Settings > Signing's status updates it
  assert.match(src("./settings.js"), /new CustomEvent\("ifizbox:signing-status", \{ detail: kept \}\)/);
});

test("home.css: the concept's colours for each stage, light and dark", () => {
  const css = src("../home.css");
  assert.match(css, /\.home-row\.cert\.soon  \{ --cert-bg: #fff6e0; --cert-edge: #e0b65a; --cert-ink: #d98a00; \}/);
  assert.match(css, /\.home-row\.cert\.close \{ --cert-bg: #ffe9e6; --cert-edge: #e08a80; --cert-ink: #d1281b; \}/);
  assert.match(css, /\.home-row\.cert\.gone > \.table \{\s*background: linear-gradient\(#e4473b, #c4261b\); background-origin: border-box;/);
  assert.match(css, /html\[data-theme="dark"\] \.home-row\.cert\.soon, html\[data-theme="dark"\] \.home-row\.cert\.close \{/);
});
