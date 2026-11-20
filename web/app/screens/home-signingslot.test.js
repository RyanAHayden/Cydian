// F307 (concept K3, option C): Home's signing slot, in the certificate-expiry tile's place: solid red Signing Needs
// Setup while signing isn't set up (website and sideload app), Signing Server Down when the sideload app's server
// doesn't answer, else the expiry warning; the plain Signing half-tile is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signingTile, serverDownTile, SETUP_TILE } from "../core/signing.js";
import { signingSlot, slotTile, showsSigningSlot, signingSetUp } from "./home.js";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-19T12:00:00Z");
const at = (days) => new Date(now.getTime() + days * DAY).toISOString();
const ident = (days) => ({ name: "Dev", expires: at(days), profile: null });
const get = (k) => ({ expiryWarning: 7, resignReminder: 2, showExpiryWarning: true })[k];

test("signingTile: setup first, then expired, then server down, then the warning", () => {
  assert.deepEqual(signingTile({ setUp: false }), { stage: "gone", kind: "setup", title: "Signing Needs Setup", subtitle: "Nothing can be installed yet" });
  assert.deepEqual(signingTile({ setUp: false, serverUp: false }), { ...SETUP_TILE });
  const down = signingTile({ serverUp: false, server: "https://sign.example.com" });
  assert.deepEqual([down.stage, down.kind, down.title, down.subtitle],
    ["gone", "server", "Signing Server Down", "Can't reach sign.example.com · Check in Signing"]);
  assert.equal(serverDownTile("not a url").subtitle, "Can't reach it · Check in Signing");
  const gone = { stage: "gone", title: "Certificate Expired", subtitle: "x" };
  assert.equal(signingTile({ serverUp: false, server: "https://a.b", warning: gone }).title, "Certificate Expired");
  const soon = { stage: "soon", title: "Certificate Expires Soon", subtitle: "y" };
  assert.equal(signingTile({ serverUp: false, server: "https://a.b", warning: soon }).kind, "server");
  assert.equal(signingTile({ warning: soon }).kind, "expiry");
  assert.equal(signingTile({}), null);
  assert.equal(signingTile(), null);
});

test("the slot shows on the website and in the sideload app, never the jailbreak app", async () => {
  assert.equal(showsSigningSlot("site"), true);
  assert.equal(showsSigningSlot("sideload"), true);
  assert.equal(showsSigningSlot("jailbreak"), false);
  assert.equal(slotTile("jailbreak", { setUp: false }), null);
  let asked = false;
  const s = await signingSlot("jailbreak", { setUp: async () => { asked = true; return false; } });
  assert.equal(asked, false);
  assert.equal(slotTile("jailbreak", s), null);
});

test("signingSlot: not set up skips the server; set up asks it (sideload only)", async () => {
  let pinged = 0;
  const reachable = async () => { pinged++; return false; };
  const no = await signingSlot("sideload", { setUp: async () => false, reachable, identity: async () => null });
  assert.equal(pinged, 0);
  assert.equal(slotTile("sideload", no, { certShown: true, get, now }).title, "Signing Needs Setup");
  const down = await signingSlot("sideload", { setUp: async () => true, reachable, identity: async () => ident(300), server: () => "https://s.example" });
  assert.equal(pinged, 1);
  assert.equal(slotTile("sideload", down, { certShown: true, get, now }).title, "Signing Server Down");
  const up = await signingSlot("sideload", { setUp: async () => true, reachable: async () => true, identity: async () => ident(300), server: () => "https://s.example" });
  assert.equal(slotTile("sideload", up, { certShown: true, get, now }), null);
  const soon = { ...up, identity: ident(5) };
  assert.equal(slotTile("sideload", soon, { certShown: true, get, now }).title, "Certificate Expires Soon");
  assert.equal(slotTile("sideload", soon, { certShown: false, get, now }), null); // Show Expiry Warning's feature missing
  const site = await signingSlot("site", { setUp: async () => true, reachable });
  assert.equal(pinged, 1); // the website has no server of its own to check
  assert.equal(slotTile("site", site, { get, now }), null);
  assert.equal(slotTile("site", await signingSlot("site", { setUp: async () => false }), { get, now }).title, "Signing Needs Setup");
  const threw = await signingSlot("sideload", { setUp: async () => { throw new Error("bridge"); } });
  assert.equal(threw.setUp, false);
  const failing = await signingSlot("sideload", { setUp: async () => true, reachable: async () => { throw new Error("x"); }, identity: async () => { throw new Error("y"); }, server: () => "https://s.example" });
  assert.deepEqual([failing.serverUp, failing.identity], [false, null]);
});

test("website: a Free Apple ID login counts as set up", async () => {
  assert.equal(await signingSetUp("site", { ready: async () => false, free: async () => true }), true);
  assert.equal(await signingSetUp("site", { ready: async () => false, free: async () => false }), false);
  assert.equal(await signingSetUp("site", { ready: async () => true, free: async () => { throw new Error("never asked"); } }), true);
});

test("home.js: no plain Signing tile; the slot sits under the welcome and Reload re-checks it", () => {
  const js = src("./home.js");
  assert.doesNotMatch(js, /label: "Signing", href/);
  const order = js.slice(js.indexOf("home.append(\n    head,"));
  assert.ok(order.indexOf("slotRow,") > order.indexOf("head,"));
  assert.ok(order.indexOf("slotRow,") < order.indexOf("tileRow(\"pair\""));
  assert.match(js, /slotRow\.recheck\?\.\(\)/);
  assert.match(js, /visibilitychange/);
});
