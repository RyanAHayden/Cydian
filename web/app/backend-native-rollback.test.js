// F71: Roll Back's backend calls against the fake bridge and fake helper (native/fake/ifizbox-helper rollbacks |
// rollback): the stored copies listed newest first, one installed into dpkg's status with the console's lines, and
// the helper's refusals as errors. The package page's rows come from screens/rollback.js rollbackRows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNativeBackend, parseRollbacks } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { rollbackRows } from "./screens/rollback.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "./fakes.test-helper.js";

const ID = "com.example.tweak";

function setup(t, { env = {}, mode = "jailbreak", helper } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env, ...(helper ? { helper } : {}) });
  const queue = createQueue();
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode, queue } });
  const store = join(fx.prefix, "var/cache/ifizbox/rollback", ID);
  const put = (spelled, control) => writeFileSync(join(store, `${ID}_${spelled}_iphoneos-arm64.deb`), control);
  return { fx, native, backend, queue, store, put };
}

const control = (version, pkg = ID) => `Package: ${pkg}\nVersion: ${version}\nArchitecture: iphoneos-arm64\nName: Example Tweak\n`;

test("rollbacks: the stored copies, newest first, epochs spelled as apt's cache does", async (t) => {
  const { backend, native, put, store } = setup(t);
  put("1%3a0.5", control("1:0.5"));
  put("1.1", control("1.1"));
  writeFileSync(join(store, "README"), ""); // not a stored .deb's name: not listed
  writeFileSync(join(store, `${ID}_1.2_iphoneos-arm64.deb.part`), "");
  const list = await backend.rollbacks(ID);
  assert.deepEqual(native.calls.at(-1).params.words, ["rollbacks", ID]);
  assert.deepEqual(list.map((r) => r.version), ["1:0.5", "1.1", "0.9"]);
  assert.equal(list[0].file, `${ID}_1%3a0.5_iphoneos-arm64.deb`);
  assert.deepEqual(await backend.rollbacks("com.example.held"), []); // nothing stored
  assert.deepEqual(await backend.rollbacks("Bad Name"), []); // refused: still just nothing to offer
});

test("rollbacks: no helper, or the sideload build, offers nothing", async (t) => {
  const { backend } = setup(t, { helper: "/nonexistent/ifizbox-helper" });
  assert.deepEqual(await backend.rollbacks(ID), []);
  const side = setup(t, { mode: "sideload" }).backend;
  assert.equal(typeof side.rollbacks, "undefined");
  assert.equal(typeof side.rollback, "undefined");
});

test("rollback: installs the stored copy over the installed version, streaming like apply", async (t) => {
  const { backend, native, fx, queue } = setup(t, { env: { FAKE_FINISH: "restart" } });
  queue.add({ op: "install", id: "bash", version: null }); // whatever is queued is not touched by a rollback
  const events = [];
  const r = await backend.rollback(ID, "0.9", (e) => events.push(e));
  assert.equal(r.code, 0);
  assert.deepEqual(native.calls.at(-1).params, { words: ["rollback", ID, "0.9"], stream: true });
  assert.match(r.stdout, /Unpacking com\.example\.tweak \(0\.9\) over \(1\.0\) \.\.\./);
  assert.ok(events.some((e) => e.fd === "status" && e.line === `pmstatus:${ID}:100:Installed ${ID}`));
  assert.ok(events.some((e) => e.fd === "status" && e.line === "finish:restart"));
  const status = readFileSync(join(fx.prefix, "var/lib/dpkg/status"), "utf8");
  const stanza = status.split("\n\n").find((s) => s.startsWith(`Package: ${ID}\n`));
  assert.match(stanza, /^Status: install ok installed$/m);
  assert.match(stanza, /^Version: 0\.9$/m);
  assert.equal(status.split("\n\n").filter((s) => s.startsWith(`Package: ${ID}\n`)).length, 1);
  assert.ok(queue.get("bash"));
});

test("rollback: a version that isn't stored, a control that doesn't match, or a bad word is an error", async (t) => {
  const { backend, put, store } = setup(t);
  put("0.8", control("0.8", "com.example.evil"));
  put("0.7", control("0.6"));
  mkdirSync(join(store, "..", "com.example.link"));
  symlinkSync(join(store, `${ID}_0.9_iphoneos-arm64.deb`), join(store, "..", "com.example.link", "com.example.link_0.9_iphoneos-arm64.deb"));
  const cases = [
    [ID, "2.0", /ifizbox-helper rollback failed \(64\): ifizbox-helper: no stored \.deb of that version/],
    [ID, "0.8", /control isn't that package and version/],
    [ID, "0.7", /control isn't that package and version/],
    [ID, "--force-all", /bad version/],
    ["com.example.link", "0.9", /no stored \.deb/], // a link is never taken
  ];
  for (const [id, v, re] of cases) {
    await assert.rejects(backend.rollback(id, v), (e) => e.code === "helper" && re.test(e.message), `${id} ${v}`);
  }
  rmSync(store, { recursive: true });
  await assert.rejects(backend.rollback(ID, "0.9"), /no stored \.deb/);
});

test("rollback: apt failing comes back as its exit code, not an error (the console says it)", async (t) => {
  const { backend } = setup(t, { env: { FAKE_FAIL: "rollback" } });
  const r = await backend.rollback(ID, "0.9");
  assert.equal(r.code, 100);
  assert.match(r.stderr, /dpkg returned an error code/);
});

test("parseRollbacks and the page's rows", () => {
  const list = parseRollbacks("0.9 a_0.9_arm64.deb\n1:0.1 a_1%3a0.1_arm64.deb\njunk\n0.9 a_0.9_all.deb\n1.0 a_1.0_arm64.deb\n -x y.deb\n");
  assert.deepEqual(list.map((r) => r.version), ["1:0.1", "1.0", "0.9"]);
  assert.equal(list[2].file, "a_0.9_arm64.deb", "the first file of a version wins");
  assert.deepEqual(rollbackRows(list, "1.0"), [{ version: "1:0.1", detail: "Newer" }, { version: "0.9", detail: "Older" }]);
  assert.deepEqual(rollbackRows(list, null).map((r) => r.detail), ["", "", ""]);
  assert.deepEqual(rollbackRows([{ version: "1.0", file: "x.deb" }], "1.0"), [], "only the installed copy: no group");
});
