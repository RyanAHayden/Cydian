// F233: the app's refresh drives the Sources rows from apt-get update's lines as the helper streams them, and a
// failed row's retry asks the helper to update that source alone (update-source), falling back to the whole update on
// a helper without the verb (the fake helper, like every helper before F233a, refuses it with 64).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeBackend } from "./backend-native.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "../../native/fake/fake-indexeddb.mjs";

const PROCURSUS = "deb:https://apt.procurs.us/:1800";
const HAVOC = "deb:https://havoc.app/:./";

function setup(t, env = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
  return { native, backend: createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB() } }) };
}

test("F233: refreshSources { onRow }: a dead source goes red from apt's streamed Err line, before its record lands", async (t) => {
  const { backend, native } = setup(t, { FAKE_DEAD: "https://havoc.app/" });
  const order = [];
  const out = await backend.refreshSources((s) => order.push(["landed", s.key]), {
    onRow: (key, state, reason) => order.push([state, key, reason]),
  });
  const run = native.calls.find((c) => c.method === "helper.run");
  assert.deepEqual(run.params, { words: ["update"], stream: true });
  const red = order.findIndex((e) => e[0] === "failed" && e[1] === HAVOC);
  assert.ok(red >= 0, JSON.stringify(order));
  assert.equal(order[red][2], "apt-get update couldn't fetch Packages (525)");
  assert.ok(red < order.findIndex((e) => e[0] === "landed"), "red before any record landed");
  assert.ok(!order.some((e) => e[0] === "failed" && e[1] === PROCURSUS));
  assert.deepEqual(out.failed.map((f) => f.key), [HAVOC]);
});

test("F233: refreshSources without onRow streams nothing (as before)", async (t) => {
  const { backend, native } = setup(t);
  await backend.refreshSources();
  assert.deepEqual(native.calls.find((c) => c.method === "helper.run").params, { words: ["update"], stream: false });
});

test("F233: a retry asks for update-source of that one source; a helper without it runs the whole update", async (t) => {
  const { backend, native } = setup(t);
  const seen = [];
  const out = await backend.refreshSources((s) => seen.push(s.key), { filter: (s) => s.key === PROCURSUS, retry: true, onRow: () => {} });
  const words = native.calls.filter((c) => c.method === "helper.run").map((c) => c.params.words);
  assert.deepEqual(words, [["update-source", "https://apt.procurs.us/", "1800", "main"], ["update"]]);
  assert.deepEqual(seen, [PROCURSUS]);
  assert.equal(out[0].count, 2);
});

test("F233: updateSource: a helper that has the verb runs it alone; a flat source takes no components", async () => {
  const calls = [];
  const native = {
    call: async (method, params) => {
      calls.push([method, params]);
      if (method === "helper.run") return { code: 0, stdout: "Hit:1 https://havoc.app ./ InRelease\n", stderr: "" };
      if (method === "app.info") return {};
      return null;
    },
  };
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode: "jailbreak" } });
  const r = await backend.updateSource({ uri: "https://havoc.app/", dist: "./", components: ["x"] });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(calls.filter((c) => c[0] === "helper.run").map((c) => c[1].words), [["update-source", "https://havoc.app/", "./"]]);
});
