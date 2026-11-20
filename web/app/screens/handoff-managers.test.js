// F219: the jailbreak build's package page: no Open In group, and Share lists only the package managers iOS says are
// installed (handoff.js MANAGER_BUNDLES / installedManagers, browse.js packageShareItems). Site mode is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openInGroup, MANAGER_BUNDLES, managersIn, installedManagers } from "./handoff.js";
import { packageShareItems } from "./browse.js";
import { fakeDocument as fakeDom } from "../fakes.test-helper.js";

const ORIGIN = "https://ifizbox.com";
const KEY = "deb:https://repo.example/:./";
const APT = { key: KEY, uri: "https://repo.example/", dist: "./" };
const PKG = { id: "com.example.tweak", key: KEY };
const labels = (items) => items.map((i) => i.label);

function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = fakeDom();
  try { return fn(); } finally { globalThis.document = saved; }
}

test("F219: a package page in the jailbreak build has no Open In group; the website keeps it", () => withDom(() => {
  const jb = openInGroup(APT, { pkg: PKG.id, jailbroken: true, mode: "jailbreak" });
  assert.equal(jb.children.length, 0, "nothing on the jailbreak build's package page");
  for (const mode of ["site", "sideload"]) {
    const site = openInGroup(APT, { pkg: PKG.id, jailbroken: true, mode });
    assert.ok(site.children.length > 0, mode);
    const text = site.textContent;
    assert.match(text, /Open In/, mode);
    for (const app of ["Cydia", "Sileo", "Zebra", "Irisin"]) assert.match(text, new RegExp(`Open in ${app}`), `${mode}: ${app}`);
  }
  // A source's page isn't the package page: the group's rule there is F76's, untouched.
  const src = openInGroup(APT, { jailbroken: true, mode: "jailbreak" });
  assert.match(src.textContent, /Add on Another Device/);
}));

test("F219: the managers' bundle IDs, and which an answer marks installed", () => {
  assert.deepEqual(Object.keys(MANAGER_BUNDLES), ["Cydia", "Sileo", "Zebra", "Irisin"]);
  assert.ok(MANAGER_BUNDLES.Sileo.includes("org.coolstar.SileoStore"));
  assert.ok(MANAGER_BUNDLES.Sileo.includes("org.coolstar.SileoNightly"));
  assert.deepEqual([...managersIn({ "org.coolstar.SileoStore": true, "com.saurik.Cydia": false, "xyz.willy.Zebra": null })], ["Sileo"]);
  assert.deepEqual([...managersIn({ "org.coolstar.SileoNightly": true, "wiki.qaq.irisin": true })], ["Sileo", "Irisin"]);
  assert.equal(managersIn({}).size, 0);
  assert.equal(managersIn(null).size, 0);
});

test("F219: installedManagers asks the backend once with every manager's ID; none where it can't ask", async () => {
  const asked = [];
  const backend = { appsInstalled: async (ids) => { asked.push(ids); return { "xyz.willy.Zebra": true, "com.saurik.Cydia": false }; } };
  assert.deepEqual([...await installedManagers(backend)], ["Zebra"]);
  assert.deepEqual(asked[0], Object.values(MANAGER_BUNDLES).flat());
  assert.equal((await installedManagers({ kind: "http" })).size, 0, "the website's backend has no appsInstalled");
  assert.equal((await installedManagers({ appsInstalled: async () => { throw new Error("no bridge"); } })).size, 0);
});

test("F219: the package Share sheet lists only the detected managers in the jailbreak build; site mode unchanged", () => {
  const jb = (managers) => packageShareItems(PKG, APT, { origin: ORIGIN, mode: "jailbreak", jailbroken: true, managers });
  assert.deepEqual(labels(jb(new Set(["Sileo"]))), ["Copy Link", "Sileo"]);
  assert.equal(jb(new Set(["Sileo"]))[1].url, "sileo://package/com.example.tweak");
  assert.deepEqual(labels(jb(new Set(["Irisin", "Cydia"]))), ["Copy Link", "Cydia", "Irisin"], "in the usual order");
  assert.deepEqual(labels(jb(new Set())), ["Copy Link"], "none installed: just the other rows");
  assert.deepEqual(labels(jb(null)), ["Copy Link"], "not asked yet: none");
  // An AltStore app on a tweak page's sheet never gets the APT managers.
  assert.deepEqual(labels(packageShareItems({ ...PKG, kind: "ipa" }, APT, { origin: ORIGIN, mode: "jailbreak", managers: new Set(["Sileo"]) })), ["Copy Link"]);
  // The sideload IPA lists none; the website all four on a phone set to Jailbroken, whatever `managers` says.
  assert.deepEqual(labels(packageShareItems(PKG, APT, { origin: ORIGIN, mode: "sideload", jailbroken: true, managers: new Set(["Sileo"]) })), ["Copy Link"]);
  assert.deepEqual(labels(packageShareItems(PKG, APT, { origin: ORIGIN, mode: "site", jailbroken: true })), ["Copy Link", "Cydia", "Sileo", "Zebra", "Irisin"]);
  assert.deepEqual(labels(packageShareItems(PKG, APT, { origin: ORIGIN, mode: "site", jailbroken: true, managers: new Set() })),
    ["Copy Link", "Cydia", "Sileo", "Zebra", "Irisin"]);
});

test("F219: the package page's Share asks which managers are installed before it opens", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function showPackageShare("), src.indexOf("// ---- F193"));
  assert.match(fn, /await installedManagers\(\)/);
  assert.match(fn, /packageShareItems\(item, source, \{ managers \}\)/);
  assert.match(fn, /image: appIcon\(s\.label\)/);
});
