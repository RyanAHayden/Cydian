// F97: iFizBox Account's core: the key, encryption, merge rules, and the controller against a fake cydian.dev.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newKey, keyCode, parseKey, keyLink, deriveAccount, seal, unseal, accountApi, mergePayload, summarize, changesFor,
  createAccountSync, identityPrint, identityOf, identityFiles, differs, changedSince } from "./account.js";
import { account as serve, rateLimiter } from "../../../worker/src/account.js";

const KEY = Uint8Array.from({ length: 16 }, (_, i) => i * 17);

test("the key: code and link round-trip, typos forgiven, junk refused", () => {
  const code = keyCode(KEY);
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){6}$/);
  assert.equal(code.replace(/-/g, "").length, 26);
  assert.deepEqual(parseKey(code), KEY);
  assert.deepEqual(parseKey(code.toLowerCase().replace(/-/g, " ")), KEY);
  assert.deepEqual(parseKey(keyLink(KEY)), KEY);
  assert.deepEqual(parseKey(`Open ${keyLink(KEY)} on the other phone`), KEY);
  assert.deepEqual(parseKey(code.replace(/0/g, "O").replace(/1/g, "l")), KEY);
  assert.equal(parseKey(code.slice(0, -1)), null);
  assert.equal(parseKey("hello"), null);
  assert.equal(parseKey(code.slice(0, -1).replace(/-/g, "") + "Z"), null); // padding bits set
  for (let i = 0; i < 50; i++) { const k = newKey(); assert.deepEqual(parseKey(keyCode(k)), k); }
});

test("the id doesn't reveal the key, and differs per key", async () => {
  const a = await deriveAccount(KEY), b = await deriveAccount(newKey());
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.notEqual(a.id, b.id);
  assert.equal((await deriveAccount(KEY)).id, a.id);
  const raw = Buffer.from(KEY).toString("hex");
  assert.ok(!a.id.includes(raw) && !a.id.includes(keyCode(KEY, { groups: false }).toLowerCase()));
  assert.equal(a.key.extractable, false);
});

test("encrypt and decrypt round-trip; another key can't open it", async () => {
  const { key } = await deriveAccount(KEY);
  const p = { v: 1, sources: ["https://repo.example/"], settings: { appearance: "dark" }, holds: [], apps: [], identity: { p12: "AAEC", profile: "AwQ", password: "pw" } };
  const box = await seal(key, p);
  assert.ok(!Buffer.from(box).toString("latin1").includes("repo.example"), "ciphertext only");
  assert.deepEqual(await unseal(key, box), p);
  assert.notDeepEqual(await seal(key, p), box, "a fresh IV each time");
  const other = (await deriveAccount(newKey())).key;
  await assert.rejects(unseal(other, box), { code: "bad_key" });
  await assert.rejects(unseal(key, await seal(key, { v: 2 })), { code: "too_new" });
});

const base = () => ({ sources: ["a", "b"], settings: { appearance: "light", allowZoom: false }, holds: ["p1"], apps: [{ id: "x", version: "1", date: 1 }] });

test("merge: sets three ways (adds and removals both travel), settings last-write-wins", () => {
  const seen = summarize(base());
  const remote = { ...base(), sources: ["a", "b", "c"], holds: [], settings: { appearance: "dark", allowZoom: false }, stamps: { "settings.appearance": 50 } };
  const local = { ...base(), sources: ["a", "d"], settings: { appearance: "light", allowZoom: true } };
  const m = mergePayload(local, remote, seen, 100);
  assert.deepEqual(m.sources, ["a", "c", "d"]); // b removed here, c added there, d added here
  assert.deepEqual(m.holds, []); // removed there
  assert.deepEqual(m.settings, { appearance: "dark", allowZoom: true }); // each side's change
  assert.equal(m.stamps["settings.allowZoom"], 100);
  assert.equal(m.stamps["settings.appearance"], 50);
  // a device that never synced only adds, and takes the account's settings
  const fresh = mergePayload({ sources: ["z"], settings: { appearance: "light", device: "none" }, holds: [], apps: [] }, remote, null, 100);
  assert.deepEqual(fresh.sources, ["a", "b", "c", "z"]);
  assert.deepEqual(fresh.settings, { appearance: "dark", allowZoom: false, device: "none" });
  // no account yet: this device's things, all stamped
  const first = mergePayload(local, null, null, 7);
  assert.deepEqual(first.sources, local.sources);
  assert.equal(first.stamps["settings.appearance"], 7);
});

test("merge: apps by id, the changed side or the newer record; the certificate", () => {
  const seen = summarize(base());
  const remote = { ...base(), apps: [{ id: "x", version: "2", date: 5 }, { id: "y", version: "1", date: 4 }] };
  const local = { ...base(), apps: [{ id: "z", version: "1", date: 6 }] }; // removed x here (unchanged there? no: changed there)
  const m = mergePayload(local, remote, seen, 100);
  assert.deepEqual(m.apps.map((r) => r.id), ["y", "z"]); // x removed here wins over the other's upgrade: a removal travels
  const fresh = mergePayload({ ...base(), apps: [{ id: "x", version: "3", date: 9 }] }, remote, null, 100);
  assert.equal(fresh.apps.find((r) => r.id === "x").version, "3"); // newer record
  // certificate: changed here wins; unchanged here takes the account's; turned off (null) travels as a removal
  const cert = { p12: "AA", profile: "BB", password: "" }, cert2 = { p12: "CC", profile: "DD", password: "x" };
  const seenC = summarize({ ...base(), identity: cert });
  assert.deepEqual(mergePayload({ ...base(), identity: cert2 }, { ...base(), identity: cert }, seenC, 1).identity, cert2);
  assert.deepEqual(mergePayload({ ...base(), identity: cert }, { ...base(), identity: cert2 }, seenC, 1).identity, cert2);
  assert.equal(mergePayload({ ...base(), identity: null }, { ...base(), identity: cert }, seenC, 1).identity, null);
  assert.deepEqual(mergePayload({ ...base() }, { ...base(), identity: cert }, seenC, 1).identity, cert, "a build without certificates passes it on");
  assert.equal(identityPrint(cert), identityPrint({ ...cert }));
  assert.notEqual(identityPrint(cert), identityPrint(cert2));
  assert.ok(!identityPrint(cert).includes("AA"));
});

test("changesFor: what applying the merge does here; a certificate is never removed", () => {
  const local = { ...base(), identity: { p12: "AA", profile: "BB" } };
  const merged = { ...base(), sources: ["a", "c"], holds: ["p1", "p2"], settings: { appearance: "dark", allowZoom: false }, identity: null,
    apps: [{ id: "x", version: "2", date: 3 }] };
  const c = changesFor(local, merged);
  assert.deepEqual(c.addSources, ["c"]);
  assert.deepEqual(c.removeSources, ["b"]);
  assert.deepEqual(c.addHolds, ["p2"]);
  assert.deepEqual(c.settings, { appearance: "dark" });
  assert.equal(c.identity, null);
  assert.deepEqual(c.putApps.map((r) => r.version), ["2"]);
  assert.equal(c.empty, false);
  assert.ok(changesFor(base(), { ...base() }).empty);
  const cert = { p12: "CC", profile: "DD" };
  assert.deepEqual(changesFor(local, { ...local, identity: cert }).identity, cert);
  assert.equal(changesFor(local, { ...local, identity: cert }, { syncCert: false }).identity, null);
  assert.ok(differs(merged, local) && !differs(local, { ...local, stamps: { x: 1 }, savedAt: 9 }));
  assert.ok(!changedSince(local, JSON.parse(JSON.stringify(summarize(local)))), "seen survives localStorage");
});

test("identityOf / identityFiles: the certificate's files through the payload", () => {
  const id = identityOf({ p12: new Uint8Array([1, 2, 250]), profile: new Uint8Array([3]), password: "pw", p12Name: "a.p12" });
  assert.deepEqual(identityFiles(id).p12, new Uint8Array([1, 2, 250]));
  assert.equal(identityOf({ p12: new Uint8Array([1]) }), null);
});

// ---- the controller, on two devices, against the real Worker code over a fake fetch ----------------------------

function fakeServer() {
  const kv = new Map();
  const env = { HOSTED: {
    put: async (k, v, o) => kv.set(k, { v, m: o?.metadata ?? null }),
    getWithMetadata: async (k) => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m ?? null }),
    delete: async (k) => { kv.delete(k); } } };
  const limit = rateLimiter({ rate: 1e6, writes: 1e6 });
  let puts = 0, beforePut = null;
  const fetcher = async (url, init = {}) => {
    if (init.method === "PUT") { puts++; if (beforePut) { const f = beforePut; beforePut = null; await f(); } }
    return serve(new Request("https://cydian.example" + url, { ...init, cache: undefined }), env, { limit });
  };
  return { kv, fetcher, get puts() { return puts; }, onNextPut(f) { beforePut = f; } };
}

function device(server, initial) {
  let key = null, saved = null;
  const here = { sources: [...initial.sources], settings: { ...initial.settings }, holds: [...initial.holds], wishlist: [...(initial.wishlist ?? [])],
    apps: [...(initial.apps ?? [])],
    identity: initial.identity };
  const acct = createAccountSync({
    keys: { get: async () => key, set: async (k) => { key = k; }, remove: async () => { key = null; } },
    state: { get: () => (saved ? JSON.parse(saved) : null), set: (v) => { saved = v ? JSON.stringify(v) : null; } },
    collect: async ({ syncCert }) => JSON.parse(JSON.stringify({ ...here, identity: here.identity === undefined ? undefined : syncCert ? here.identity : null })),
    apply: async (c) => {
      here.sources = [...here.sources.filter((s) => !c.removeSources.includes(s)), ...c.addSources];
      here.holds = [...here.holds.filter((s) => !c.removeHolds.includes(s)), ...c.addHolds];
      here.wishlist = [...here.wishlist.filter((s) => !c.removeWishes.includes(s)), ...c.addWishes];
      Object.assign(here.settings, c.settings);
      if (c.identity) here.identity = c.identity;
      here.apps = [...here.apps.filter((r) => !c.removeApps.includes(r.id) && !c.putApps.some((p) => p.id === r.id)), ...c.putApps];
    },
    fetcher: server.fetcher,
  });
  return { acct, here };
}

test("two devices: create, sign in (a read), batched saves, a 409 merged, delete", async () => {
  const server = fakeServer();
  const cert = { p12: "AAEC", profile: "AwQ", password: "pw", p12Name: "me.p12", profileName: "me.mobileprovision" };
  const a = device(server, { sources: ["https://a.example/"], settings: { appearance: "dark" }, holds: ["tweak.one"], identity: cert });
  const code = await a.acct.create();
  assert.equal(server.puts, 1);
  assert.equal(server.kv.size, 1);
  assert.ok(![...server.kv.values()][0].m || !JSON.stringify([...server.kv.values()][0]).includes("a.example"));

  const b = device(server, { sources: ["https://b.example/"], settings: { appearance: "light" }, holds: [], identity: null });
  await b.acct.signIn(keyLink(parseKey(code)));
  assert.equal(server.puts, 1, "signing in is a read");
  assert.deepEqual(b.here.sources.sort(), ["https://a.example/", "https://b.example/"]);
  assert.equal(b.here.settings.appearance, "dark");
  assert.deepEqual(b.here.identity, cert);
  assert.equal((await b.acct.status()).signedIn, true);
  // b had a source the account lacks: written at its next save, once; a second save with nothing new writes nothing
  assert.equal(await b.acct.save(), true);
  assert.equal(server.puts, 2);
  assert.equal(await b.acct.save(), false);
  assert.equal(server.puts, 2);
  // a's save with nothing changed does nothing; then a change of a's own
  assert.equal(await a.acct.save(), false);
  a.here.holds.push("tweak.two");
  // ...and b writes in between (after a read, before a's write): a gets 409, reads again, merges, writes
  server.onNextPut(async () => { b.here.settings.allowZoom = true; await b.acct.save(); });
  assert.equal(await a.acct.save(), true);
  assert.deepEqual(a.here.holds.sort(), ["tweak.one", "tweak.two"]);
  assert.equal(a.here.settings.allowZoom, true, "b's change merged in");
  await b.acct.sync({ write: false });
  assert.deepEqual(b.here.holds.sort(), ["tweak.one", "tweak.two"]);
  // a removal travels
  a.here.sources = a.here.sources.filter((s) => s !== "https://a.example/");
  await a.acct.save();
  await b.acct.sync();
  assert.deepEqual(b.here.sources, ["https://b.example/"]);
  // the Wish List (F102) travels beside the holds: an add, then a removal
  a.here.wishlist.push("tweak.wish");
  await a.acct.save();
  await b.acct.sync();
  assert.deepEqual(b.here.wishlist, ["tweak.wish"]);
  b.here.wishlist = [];
  await b.acct.save();
  await a.acct.sync();
  assert.deepEqual(a.here.wishlist, []);
  // a wrong key, a missing account
  const c = device(server, { sources: [], settings: {}, holds: [] });
  await assert.rejects(c.acct.signIn("nonsense"), { code: "bad_key" });
  await assert.rejects(c.acct.signIn(keyCode(newKey())), { code: "not_found" });
  assert.equal((await c.acct.status()).signedIn, false);
  // delete: gone here, and the other device hears so
  await a.acct.remove();
  assert.equal(server.kv.size, 0);
  assert.equal((await a.acct.status()).signedIn, false);
  await assert.rejects(b.acct.sync(), { code: "gone" });
});

test("Sync Certificate off: the certificate leaves the account and isn't taken back in", async () => {
  const server = fakeServer();
  const cert = { p12: "AAEC", profile: "AwQ", password: "" };
  const a = device(server, { sources: [], settings: {}, holds: [], identity: cert });
  const code = await a.acct.create();
  const b = device(server, { sources: [], settings: {}, holds: [], identity: null });
  await b.acct.signIn(code);
  assert.deepEqual(b.here.identity, cert);
  a.acct.setSyncCert(false);
  assert.equal(await a.acct.save(), true);
  const { key, id } = await deriveAccount(parseKey(code));
  const got = await accountApi({ id, fetcher: server.fetcher }).get();
  assert.equal((await unseal(key, got.data)).identity, null);
  assert.deepEqual(a.here.identity, cert, "still on the device");
  await b.acct.sync();
  assert.deepEqual(b.here.identity, cert, "never removed from a device");
  assert.equal(await b.acct.save(), false, "b doesn't put it back");
});

test("accountApi: errors say what happened", async () => {
  const api = accountApi({ id: "ab".repeat(32), fetcher: async () => { throw new TypeError("Load failed"); } });
  await assert.rejects(api.get(), { code: "network" });
  const busy = accountApi({ id: "ab".repeat(32), fetcher: async () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }) });
  await assert.rejects(busy.put(new Uint8Array(40), 1), { code: "rate_limited", message: "Too many requests." });
});

test("merge: the Wish List is a set like the holds; a payload from before it reads as empty", () => {
  const seen = summarize({ ...base(), wishlist: ["w1", "w2"] });
  const remote = { ...base(), wishlist: ["w1", "w2", "w3"], stamps: {} };
  const local = { ...base(), wishlist: ["w2", "w4"] };
  assert.deepEqual(mergePayload(local, remote, seen, 100).wishlist, ["w2", "w3", "w4"]); // w1 removed here, w3 there, w4 here
  const old = { ...base(), stamps: {} }; // an account written before the Wish List synced
  assert.deepEqual(mergePayload(local, old, summarize(old), 100).wishlist, ["w2", "w4"]);
  assert.deepEqual(mergePayload(local, null, null, 100).wishlist, ["w2", "w4"]);
  const c = changesFor(local, { ...local, wishlist: ["w4", "w5"] });
  assert.deepEqual([c.addWishes, c.removeWishes, c.empty], [["w5"], ["w2"], false]);
  assert.ok(changesFor(local, { ...local }).empty);
  assert.ok(changedSince(local, summarize({ ...local, wishlist: ["w2"] })), "a wish added is a change to save");
});
