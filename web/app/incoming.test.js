// F75: the native URL hand-off (incoming.js): app.takeURL at start and on "ifizbox:url", each link to its handler;
// Open in iFizBox App's review (screens/importlink.js reviewAndImport) adds only what's new; F89: the website's
// Open in iFizBox (ifizbox://install) asks, then installs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIncoming, startIncoming } from "./incoming.js";
import { reviewAndImport, reviewText, websitePayload } from "./screens/importlink.js";
import { installAsk } from "./incoming.js";
import { encodeLink } from "./core/transfer.js";

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
  assert.equal(await handleIncoming("https://ifizbox.com/", u.deps), null);
  assert.equal(await handleIncoming("ifizbox://elsewhere", u.deps), null);
  assert.deepEqual([u.alerts.length, u.huds.length, u.went], [0, 0, 0]);
});

test("F89 install: the website's Open in iFizBox asks, then installs the IPA with its name", async () => {
  const u = ui();
  const ran = [];
  const opened = [];
  const link = "ifizbox://install?url=" + encodeURIComponent("https://e.example/My App.ipa") + "&name=My%20App";
  assert.equal(await handleIncoming(link, { ...u.deps, install: async (o) => ran.push(o), open: (h) => opened.push(h) }), "install");
  assert.deepEqual(opened, ["#/installed/myipas"]);
  assert.equal(u.alerts[0].title, "Install IPA");
  assert.match(u.alerts[0].message, /^My App\nhttps:\/\/e\.example\/My App\.ipa$/);
  assert.deepEqual(ran, [{ url: "https://e.example/My App.ipa", name: "My App" }]);
  u.answer = 0; // Cancel
  await handleIncoming(link, { ...u.deps, install: async (o) => ran.push(o), open: () => {} });
  assert.equal(ran.length, 1);
});

test("F89 install: a link without an http(s) IPA does nothing", async () => {
  const u = ui();
  for (const bad of ["ifizbox://install", "ifizbox://install?url=javascript:alert(1)", "ifizbox://install?url=file:///x.ipa"]) {
    assert.equal(installAsk(bad), null, bad);
    assert.equal(await handleIncoming(bad, { ...u.deps, install: async () => assert.fail("installed"), open: () => {} }), "install");
  }
  assert.equal(u.alerts.length, 0);
  assert.deepEqual(installAsk("ifizbox://install?url=https%3A%2F%2Fa.example%2Fb.ipa"), { url: "https://a.example/b.ipa", name: "" });
});

test("startIncoming takes the pending link at start and again on ifizbox:url", async () => {
  const queue = ["ifizbox://nothing-of-ours", null];
  const calls = [];
  const native = { async call(m) { calls.push(m); return queue.length ? (queue[0] ? { url: queue.shift() } : (queue.shift(), null)) : null; } };
  const listeners = {};
  const saved = globalThis.addEventListener;
  globalThis.addEventListener = (t, f) => { listeners[t] = f; };
  try {
    startIncoming({ native });
    await new Promise((r) => setTimeout(r, 10));
    const urls = () => calls.filter((m) => m === "app.takeURL");
    assert.deepEqual(urls(), ["app.takeURL", "app.takeURL"]); // one link, then none left
    assert.ok(calls.includes("app.takeOpenLog")); // B166: the hand-off trail, after the links
    assert.equal(typeof listeners["ifizbox:url"], "function");
    assert.equal(typeof listeners["ifizbox:openlog"], "function");
    await listeners["ifizbox:url"]();
    assert.equal(urls().length, 3);
  } finally { globalThis.addEventListener = saved; }
  startIncoming({ native: null }); // the website: nothing to listen to
});

// ---- Open in iFizBox App ----

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

test("the website's payload: every source as its export line, the travelling settings it shows, holds; no server, no certificate when none is saved", async () => {
  const backend = fakeBackend([{ key: "deb:https://a.example/:./", uri: "https://a.example/", dist: "./" },
    { key: "deb:https://apt.procurs.us/:1900", uri: "https://apt.procurs.us/", dist: "1900", components: ["main"] }, { key: "x" }]);
  const store = fakeStore({ appearance: "dark", device: "none", worksOnMyPhone: true }, ["com.x.tweak"]);
  const p = await websitePayload({ backend, store });
  assert.deepEqual(p.sources, ["https://a.example/", "deb https://apt.procurs.us/ 1900 main"]);
  assert.deepEqual(p.settings, { appearance: "dark", device: "none", worksOnMyPhone: true });
  assert.deepEqual(p.holds, ["com.x.tweak"]);
  assert.equal("p12" in p || "password" in p || "identity" in p || "server" in p, false);
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
  assert.equal(await reviewAndImport("ifizbox://import?d=AAAA", { native: null, backend, store, ...u.deps }), "bad");
});

test("review text: five names at most", () => {
  const sources = Array.from({ length: 7 }, (_, i) => ({ uri: `https://r${i}.example/` }));
  assert.equal(reviewText({ sources, settings: [], holds: [] }),
    "7 new sources: r0.example, r1.example, r2.example, r3.example, r4.example and 2 more.");
});

test("F93: the website's certificate travels with Send Settings and goes into the Keychain", async () => {
  const id = { p12: new Uint8Array([0x30, 1, 2]), profile: new Uint8Array([3, 4]), password: "pw", p12Name: "me.p12", profileName: "Me" };
  const p = await websitePayload({ backend: fakeBackend(), store: fakeStore({}), load: async () => id });
  assert.deepEqual(p.identity, { p12: "MAEC", profile: "AwQ", password: "pw", p12Name: "me.p12", profileName: "Me" });
  assert.equal("identity" in await websitePayload({ backend: fakeBackend(), store: fakeStore({}), load: async () => id, identity: false }), false);
  const calls = [];
  const native = { call: async (m, params) => { calls.push([m, params]); return {}; } };
  const u = ui();
  assert.equal(await reviewAndImport(await encodeLink(p), { native, backend: fakeBackend(), store: fakeStore({}), ...u.deps }), "imported");
  assert.deepEqual(calls, [["signing.import", { p12: "MAEC", profile: "AwQ=", password: "pw" }]]);
});

test("Send Settings' import without a certificate never touches the Keychain", async () => {
  const backend = fakeBackend();
  const store = fakeStore({ appearance: "light" });
  const u = ui();
  const calls = [];
  const native = { call: async (m) => { calls.push(m); return { text: "" }; } };
  const url = await encodeLink({ sources: ["https://n.example/"] });
  assert.equal(await reviewAndImport(url, { native, backend, store, ...u.deps }), "imported");
  assert.equal(calls.includes("signing.import"), false);
  assert.equal(await handleIncoming("ifizbox://import?d=AAAA", { ...u.deps, review: async () => "bad" }), "import");
});

test("B14 a tab's link opens that tab, cold or warm", async () => {
  const { tabOf } = await import("./incoming.js");
  const opened = [];
  const u = ui();
  for (const t of ["sources", "Changes", "home", "installed", "search", "settings"]) {
    assert.equal(await handleIncoming(`ifizbox://${t}`, { ...u.deps, open: (h) => opened.push(h) }), "tab");
  }
  assert.deepEqual(opened, ["#/sources", "#/changes", "#/home", "#/installed", "#/search", "#/settings"]);
  assert.equal(tabOf("ifizbox://sources/"), "sources");
  assert.equal(tabOf("ifizbox://sources/x"), null);
  assert.equal(tabOf("ifizbox://elsewhere"), null);
  assert.equal(tabOf("https://sources"), null);
});
