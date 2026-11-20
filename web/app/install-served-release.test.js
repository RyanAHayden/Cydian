// B200: on the prompt route the queue used to wait on signing.progress until iOS finished installing (Installing
// 62/70/80% for a long while), and the next app waited with it. Once iOS has every byte of the IPA (the watch's
// {served: true}), the install is iOS's: the row ends Sent to iOS, the next app starts at once, and the watch's own
// later answer (installed: true) turns the row Installed.
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true,
  value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });

const { openPrepared, forgetRoute } = await import("./signing-client.js");
const { appRows, createAppRun, rowStatus } = await import("./core/apprun.js");

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// The prompt route for every app: signing.open answers at once; each signing.progress is held open, and the test
// drives it (events, then the watch's answer) through `watches[bundleId]`.
function promptNative() {
  const calls = [];
  const watches = {};
  return {
    calls,
    watches,
    call(method, params, onEvent) {
      calls.push([method, params?.bundleId ?? params?.token ?? null]);
      if (method === "signing.open") return Promise.resolve({ bundleId: `com.${params.token}`, expires: null });
      if (method === "signing.progress") {
        return new Promise((resolve) => { watches[params.bundleId] = { emit: onEvent, answer: resolve }; });
      }
      return Promise.resolve({});
    },
  };
}

test("B200: two queued installs, the second opens as soon as the first's IPA is all sent", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const rows = appRows([
    { id: "com.a", name: "Alpha", mode: "install", url: "https://x/a.ipa" },
    { id: "com.b", name: "Beta", mode: "install", url: "https://x/b.ipa" },
  ]);
  const lines = [];
  const run = createAppRun({
    rows,
    sign: async (r) => ({ token: r.id.slice(4), bundleId: r.id }),
    install: (r, o) => openPrepared(r, { ...o, tag: `${r.id}#1`, native }),
    onLog: ({ text }) => lines.push(text),
  });
  const end = run.start();
  await flush();
  const opens = () => native.calls.filter(([m]) => m === "signing.open").map(([, t]) => t);
  assert.deepEqual(opens(), ["a"], "only the first app is with iOS");

  // iOS downloads and starts installing: the queue still waits
  native.watches["com.a"].emit({ phase: "installing", progress: 0.62 });
  await flush();
  assert.equal(rows[0].state, "installing");
  assert.deepEqual(opens(), ["a"]);

  // every byte sent: the first is handed off and the second goes to iOS now, not when the watch ends
  native.watches["com.a"].emit({ served: true });
  await flush();
  assert.equal(rows[0].state, "installed");
  assert.equal(rows[0].unsure, true);
  assert.equal(rowStatus(rows[0]), "Sent to iOS");
  assert.deepEqual(opens(), ["a", "b"]);
  assert.ok(native.watches["com.b"], "the second app's watch began");

  // the first's watch goes on: its late progress doesn't move the ended row, its true makes it Installed
  native.watches["com.a"].emit({ phase: "installing", progress: 0.8 });
  native.watches["com.a"].answer({ installed: true, handedOff: false, dismissed: false });
  await flush();
  assert.equal(rows[0].state, "installed");
  assert.equal(rows[0].unsure, false);
  assert.ok(lines.includes("Installed Alpha"), lines.join(" | "));

  native.watches["com.b"].emit({ served: true });
  native.watches["com.b"].answer({ installed: false, handedOff: true, dismissed: false });
  await end;
  assert.equal(rows[1].state, "installed");
  assert.equal(rows[1].unsure, true, "a watch that can't tell stays Sent to iOS");
  assert.ok(!lines.includes("Installed Beta"));
});

test("B200: openPrepared answers at {served: true} with handedOff and a later promise", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const p = openPrepared({ id: "x", name: "X", token: "x" }, { tag: "x#1", native });
  await flush();
  native.watches["com.x"].emit({ served: true });
  const r = await p;
  assert.equal(r.installed, null);
  assert.equal(r.handedOff, true);
  native.watches["com.x"].answer({ installed: true });
  assert.equal(await r.later, true);
});

test("B200: without {served} the watch's answer still ends the install as before", async () => {
  store.clear();
  forgetRoute();
  const native = promptNative();
  const p = openPrepared({ id: "y", name: "Y", token: "y" }, { tag: "y#1", native });
  await flush();
  native.watches["com.y"].answer({ installed: true });
  assert.deepEqual(await p, { installed: true, expires: null });
});
