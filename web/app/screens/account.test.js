// F97: Settings > Account's wiring (screens/account.js): what this device sends and how the account's changes land,
// with fake backends; the key store's fallback for an older shell; ifizbox://account links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectHere, applyHere, keyStore, sourceLine, lastSyncedText, SIGN_OUT_ALERT, signOutFlow } from "./account.js";
import { changesFor, identityOf, createAccountSync } from "../core/account.js";
import { NAME } from "../brand.js";
import { handleIncoming } from "../incoming.js";
import { memoryAppStore } from "../core/installed.js";
import { createWishlist } from "../core/wishlist.js";

function fakes() {
  const srcs = [{ key: "a", uri: "https://a.example/" }, { key: "b", uri: "https://b.example" }];
  const backend = {
    sources: async () => srcs,
    addSource: async (line) => { if (line.includes("bad")) throw new Error("offline"); srcs.push({ key: line, uri: line }); },
    removeSource: async (key) => { srcs.splice(srcs.findIndex((s) => s.key === key), 1); },
  };
  const vals = { appearance: "dark", allowZoom: true, device: "none", worksOnMyPhone: false, compatMarks: true, iosVersion: "17.0" };
  let holds = ["tweak.one"];
  const store = {
    isShown: (k) => k !== "iosVersion", get: (k) => vals[k], set: (k, v) => { vals[k] = v; },
    holds: { list: () => [...holds], set: async (p, on) => { holds = on ? [...holds, p] : holds.filter((x) => x !== p); } },
  };
  const db = memoryAppStore([{ id: "com.ex.app", name: "App", version: "1.0", date: 5 }, { id: "com.ryha.ifizbox", self: true, version: "9" }]);
  const wishes = createWishlist({ storage: null });
  wishes.set("tweak.wish", true);
  return { srcs, backend, store, vals, holds: () => holds, db, appStore: async () => db, wishes };
}

test("collect: sources as one line each, the settings that travel, holds, apps (not iFizBox itself), the certificate", async () => {
  const f = fakes();
  const cert = { p12: new Uint8Array([1, 2]), profile: new Uint8Array([3]), password: "pw", p12Name: "me.p12" };
  const p = await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "site", load: async () => cert });
  assert.deepEqual(p.sources, ["https://a.example/", "https://b.example/"]);
  assert.equal(p.settings.appearance, "dark");
  assert.ok(!("iosVersion" in p.settings), "a setting this mode hides stays out");
  assert.deepEqual(p.holds, ["tweak.one"]);
  assert.deepEqual((await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "jailbreak", wishes: f.wishes })).wishlist, ["tweak.wish"]);
  assert.deepEqual(p.apps.map((r) => r.id), ["com.ex.app"]);
  assert.deepEqual(p.identity, identityOf(cert));
  assert.equal((await collectHere({ syncCert: false, backend: f.backend, store: f.store, appStore: f.appStore, mode: "site", load: async () => cert })).identity, null);
  const jb = await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "jailbreak" });
  assert.ok(!("identity" in jb), "the jailbreak app leaves the certificate alone");
  // the sideload app: signing.export's base64 into base64url
  const native = { call: async (m) => (m === "signing.export" ? { p12: "+/8=", profile: "AQ==", password: "x" } : null) };
  const sl = await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "sideload", native, load: async () => ({ p12Name: "n.p12" }) });
  assert.deepEqual(sl.identity, { p12: "-_8", profile: "AQ", password: "x", p12Name: "n.p12", profileName: "" });
});

test("apply: sources, settings, holds, apps and the certificate land; failures don't stop the rest", async () => {
  const f = fakes();
  const local = await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "jailbreak" });
  const merged = { ...local, sources: ["https://a.example/", "https://bad.example/", "https://c.example/"], holds: ["tweak.two"],
    settings: { ...local.settings, appearance: "light" }, apps: [{ id: "com.ex.app", name: "App", version: "2.0", date: 9 }, { id: "com.ex.new", name: "New", version: "1", date: 3 }] };
  const local2 = await collectHere({ backend: f.backend, store: f.store, appStore: f.appStore, mode: "jailbreak", wishes: f.wishes });
  await applyHere(changesFor(local2, { ...merged, wishlist: ["tweak.other"] }), { backend: f.backend, store: f.store, appStore: f.appStore, mode: "jailbreak", wishes: f.wishes });
  assert.deepEqual(f.wishes.list(), ["tweak.other"], "the Wish List lands beside the holds");
  assert.deepEqual(f.srcs.map((s) => s.uri), ["https://a.example/", "https://c.example/"]);
  assert.equal(f.vals.appearance, "light");
  assert.deepEqual(f.holds(), ["tweak.two"]);
  const recs = await f.db.all();
  assert.equal(recs.find((r) => r.id === "com.ex.app").version, "2.0");
  assert.equal(recs.find((r) => r.id === "com.ex.app").date, 9, "the record's own date, not now");
  assert.ok(recs.some((r) => r.id === "com.ex.new"));
  // the sideload app takes a certificate through signing.import
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return {}; } };
  const id = identityOf({ p12: new Uint8Array([255, 1]), profile: new Uint8Array([2]), password: "pw" });
  await applyHere({ ...changesFor(local, local), identity: id }, { backend: f.backend, store: f.store, appStore: f.appStore, mode: "sideload", native });
  assert.deepEqual(calls, [["signing.import", { p12: "/wE=", profile: "Ag==", password: "pw" }]]);
});

test("the key store: the Keychain through account.key.*; a real Keychain error is not taken for an older shell", async () => {
  const kept = {};
  const native = { call: async (m, p) => {
    if (m === "account.key.get") return kept.key ?? null;
    if (m === "account.key.set") { kept.key = p.key; return true; }
    if (m === "account.key.remove") { delete kept.key; return true; }
    throw new Error("unknown method " + m);
  } };
  const ks = keyStore(native);
  assert.equal(await ks.get(), null);
  await ks.set("ABCD");
  assert.equal(await ks.get(), "ABCD");
  await ks.remove();
  assert.equal(await ks.get(), null);
  const refused = keyStore({ call: async () => { throw new Error("keychain: the Keychain refused (-25308)"); } });
  await assert.rejects(refused.get(), /refused/, "a real Keychain error isn't swallowed into IndexedDB");
});

test("helpers: one line per source, Last Synced", () => {
  assert.equal(sourceLine("https://a.example"), "https://a.example/");
  assert.equal(sourceLine("https://a.example/apps.json"), "https://a.example/apps.json", "a file stays a file");
  assert.equal(sourceLine("deb https://a.example/ stable main"), "deb https://a.example/ stable main");
  assert.equal(lastSyncedText(null), "Never");
  assert.equal(lastSyncedText(1000, 1000 + 5 * 60000), "5 min ago");
});

test("ifizbox://account?k= goes to Sign In With Key", async () => {
  const got = [];
  assert.equal(await handleIncoming("ifizbox://account?k=0123456789ABCDEFGHJKMNPQRS", { signIn: async (u) => got.push(u) }), "account");
  assert.deepEqual(got, ["ifizbox://account?k=0123456789ABCDEFGHJKMNPQRS"]);
});

// F286: Sign Out writes unsaved changes, then forgets the key; the account stays on the server.
function signedInDevice() {
  const calls = [];
  let stored = null, version = 0, key = null, saved = null;
  const here = { sources: ["https://a.example/"], settings: {}, holds: [], wishlist: [], apps: [] };
  const api = () => ({
    get: async () => { calls.push("get"); return stored ? { version, data: stored } : null; },
    put: async (data) => { calls.push("put"); stored = data; return ++version; },
    remove: async () => { calls.push("remove"); stored = null; },
  });
  const acct = createAccountSync({
    keys: { get: async () => key, set: async (k) => { key = k; }, remove: async () => { calls.push("key.remove"); key = null; } },
    state: { get: () => (saved ? JSON.parse(saved) : null), set: (v) => { saved = v ? JSON.stringify(v) : null; } },
    collect: async () => JSON.parse(JSON.stringify(here)), apply: async () => {}, api,
  });
  return { acct, here, calls, server: () => stored, state: () => saved };
}

test("Sign Out: unsaved changes written first, then the key forgotten; no delete reaches the server", async () => {
  const d = signedInDevice();
  await d.acct.create();
  d.calls.length = 0;
  d.here.holds.push("tweak.new");
  assert.equal(await d.acct.signOut(), true, "the unsaved change was written");
  assert.ok(d.calls.includes("put"));
  assert.ok(!d.calls.includes("remove"), "the account isn't deleted");
  assert.equal(d.calls.at(-1), "key.remove");
  assert.ok(d.server(), "the account is still on the server");
  assert.equal(d.state(), null, "sync state cleared");
  assert.equal((await d.acct.status()).signedIn, false);

  // nothing changed: no write; offline: still signs out
  const e = signedInDevice();
  await e.acct.create();
  e.calls.length = 0;
  assert.equal(await e.acct.signOut(), false);
  assert.deepEqual(e.calls, ["key.remove"]);
  const f = signedInDevice();
  await f.acct.create();
  f.here.sources.push("https://b.example/");
  const off = createAccountSync({ keys: { get: async () => (await f.acct.status()).code, set: async () => {}, remove: async () => f.calls.push("key.remove") },
    state: { get: () => null, set: () => {} }, collect: async () => f.here, apply: async () => {},
    api: () => ({ get: async () => { throw new Error("offline"); }, put: async () => {}, remove: async () => { f.calls.push("remove"); } }) });
  f.calls.length = 0;
  assert.equal(await off.signOut(), false);
  assert.deepEqual(f.calls, ["key.remove"]);
});

test("Sign Out's alert: what stops, what stays, the key to come back; Cancel does nothing", async () => {
  assert.equal(SIGN_OUT_ALERT.title, "Sign Out?");
  assert.deepEqual(SIGN_OUT_ALERT.buttons, ["Cancel", "Sign Out"]);
  assert.match(SIGN_OUT_ALERT.message, new RegExp(`stops syncing with your ${NAME} Account`));
  assert.match(SIGN_OUT_ALERT.message, /What's on it stays/);
  assert.match(SIGN_OUT_ALERT.message, /account key/);
  assert.ok(!/delete/i.test(SIGN_OUT_ALERT.message));
  let out = 0, drawn = 0, asked = null;
  const acct = { signOut: async () => { out++; return true; }, remove: async () => { throw new Error("no delete on sign out"); } };
  const hud = () => Object.assign(() => {}, { done: () => {} });
  const el = {};
  assert.equal(await signOutFlow(el, { acct, hud, ask: async (o) => { asked = o; return { index: 0 }; }, draw: async () => { drawn++; } }), false);
  assert.equal(out + drawn, 0, "Cancel");
  assert.equal(asked.title, "Sign Out?");
  assert.equal(await signOutFlow(el, { acct, hud, ask: async () => ({ index: 1 }), draw: async () => { drawn++; } }), true);
  assert.equal(out, 1);
  assert.equal(drawn, 1, "the page redraws (signed out: Create Account / Sign In With Key)");
});
