// F76: what the Share sheet lists on a source's page and on an app's page (screens/handoff.js shareItems).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shareItems, sourceUrlOf, APP_TILES } from "./handoff.js";

const ORIGIN = "https://cydian.dev";
const APT = { key: "deb:https://repo.example/:./", uri: "https://repo.example/", dist: "./" };
const ALT = { key: "alt:https://alt.example/apps.json", kind: "altstore", uri: "https://alt.example/apps.json" };
const kinds = (items) => items.map((i) => (i.kind === "open" ? i.label : i.kind));

test("an AltStore source: Copy Link, Add on Another Device, then every AltStore-format sideloader", () => {
  const items = shareItems(ALT, { origin: ORIGIN, jailbroken: false });
  assert.deepEqual(kinds(items), ["copy", "qr", "AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps"]);
  assert.equal(items[0].label, "Copy Link");
  assert.equal(items[0].text, "https://alt.example/apps.json");
  assert.equal(items[1].label, "Add on Another Device");
  assert.equal(items[1].link, `${ORIGIN}/add?url=${encodeURIComponent("https://alt.example/apps.json")}`);
  assert.equal(items.find((i) => i.label === "SideStore").url, `sidestore://source?url=${encodeURIComponent(ALT.uri)}`);
  for (const i of items.slice(2)) {
    assert.match(i.letter, /^[A-Z]$/);
    assert.match(i.color, /^#[0-9a-f]{6}$/);
  }
});

test("an APT source: the four managers on a jailbroken phone, only the link and QR code on one that isn't", () => {
  assert.deepEqual(kinds(shareItems(APT, { origin: ORIGIN, jailbroken: true })), ["copy", "qr", "Cydia", "Sileo", "Zebra", "Irisin"]);
  assert.deepEqual(kinds(shareItems(APT, { origin: ORIGIN, jailbroken: false })), ["copy", "qr"]);
  assert.equal(shareItems(APT, { origin: ORIGIN, jailbroken: true })[0].text, "https://repo.example/");
  // A dist repo: only Irisin takes a suite.
  const dist = { key: "deb:https://apt.procurs.us/:iphoneos-arm64/1900", uri: "https://apt.procurs.us/", dist: "iphoneos-arm64/1900", components: ["main"] };
  assert.deepEqual(kinds(shareItems(dist, { origin: ORIGIN, jailbroken: true })), ["copy", "qr", "Irisin"]);
});

test("an app's page: Copy Link, Add on Another Device, then the apps that take its source", () => {
  assert.deepEqual(kinds(shareItems(ALT, { app: true, origin: ORIGIN, jailbroken: true })), kinds(shareItems(ALT, { origin: ORIGIN, jailbroken: true })));
  assert.deepEqual(kinds(shareItems(ALT, { app: true, origin: ORIGIN })).slice(0, 2), ["copy", "qr"]);
});

test("other IPA formats get their own app first; nothing to share without an http URL", () => {
  const esign = { ...ALT, format: "esign" };
  assert.deepEqual(kinds(shareItems(esign, { origin: ORIGIN })).slice(0, 4), ["copy", "qr", "ESign", "AltStore Classic"]);
  assert.deepEqual(kinds(shareItems({ ...ALT, format: "scarlet" }, { origin: ORIGIN })), ["copy", "qr", "Scarlet"]);
  assert.deepEqual(shareItems({ key: "deb:file:///x:./", uri: "file:///x/" }, { origin: ORIGIN, jailbroken: true }), []);
  assert.deepEqual(shareItems(null), []);
  assert.equal(sourceUrlOf({ uri: "javascript:alert(1)" }), null);
});

test("every app the hand-offs name has its own tile", () => {
  for (const app of ["Cydia", "Sileo", "Zebra", "Irisin", "AltStore Classic", "AltStore", "SideStore", "Feather", "LiveContainer", "StikStore", "TrollApps", "Scarlet", "ESign", "GBox"]) {
    assert.ok(APP_TILES[app], app);
  }
});
