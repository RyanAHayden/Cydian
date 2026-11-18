// F77: My IPAs' list and states (core/myipas.js), and the website's library of links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, libraryRows, ipaSubtitle, formatBytes, nameFromUrl, ipaToken, fileOfToken, optionsParams, siteEntries,
  addSiteUrl, removeSiteUrl, STATE_LABELS, MYIPAS } from "./myipas.js";

const entry = (over = {}) => ({ file: "Delta.ipa", name: "Delta", bundleId: "com.rileytestut.Delta", version: "1.6", size: 15_000_000,
  icon: null, error: null, extensions: [], options: {}, signed: null, ...over });

test("an IPA's state: signed, not signed yet, unreadable, or (website) signed by the server", () => {
  assert.deepEqual(stateOf(entry()), { kind: "unsigned", label: "Not signed yet" });
  assert.deepEqual(stateOf(entry({ signed: { at: "2026-11-17T10:00:00Z" } })), { kind: "signed", label: "Signed, ready to install" });
  assert.equal(stateOf(entry({ error: "That isn't an IPA" })).kind, "broken");
  assert.equal(stateOf(entry({ error: "x", signed: { at: "" } })).kind, "broken");
  assert.equal(stateOf({ file: "A.ipa", url: "https://x/A.ipa" }, { site: true }).label, STATE_LABELS.link);
  assert.equal(MYIPAS, "myipas");
});

test("the list: A to Z by name, with version, size and state under it", () => {
  const rows = libraryRows([
    entry({ file: "z.ipa", name: "zebra" }), entry({ file: "b.ipa", name: "Apple", signed: { at: "x" } }),
    entry({ file: "n.ipa", name: "", version: "", size: 0 }), null, { name: "no file" },
  ]);
  assert.deepEqual(rows.map((r) => r.title), ["Apple", "n.ipa", "zebra"]);
  assert.equal(rows[0].subtitle, "1.6 · 14.3 MB · Signed, ready to install");
  assert.equal(rows[1].subtitle, "Not signed yet");
  assert.equal(rows[2].state.kind, "unsigned");
  assert.equal(ipaSubtitle(entry({ size: 2048 })), "1.6 · 2.0 KB · Not signed yet");
});

test("sizes", () => {
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes("x"), "");
  assert.equal(formatBytes(500), "500 bytes");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(150 * 1024 * 1024), "150 MB");
  assert.equal(formatBytes(3 * 1024 ** 3), "3.0 GB");
});

test("a link's file name", () => {
  assert.equal(nameFromUrl("https://github.com/a/b/releases/download/v1/My%20App.IPA"), "My App.ipa");
  assert.equal(nameFromUrl("https://x.test/dl?id=4"), "");
  assert.equal(nameFromUrl("https://x.test/.hidden.ipa"), "hidden.ipa");
  assert.equal(nameFromUrl("ftp://x.test/a.ipa"), "");
  assert.equal(nameFromUrl("not a url"), "");
});

test("route tokens", () => {
  assert.equal(ipaToken("A b.ipa"), "ipa:A b.ipa");
  assert.equal(fileOfToken("ipa:A b.ipa"), "A b.ipa");
  assert.equal(fileOfToken("package:x"), null);
  assert.equal(fileOfToken(undefined), null);
});

test("Sign Options: only what changes, a bad bundle ID refused", () => {
  const info = entry({ extensions: [{ path: "PlugIns/Share.appex" }, { path: "PlugIns/Widget.appex" }] });
  assert.deepEqual(optionsParams(info, { name: "Delta", bundleId: " com.rileytestut.Delta ", removeExtensions: [] }),
    { file: "Delta.ipa", name: "", bundleId: "", removeExtensions: [], fixArm64e: true });
  assert.deepEqual(optionsParams(info, { name: "Delta 2", bundleId: "com.me.delta", icon: "iVBO", fixArm64e: false,
    removeExtensions: ["PlugIns/Widget.appex", "PlugIns/Gone.appex", "PlugIns/Widget.appex"] }),
  { file: "Delta.ipa", name: "Delta 2", bundleId: "com.me.delta", removeExtensions: ["PlugIns/Widget.appex"], fixArm64e: false, icon: "iVBO" });
  assert.throws(() => optionsParams(info, { bundleId: "not a bundle id" }), /isn't a bundle ID/);
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("the website's library: links kept on this device, one entry per link, unique names", () => {
  const s = memoryStorage();
  assert.deepEqual(siteEntries(s), []);
  const a = addSiteUrl(s, "https://x.test/Delta.ipa", Date.UTC(2026, 10, 17));
  assert.deepEqual(a, { file: "Delta.ipa", url: "https://x.test/Delta.ipa", name: "Delta", added: "2026-11-17T00:00:00.000Z" });
  assert.equal(addSiteUrl(s, "https://x.test/Delta.ipa").file, "Delta.ipa"); // the same link: the same entry
  assert.equal(addSiteUrl(s, "https://y.test/Delta.ipa").file, "Delta 2.ipa");
  assert.equal(addSiteUrl(s, "https://y.test/get?id=1").file, "App.ipa");
  assert.throws(() => addSiteUrl(s, "javascript:alert(1)"), /https/);
  assert.throws(() => addSiteUrl(s, "nonsense"), /link/);
  assert.equal(siteEntries(s).length, 3);
  removeSiteUrl(s, "Delta.ipa");
  assert.deepEqual(siteEntries(s).map((e) => e.file), ["Delta 2.ipa", "App.ipa"]);
  s.setItem("cydian.myIpas", "{broken");
  assert.deepEqual(siteEntries(s), []);
});
