// B283: a URL install (ifizbox://install link, another sideloader's IPA link) of an app last installed from My IPAs
// drops that app's My IPAs record once the install lands, so the app reads as a fresh URL install; keptIpa still finds
// My IPAs' signed copy by bundle ID.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropMyIpasRecord, libraryRecord, keptIpaOf, appActions } from "./installed.js";
import { memoryAppStore, onAppsChange } from "../core/installed.js";
import { handleIncoming } from "../incoming.js";

const LINK = "ifizbox://install?url=" + encodeURIComponent("https://e.example/probe.ipa") + "&name=Probe";
const yes = async () => ({ index: 1 });
const PROBE = { id: "com.example.probe", name: "Probe", version: "1.0", key: "library:probe.ipa", source: null, sourceName: "My IPAs", date: 1 };
const signedAs = (url) => async () => ({ apps: [{ bundleId: "com.example.probe", name: "Probe", version: "1.0", url, expires: "2027-11-01T00:00:00Z" }] });

test("B283: libraryRecord: a My IPAs install's record, not a source's", () => {
  assert.equal(libraryRecord(PROBE), true);
  assert.equal(libraryRecord({ id: "a", key: "alt:a", source: "https://s/", sourceName: "S" }), false);
  assert.equal(libraryRecord({ id: "a", key: null, source: null }), false);
  assert.equal(libraryRecord(null), false);
});

test("B283: the link's install drops the app's My IPAs record before Installed reloads", async () => {
  const order = [];
  const install = async ({ onInstalled }) => { order.push("install"); onInstalled({ bundleId: "com.example.probe" }); return true; };
  const drop = async (r) => { await null; order.push(["drop", r.bundleId]); };
  const reload = async () => { order.push("reload"); };
  assert.equal(await handleIncoming(LINK, { alert: yes, install, open: () => {}, reload, drop }), "install");
  assert.deepEqual(order, ["install", ["drop", "com.example.probe"], "reload"]);
});

test("B283: no answer (failed run), or another sideloader's link, drops only what the install said", async () => {
  const got = [];
  const drop = async (r) => { got.push(r.bundleId); };
  await handleIncoming(LINK, { alert: yes, install: async () => false, open: () => {}, reload: async () => {}, drop });
  assert.deepEqual(got, []);
  await handleIncoming("feather://install/https://cdn.example.com/My.ipa", { alert: yes, on: () => true, open: () => {},
    install: async ({ onInstalled }) => { onInstalled({ bundleId: "my.app" }); return true; }, reload: async () => {}, drop });
  assert.deepEqual(got, ["my.app"]);
});

test("B283: a run that lands after the link returned (waited for a connection) drops, then reloads Installed again", async () => {
  const order = [];
  let later = null;
  const install = async ({ onInstalled }) => { later = onInstalled; return false; }; // rememberInstall: runs later
  const drop = async (r) => { order.push(["drop", r.bundleId]); };
  let reloaded = null;
  const reload = async () => { order.push("reload"); reloaded?.(); };
  await handleIncoming(LINK, { alert: yes, install, open: () => {}, reload, drop });
  assert.deepEqual(order, ["reload"]);
  const second = new Promise((res) => { reloaded = res; });
  later({ bundleId: "com.example.probe" });
  await second;
  assert.deepEqual(order, ["reload", ["drop", "com.example.probe"], "reload"]);
});

test("B283: a drop that throws doesn't fail the link and Installed still reloads", async () => {
  let reloaded = 0;
  const r = await handleIncoming(LINK, { alert: yes, open: () => {}, reload: async () => { reloaded++; },
    install: async ({ onInstalled }) => { onInstalled({ bundleId: "x" }); return true; }, drop: async () => { throw new Error("no store"); } });
  assert.equal(r, "install");
  assert.equal(reloaded, 1);
});

test("B283: dropMyIpasRecord drops the My IPAs record once the shell's signed record is the URL's; the lists hear it", async () => {
  const store = memoryAppStore([PROBE, { ...PROBE, id: "other", key: "library:other.ipa", date: 3 }]);
  let heard = 0;
  const off = onAppsChange(() => { heard++; });
  try {
    assert.equal(await dropMyIpasRecord({ bundleId: "com.example.probe" }, { store: async () => store, signed: signedAs("https://e.example/probe.ipa") }), true);
  } finally { off(); }
  assert.equal(heard, 1);
  assert.deepEqual((await store.all()).map((r) => r.id), ["other"]);
});

test("B283: dropMyIpasRecord keeps the record when the signed record is still My IPAs', missing, or the record is a source's", async () => {
  const src = { id: "com.example.probe", name: "Probe", version: "1.0", key: "alt:com.example.probe", source: "https://s/", sourceName: "S", date: 2 };
  const cases = [
    [PROBE, signedAs("library:probe.ipa")], // the URL install didn't land: the signed record is still My IPAs'
    [PROBE, async () => null], // jailbreak build, website: no shell signed records
    [PROBE, async () => { throw new Error("no shell"); }],
    [src, signedAs("https://e.example/probe.ipa")], // Changes and Update read a source's record
  ];
  for (const [rec, signed] of cases) {
    const store = memoryAppStore([rec]);
    assert.equal(await dropMyIpasRecord({ bundleId: rec.id }, { store: async () => store, signed }), false);
    assert.equal((await store.all()).length, 1);
  }
  assert.equal(await dropMyIpasRecord(null, { store: async () => memoryAppStore([PROBE]), signed: signedAs("https://x/") }), false);
});

test("B283: with the record gone, the signed-only app still finds My IPAs' signed copy and keeps Re-sign and Save Signed IPA", () => {
  const signed = { bundleId: "com.example.probe", name: "Probe", version: "1.0", url: "https://e.example/probe.ipa" };
  const r = { id: signed.bundleId, name: "Probe", version: "1.0", signedOnly: true, signed };
  const ipa = keptIpaOf(r, [{ file: "probe.ipa", bundleId: "com.example.probe", signed: { bundleId: "com.example.probe" } }]);
  assert.equal(ipa?.file, "probe.ipa");
  const acts = appActions(r, { mode: "sideload", ipa });
  assert.ok(acts.includes("Re-sign"), acts.join());
  assert.ok(acts.includes("Save Signed IPA"), acts.join());
});
