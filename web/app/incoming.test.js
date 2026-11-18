// F75: the native URL hand-off (incoming.js): app.takeURL at start and on "cydian:url", each link to its handler;
// Import from Safari coming back lands in the Keychain and opens Settings > Signing; Open in Cydian App's review
// (screens/importlink.js reviewAndImport) adds only what's new.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming, startIncoming } from "./incoming.js";
import { reviewAndImport, reviewText, websitePayload } from "./screens/importlink.js";
import { encodeLink, newKey, sealIdentity, importUrl } from "./core/transfer.js";

function ui() {
  const u = { alerts: [], huds: [], went: 0, answer: 1 };
  u.deps = {
    alert: async (a) => { u.alerts.push(a); return { index: a.buttons.length > 1 ? u.answer : 0 }; },
    hud: (t) => { u.huds.push(t); const h = () => u.huds.push("hide"); h.done = (l) => u.huds.push(`done ${l}`); return h; },
    go: () => { u.went++; },
  };
  return u;
}

test("not ours: nothing happens", async () => {
  const u = ui();
  assert.equal(await handleIncoming("https://cydian.dev/", u.deps), null);
  assert.equal(await handleIncoming("cydian://elsewhere", u.deps), null);
  assert.deepEqual([u.alerts.length, u.huds.length, u.went], [0, 0, 0]);
});

test("signing-import: imported, a checkmark, then the walkthrough", async () => {
  const u = ui();
  let got = null;
  const r = await handleIncoming("cydian://signing-import#abc", { ...u.deps, finish: async (url) => { got = url; return { identity: { name: "Me" } }; } });
  assert.equal(r, "signing-import");
  assert.equal(got, "cydian://signing-import#abc");
  assert.deepEqual(u.huds, ["Importing", "done Imported"]);
  assert.equal(u.alerts.length, 0);
  assert.equal(u.went, 1);
});

test("signing-import: a failure says why, still opens the walkthrough", async () => {
  const u = ui();
  await handleIncoming("cydian://signing-import#abc", { ...u.deps, finish: async () => { throw new Error("Start again with Import from Safari in Settings > Signing."); } });
  assert.deepEqual(u.alerts.map((a) => [a.title, a.message]), [["Couldn't Import", "Start again with Import from Safari in Settings > Signing."]]);
  const coded = Object.assign(new Error("x"), { code: "wrong_password" });
  await handleIncoming("cydian://signing-import#abc", { ...u.deps, finish: async () => { throw coded; } });
  assert.equal(u.alerts[1].title, "Couldn't Import");
  await handleIncoming("cydian://signing-import#abc", { ...u.deps, finish: async () => ({ identity: null, identityProblem: "Keychain says no" }) });
  assert.equal(u.alerts[2].message, "Keychain says no");
  assert.equal(u.went, 3);
});

test("startIncoming takes the pending link at start and again on cydian:url", async () => {
  const queue = ["cydian://nothing-of-ours", null];
  const calls = [];
  const native = { async call(m) { calls.push(m); return queue.length ? (queue[0] ? { url: queue.shift() } : (queue.shift(), null)) : null; } };
  const listeners = {};
  const saved = globalThis.addEventListener;
  globalThis.addEventListener = (t, f) => { listeners[t] = f; };
  try {
    startIncoming({ native });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls, ["app.takeURL", "app.takeURL"]); // one link, then none left
    assert.equal(typeof listeners["cydian:url"], "function");
    await listeners["cydian:url"]();
    assert.equal(calls.length, 3);
  } finally { globalThis.addEventListener = saved; }
  startIncoming({ native: null }); // the website: nothing to listen to
});

// ---- Open in Cydian App ----

function fakeStore(values, holds = []) {
  const v = { ...values };
  const h = [...holds];
  return {
    v, h,
    isShown: (k) => k in v,
    get: (k) => v[k],
    set: (k, x) => { v[k] = x; },
    holds: { list: () => [...h], set: async (p, on) => { if (on && !h.includes(p)) h.push(p); } },
  };
}
function fakeBackend(list = []) {
  const added = [];
  return { added, sources: async () => list, addSource: async (input) => { if (String(input?.uri ?? input).includes("fail")) throw new Error("no Release"); added.push(input); } };
}

test("the website's payload: every source as its export line, the travelling settings it shows, holds, server", async () => {
  const backend = fakeBackend([{ key: "deb:https://a.example/:./", uri: "https://a.example/", dist: "./" },
    { key: "deb:https://apt.procurs.us/:1900", uri: "https://apt.procurs.us/", dist: "1900", components: ["main"] }, { key: "x" }]);
  const store = fakeStore({ appearance: "dark", device: "none", worksOnMyPhone: true }, ["com.x.tweak"]);
  const p = await websitePayload({ backend, store, server: "https://cydian.dev" });
  assert.deepEqual(p.sources, ["https://a.example/", "deb https://apt.procurs.us/ 1900 main"]);
  assert.deepEqual(p.settings, { appearance: "dark", device: "none", worksOnMyPhone: true });
  assert.deepEqual(p.holds, ["com.x.tweak"]);
  assert.equal("p12" in p || "password" in p, false);
});

test("review in the app: Import adds only the new, keeps the user's own, no duplicates", async () => {
  const url = await encodeLink({ sources: ["https://a.example/", "https://b.example/", "https://fail.example/"],
    settings: { appearance: "dark", worksOnMyPhone: true, device: "iphoneos-arm64" }, holds: ["one", "two"] });
  const backend = fakeBackend([{ key: "deb:https://a.example/:./" }]);
  const store = fakeStore({ appearance: "light", worksOnMyPhone: true }, ["two"]); // no Device in the app
  const u = ui();
  const banners = [];
  assert.equal(await reviewAndImport(url, { native: null, backend, store, ...u.deps, banner: (b) => banners.push(b) }), "imported"); // no question first
  assert.equal(backend.added.length, 1); // b; a was listed; fail failed and is reported
  assert.equal(u.alerts.length, 0); // no second popup: a failed source is a banner after the checkmark
  assert.match(banners[0].message, /fail\.example/);
  assert.equal(store.v.appearance, "dark");
  assert.equal("device" in store.v, false);
  assert.deepEqual(store.h, ["two", "one"]);
});

test("review in the app: nothing new says so; a broken link says so", async () => {
  const backend = fakeBackend();
  const store = fakeStore({ appearance: "light" });
  const u = ui();
  const same = await encodeLink({ settings: { appearance: "light" } });
  assert.equal(await reviewAndImport(same, { native: null, backend, store, ...u.deps }), "nothing");
  assert.equal(await reviewAndImport("cydian://import?d=AAAA", { native: null, backend, store, ...u.deps }), "bad");
});

test("review text: five names at most", () => {
  const sources = Array.from({ length: 7 }, (_, i) => ({ uri: `https://r${i}.example/` }));
  assert.equal(reviewText({ sources, settings: [], holds: [], server: { to: "https://mine.example" } }),
    "7 new sources: r0.example, r1.example, r2.example, r3.example, r4.example and 2 more.\nSigning Server: mine.example.");
});

test("the certificate never rides in cydian://import, only sealed in cydian://signing-import", async () => {
  const key = newKey();
  const sealed = importUrl(await sealIdentity({ p12: new Uint8Array([0x30, 1]), profile: new Uint8Array([2]), password: "hunter2" }, key));
  assert.equal(sealed.includes("hunter2"), false);
  const u = ui();
  assert.equal(await handleIncoming("cydian://import?d=AAAA", { ...u.deps, review: async () => "bad" }), "import");
});
