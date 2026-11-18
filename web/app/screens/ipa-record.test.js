// F88: the jailbreak app records the apps it installs (core/installed.js), so F87's Apps page, the app page's
// Installed App group and Changes' app upgrades have something to show. The AltStore Install row records once the
// helper's install succeeds (not on the tap); an IPA from a URL or link is remembered by its bundle id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRows } from "./altstore.js";
import { rememberIpa } from "./ipa-install.js";
import { memoryAppStore } from "../core/installed.js";

const V = { version: "1.2", downloadURL: "https://example.com/Delta.ipa" };

test("jailbreak Install row: records on the helper's success, not on the tap", async () => {
  const runs = [];
  let recorded = 0;
  const { rows } = installRows(V, "https://example.com/apps.json", () => {}, () => { recorded++; }, null, "Delta",
    { jailbreak: true, custom: false, ipaInstall: (o) => { runs.push(o); } });
  assert.deepEqual(rows.map((r) => r.label), ["Install", "Download IPA"]);
  assert.equal(rows[0].subtitle, "With the jailbreak");
  rows[0].onClick();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].url, V.downloadURL);
  assert.equal(runs[0].name, "Delta");
  assert.equal(recorded, 0); // a failed install records nothing
  runs[0].onInstalled({ ok: true, bundleId: "com.rileytestut.Delta" });
  assert.equal(recorded, 1);
});

test("rememberIpa: a URL's IPA by bundle id, with no version (I4 fills it in)", async () => {
  const s = memoryAppStore();
  const rec = await rememberIpa({ ok: true, bundleId: "com.example.app" }, "App", { store: async () => s });
  assert.equal(rec.id, "com.example.app");
  assert.equal(rec.name, "App");
  assert.equal(rec.version, "");
  assert.deepEqual((await s.all()).map((r) => r.id), ["com.example.app"]);
});

test("rememberIpa: keeps a record from the app's source page; nothing without a bundle id", async () => {
  const s = memoryAppStore([{ id: "com.example.app", name: "Example", version: "2.0", key: "k", source: "https://s", date: 1 }]);
  assert.equal(await rememberIpa({ bundleId: "com.example.app" }, "x", { store: async () => s }), null);
  assert.equal((await s.all())[0].version, "2.0");
  assert.equal(await rememberIpa({ bundleId: "" }, "x", { store: async () => s }), null);
  assert.equal(await rememberIpa({ bundleId: "a.b" }, "x", { store: async () => { throw new Error("no store"); } }), null);
});
