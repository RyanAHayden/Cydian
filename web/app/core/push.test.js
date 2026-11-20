// F280: core/push.js, with a fake shell and a fake server.
import test from "node:test";
import assert from "node:assert/strict";
import { memStorage as memory } from "../test-fakes.js";
import { offReason, registration, expiresOf, enablePush, disablePush, syncPush, pushInfo, pushRows, pushState,
  storedWatch, RENAMED_TEXT, NO_APS_TEXT, DENIED_TEXT, PUSH_KEY } from "./push.js";
import { BUNDLE_ID, NAME } from "../brand.js";

const TOKEN = "ab".repeat(32);
const ST = { mode: "sideload", bundleId: BUNDLE_ID, team: "ABCDE12345", environment: "production", authorization: "authorized",
  version: "1.2", ios: "17.2", profileExpires: "2027-01-01T00:00:00Z" };
const WATCH = { apps: [{ id: "com.x.app", name: "X", version: "1.0", source: "https://s.example/a.json", extra: 1 }], known: ["com.x.app 1.1"] };

function fakeNative({ st = ST, register = { token: TOKEN }, fail = null } = {}) {
  const calls = [];
  return { calls, call: async (name, params) => {
    calls.push(name);
    if (name === "push.status") return st;
    if (name === "push.register") { if (fail) throw Object.assign(new Error(fail), { code: fail }); return register; }
    return {};
  } };
}
function fakeServer({ info = { enabled: true, reason: null, topics: [BUNDLE_ID] }, refuse = false } = {}) {
  const posts = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/push") return Response.json(info);
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    if (refuse) return Response.json({ error: "No." }, { status: 400 });
    if (path === "/api/push/status") return Response.json({ registered: true, lastPush: "2026-11-19T11:50:00Z" });
    if (path === "/api/push/test") return Response.json({ ok: true, status: 200 });
    return Response.json({ ok: true });
  };
  return { posts, fetcher };
}
const server = "https://sign.example";

test("why push is off, in order", () => {
  assert.equal(offReason(null).code, "no_app");
  assert.equal(offReason({ ...ST, mode: "jailbreak" }).code, "jailbreak");
  const renamed = offReason({ ...ST, bundleId: "com.you.ifizbox" });
  assert.equal(renamed.code, "renamed");
  assert.equal(renamed.text, RENAMED_TEXT("com.you.ifizbox"));
  assert.match(renamed.text, /installs beside this one/);
  assert.equal(offReason({ ...ST, environment: null }).text, NO_APS_TEXT);
  assert.equal(offReason({ ...ST, authorization: "denied" }).text, DENIED_TEXT);
  assert.match(offReason(ST, { enabled: false, reason: "no_key" }, "https://my.worker.dev").text, /^my\.worker\.dev has no APNs key/);
  assert.equal(offReason(ST, { enabled: false, reason: "no_database" }, server).code, "no_database");
  assert.equal(offReason(ST, { enabled: true, topics: [BUNDLE_ID] }), null);
  assert.equal(offReason({ ...ST, bundleId: "com.me.box" }, { enabled: true, topics: ["com.me.box"] }), null, "a server set for another topic");
  assert.equal(offReason({ ...ST, team: "ZZZZZZZZZZ" }), null, "any signing team: APNs goes by the bundle ID");
});

test("the registration body", () => {
  const b = registration({ ...ST, token: TOKEN }, WATCH);
  assert.deepEqual(b, { token: TOKEN, environment: "production", topic: BUNDLE_ID, team: "ABCDE12345", version: "1.2", ios: "17.2",
    apps: [{ id: "com.x.app", name: "X", version: "1.0", source: "https://s.example/a.json" }], known: ["com.x.app 1.1"],
    expires: [{ id: BUNDLE_ID, name: NAME, at: "2027-01-01T00:00:00.000Z" }] });
  assert.deepEqual(expiresOf({}), []);
});

test("enable registers with the server; sync sends only changes; disable forgets", async () => {
  const storage = memory(), native = fakeNative(), srv = fakeServer();
  const r = await enablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(native.calls, ["push.status", "push.register"]);
  assert.equal(srv.posts[0].path, "/api/push/register");
  assert.equal(srv.posts[0].body.token, TOKEN);
  assert.equal(pushState(storage).on, true);
  assert.deepEqual(await syncPush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { sent: false }, "same list");
  const more = { ...WATCH, apps: [...WATCH.apps, { id: "com.y", name: "Y", version: "2", source: "https://s.example/a.json" }] };
  assert.deepEqual(await syncPush({ native, server, fetcher: srv.fetcher, storage, watch: more }), { sent: true });
  assert.equal(srv.posts.at(-1).body.apps.length, 2);
  assert.equal(storedWatch(storage).apps.length, 2, "remembered for the next Push on");
  await disablePush({ native, server, fetcher: srv.fetcher, storage });
  assert.deepEqual(srv.posts.at(-1), { path: "/api/push/unregister", body: { token: TOKEN } });
  assert.equal(native.calls.at(-1), "push.unregister");
  assert.deepEqual(pushState(storage), { on: false, token: null, sent: null, lastError: null });
  assert.deepEqual(await syncPush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { sent: false }, "off: nothing sent");
});

test("enable stops with a reason, and nothing reaches the server", async () => {
  for (const [native, srv, code] of [
    [fakeNative({ st: { ...ST, bundleId: "com.you.ifizbox" } }), fakeServer(), "renamed"],
    [fakeNative({ st: { ...ST, environment: null } }), fakeServer(), "no_aps"],
    [fakeNative({ fail: "denied" }), fakeServer(), "denied"],
    [fakeNative(), fakeServer({ info: { enabled: false, reason: "no_key", topics: [BUNDLE_ID] } }), "no_key"],
  ]) {
    const storage = memory();
    const r = await enablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH });
    assert.equal(r.reason.code, code);
    assert.equal(srv.posts.length, 0, code);
    assert.equal(pushState(storage).lastError, r.reason.text);
  }
  const storage = memory(), srv = fakeServer({ refuse: true });
  const r = await enablePush({ native: fakeNative(), server, fetcher: srv.fetcher, storage, watch: WATCH });
  assert.match(r.reason.text, /^sign\.example refused the push registration: No\./);
});

test("Settings' rows", async () => {
  const storage = memory(), native = fakeNative(), srv = fakeServer();
  let g = pushRows(await pushInfo({ native, server, fetcher: srv.fetcher, storage }));
  assert.deepEqual(g.rows, [{ label: "Push", toggle: true, on: false }]);
  assert.match(g.footer, /push token and the apps/);
  await enablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH });
  g = pushRows(await pushInfo({ native, server, fetcher: srv.fetcher, storage }), Date.parse("2026-11-19T12:00:00Z"));
  assert.deepEqual(g.rows.map((r) => [r.label, r.detail ?? null]), [["Push", null], ["Last Push", "10 min ago"]]);
  g = pushRows(await pushInfo({ native: fakeNative({ st: { ...ST, environment: null } }), server, fetcher: srv.fetcher, storage }));
  assert.equal(g, null, "push can't work: no switch, no explanation");
  storage.setItem(PUSH_KEY, "{bad");
  assert.equal(pushState(storage).on, false);
});

test("an update on a renamed copy: said once, Cancel stops it", async () => {
  const { renamedUpdateNotice } = await import("./push.js");
  const storage = memory();
  const asked = [];
  const alert = (answer) => async (spec) => { asked.push(spec.title); return { index: answer }; };
  const renamed = fakeNative({ st: { ...ST, bundleId: "com.you.ifizbox" } });
  assert.equal(await renamedUpdateNotice({ native: fakeNative(), alert: alert(1), storage }), "install", "own ID: nothing to say");
  assert.equal(asked.length, 0);
  assert.equal(await renamedUpdateNotice({ native: renamed, alert: alert(0), storage }), "cancel");
  assert.equal(await renamedUpdateNotice({ native: renamed, alert: alert(1), storage }), "install");
  assert.equal(await renamedUpdateNotice({ native: renamed, alert: alert(0), storage }), "install", "once");
  assert.deepEqual(asked, ["Installs Beside This One", "Installs Beside This One"]);
  const old = { call: async () => { throw new Error("unknown call push.status"); } };
  assert.equal(await renamedUpdateNotice({ native: old, alert: alert(0), storage: memory() }), "install", "an older shell");
});

// F285: on by default, once the server can push; never again after the user's Off; not while the server has no key.
test("Push turns itself on once the server can push, and never after an explicit Off", async () => {
  const { autoEnablePush, userTurnedOff, setUserTurnedOff, USER_OFF_KEY } = await import("./push.js");
  const store = () => { const m = memory(); m.removeItem = (k) => m.m.delete(k); return m; };
  // the server has no key yet: stays off, nothing asked of iOS beyond the status
  let storage = store(), native = fakeNative(), srv = fakeServer({ info: { enabled: false, reason: "no_key", topics: [BUNDLE_ID] } });
  assert.deepEqual(await autoEnablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: false });
  assert.equal(pushState(storage).on, false);
  assert.equal(pushState(storage).lastError, null, "no error left behind");
  assert.deepEqual(native.calls, ["push.status"]);
  // the key arrives (no app update): the next launch turns it on
  srv = fakeServer();
  assert.deepEqual(await autoEnablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: true });
  assert.equal(pushState(storage).on, true);
  assert.equal(srv.posts[0].path, "/api/push/register");
  // on already: nothing more
  assert.deepEqual(await autoEnablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: false });
  assert.equal(srv.posts.length, 1);
  // the user turns it off: remembered, never on again by itself
  setUserTurnedOff(true, storage);
  await disablePush({ native, server, fetcher: srv.fetcher, storage });
  assert.equal(storage.getItem(USER_OFF_KEY), "1");
  assert.equal(userTurnedOff(storage), true);
  assert.deepEqual(await autoEnablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: false });
  assert.equal(pushState(storage).on, false);
  setUserTurnedOff(false, storage);
  assert.equal(userTurnedOff(storage), false, "turned on again by hand clears it");
  // never asked: push.register shows iOS's prompt; Allow turns it on, Don't Allow leaves it off quietly
  storage = store(); srv = fakeServer();
  native = fakeNative({ st: { ...ST, authorization: "notDetermined" } });
  assert.deepEqual(await autoEnablePush({ native, server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: true });
  assert.deepEqual(native.calls, ["push.status", "push.status", "push.register"]);
  storage = store(); srv = fakeServer();
  const r0 = await autoEnablePush({ native: fakeNative({ st: { ...ST, authorization: "notDetermined" }, fail: "denied" }), server, fetcher: srv.fetcher, storage, watch: WATCH });
  assert.equal(r0.enabled, false);
  assert.deepEqual(pushState(storage), { on: false, token: null, sent: null, lastError: null });
  // something blocks it (no aps-environment, notifications denied, a renamed copy): stays off quietly
  for (const st of [{ ...ST, environment: null }, { ...ST, authorization: "denied" },
    { ...ST, bundleId: "com.you.ifizbox" }]) {
    storage = store(); srv = fakeServer();
    assert.deepEqual(await autoEnablePush({ native: fakeNative({ st }), server, fetcher: srv.fetcher, storage, watch: WATCH }), { enabled: false });
    assert.equal(srv.posts.length, 0);
    assert.equal(pushState(storage).on, false);
  }
  // iOS gives no token: left off with no error, tried again next launch
  storage = store(); srv = fakeServer();
  const r = await autoEnablePush({ native: fakeNative({ fail: "no token" }), server, fetcher: srv.fetcher, storage, watch: WATCH });
  assert.equal(r.enabled, false);
  assert.deepEqual(pushState(storage), { on: false, token: null, sent: null, lastError: null });
  // an older shell without push.status
  assert.deepEqual(await autoEnablePush({ native: { call: async () => { throw new Error("unknown"); } }, server, fetcher: srv.fetcher, storage: store() }), { enabled: false });
});
