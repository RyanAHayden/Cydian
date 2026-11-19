// F243: a plain Install (signAndInstall) with the original app on the phone: originalWarning's alert, once per app,
// and library.* calls carrying Keep Bundle IDs (libraryCall).
import { test } from "node:test";
import assert from "node:assert/strict";
import { originalWarning, ORIGINAL_WARNED_KEY, libraryCall } from "./signing-client.js";
import { IFIZBOX_ID } from "./core/websign.js";

function fakeNative({ installed = {}, records = [] } = {}) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "apps.isInstalled") return { installed: Object.fromEntries(params.bundleIds.map((b) => [b, Boolean(installed[b])])) };
      if (method === "signing.installed") return { apps: records };
      return {};
    },
  };
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
const answering = (index, seen) => async (a) => { seen.push(a); return { index }; };

test("the original on the phone: the alert, Install remembered so the next Install goes straight on", async () => {
  const native = fakeNative({ installed: { "com.x.app": true } });
  const storage = memStorage();
  const seen = [];
  const r = await originalWarning({ bundleId: "com.x.app", name: "X" }, { native, storage, alert: answering(2, seen), keep: true });
  assert.equal(r, "install");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].title, "Delete the Original First?");
  assert.match(seen[0].message, /X is already on this iPhone/);
  assert.deepEqual(seen[0].buttons, ["Cancel", "Install a Copy", "Install"]);
  assert.deepEqual(JSON.parse(storage.getItem(ORIGINAL_WARNED_KEY)), ["com.x.app"]);
  const again = await originalWarning({ bundleId: "com.x.app", name: "X" }, { native, storage, alert: answering(0, seen), keep: true });
  assert.equal(again, "install");
  assert.equal(seen.length, 1, "warned once");
});

test("Cancel and Install a Copy aren't remembered", async () => {
  const native = fakeNative({ installed: { "com.x.app": true } });
  const storage = memStorage();
  const seen = [];
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native, storage, alert: answering(0, seen), keep: true }), "cancel");
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native, storage, alert: answering(1, seen), keep: true }), "copy");
  assert.equal(seen.length, 2);
  assert.equal(storage.getItem(ORIGINAL_WARNED_KEY), null);
});

test("nothing to say: not installed, signed by us, Keep Bundle IDs off, no ID, iFizBox itself, no bridge", async () => {
  const seen = [];
  const alert = answering(0, seen);
  const storage = memStorage();
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native: fakeNative(), storage, alert, keep: true }), "install");
  const ours = fakeNative({ installed: { "com.x.app": true }, records: [{ bundleId: "com.x.app" }] });
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native: ours, storage, alert, keep: true }), "install");
  const there = fakeNative({ installed: { "com.x.app": true, [IFIZBOX_ID]: true } });
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native: there, storage, alert, keep: false }), "install");
  assert.equal(await originalWarning({ bundleId: null }, { native: there, storage, alert, keep: true }), "install");
  assert.equal(await originalWarning({ bundleId: IFIZBOX_ID }, { native: there, storage, alert, keep: true }), "install");
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native: null, storage, alert, keep: true }), "install");
  assert.equal(seen.length, 0);
  assert.equal(there.calls.length, 0, "no bridge calls when there's nothing to check");
});

test("a bridge that fails counts as not installed", async () => {
  const native = { call: async () => { throw new Error("boom"); } };
  assert.equal(await originalWarning({ bundleId: "com.x.app" }, { native, storage: memStorage(), alert: async () => ({ index: 0 }), keep: true }), "install");
});

test("libraryCall: Keep Bundle IDs off goes with every call but options", async () => {
  const native = fakeNative();
  const saved = globalThis.localStorage;
  globalThis.localStorage = memStorage();
  try {
    await libraryCall("sign", { file: "A.ipa" }, null, native);
    assert.deepEqual(native.calls.at(-1), { method: "library.sign", params: { file: "A.ipa" } }, "on: nothing added");
    globalThis.localStorage.setItem("ifizbox.keepBundleId", "false");
    await libraryCall("sign", { file: "A.ipa" }, null, native);
    assert.deepEqual(native.calls.at(-1).params, { file: "A.ipa", keepBundleId: false });
    await libraryCall("list", {}, null, native);
    assert.deepEqual(native.calls.at(-1).params, { keepBundleId: false });
    await libraryCall("options", { file: "A.ipa", keepBundleId: true }, null, native);
    assert.deepEqual(native.calls.at(-1).params, { file: "A.ipa", keepBundleId: true }, "options: the page's own switch");
    await libraryCall("options", { file: "A.ipa" }, null, native);
    assert.deepEqual(native.calls.at(-1).params, { file: "A.ipa" });
  } finally {
    if (saved === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved;
  }
});
