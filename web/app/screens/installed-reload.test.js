// B281: an install from an ifizbox://install link (or another sideloader's IPA link) writes no Installed record, so
// when its run ends incoming.js has Installed load the signed records again (reloadSigned): a record that still says
// the app came from My IPAs goes, every live apps list loads again, and the app pages draw again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadSigned, libraryRecord } from "./installed.js";
import { memoryAppStore, onAppsChange } from "../core/installed.js";
import { handleIncoming } from "../incoming.js";

const LINK = "ifizbox://install?url=" + encodeURIComponent("https://e.example/probe.ipa") + "&name=Probe";
const yes = async () => ({ index: 1 });

test("B281: the link's Install ends, then Installed reloads with the install's answer", async () => {
  const order = [];
  const install = async ({ onInstalled }) => { order.push("install"); onInstalled({ bundleId: "com.example.probe", version: "1.0" }); return true; };
  const reload = async (answer) => { order.push(["reload", answer?.bundleId ?? null]); };
  assert.equal(await handleIncoming(LINK, { alert: yes, install, open: () => {}, reload }), "install");
  assert.deepEqual(order, ["install", ["reload", "com.example.probe"]]);
});

test("B281: a run that fails (no answer, or throws) still reloads; Cancel doesn't", async () => {
  const got = [];
  const reload = async (answer) => { got.push(answer); };
  await handleIncoming(LINK, { alert: yes, install: async () => false, open: () => {}, reload });
  await assert.rejects(handleIncoming(LINK, { alert: yes, install: async () => { throw new Error("boom"); }, open: () => {}, reload }));
  await handleIncoming(LINK, { alert: async () => ({ index: 0 }), install: async () => assert.fail("installed"), open: () => {}, reload });
  assert.deepEqual(got, [null, null]);
});

test("B281: another sideloader's IPA link reloads too", async () => {
  const got = [];
  const r = await handleIncoming(`feather://install/https://cdn.example.com/My.ipa`, { alert: yes, on: () => true, open: () => {},
    install: async ({ onInstalled }) => { onInstalled({ bundleId: "my.app" }); return true; }, reload: async (a) => { got.push(a.bundleId); } });
  assert.equal(r, "other-install");
  assert.deepEqual(got, ["my.app"]);
});

test("B281: a reload that fails doesn't fail the link", async () => {
  const r = await handleIncoming(LINK, { alert: yes, install: async () => true, open: () => {}, reload: async () => { throw new Error("no page"); } });
  assert.equal(r, "install");
});

test("B281: libraryRecord: a My IPAs install's record, not a source's", () => {
  assert.equal(libraryRecord({ id: "a", key: "library:probe.ipa", source: null, sourceName: "My IPAs" }), true);
  assert.equal(libraryRecord({ id: "a", key: "alt:a", source: "https://s/", sourceName: "S" }), false);
  assert.equal(libraryRecord({ id: "a", key: null, source: null }), false);
  assert.equal(libraryRecord(null), false);
});

test("B281: reloadSigned drops the app's My IPAs record (the lists hear it), keeps a source's and other apps'", async () => {
  const store = memoryAppStore([
    { id: "com.example.probe", name: "Probe", version: "1.0", key: "library:probe.ipa", source: null, sourceName: "My IPAs", date: 1 },
    { id: "src.app", name: "Src", version: "2", key: "alt:src.app", source: "https://s/", sourceName: "S", date: 2 },
    { id: "other", name: "Other", version: "1", key: "library:other.ipa", source: null, sourceName: "My IPAs", date: 3 },
  ]);
  let heard = 0;
  const off = onAppsChange(() => { heard++; });
  try {
    assert.equal(await reloadSigned({ bundleId: "com.example.probe" }, { store: async () => store }), true);
    assert.equal(heard, 1);
    assert.equal(await reloadSigned({ bundleId: "src.app" }, { store: async () => store }), false);
    assert.equal(await reloadSigned(null, { store: async () => store }), false);
    assert.equal(heard, 1);
  } finally { off(); }
  assert.deepEqual((await store.all()).map((r) => r.id).sort(), ["other", "src.app"]);
});

test("B281: reloadSigned without a store still resolves", async () => {
  assert.equal(await reloadSigned({ bundleId: "x" }, { store: async () => { throw new Error("no IndexedDB"); } }), false);
});
