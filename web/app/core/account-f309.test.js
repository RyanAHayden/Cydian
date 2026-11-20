// F309: repo sign-ins in the iFizBox Account: the payload merge (add, last write wins, a sign-out travels, an older
// payload reads as none), the token only inside the sealed payload, the credential store's adopt/decline/drop, a
// synced token a repo turns down, and two devices end to end over Settings > Account's collect/apply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePayload, mergeLogins, summarize, changesFor, changedSince, differs, seal, unseal, deriveAccount, loginPrint,
  createAccountSync, keyLink, parseKey } from "./account.js";
import { createCredentialStore, createPaymentClient, CREDENTIAL_PREFIX } from "./payment.js";
import { collectHere, applyHere } from "../screens/account.js";
import { memStorage } from "../fakes.test-helper.js";
import { account as serve, rateLimiter } from "../../../worker/src/account.js";

const CHARIZ = "https://chariz.com/api/sileo/";
const HAVOC = "https://havoc.app/api/sileo/";
const base = (extra = {}) => ({ sources: [], settings: {}, holds: [], wishlist: [], apps: [], ...extra });
const KEY = Uint8Array.from({ length: 16 }, (_, i) => 200 - i);

test("merge: a sign-in is added; an older payload without the field reads as none and gains it", () => {
  const first = mergePayload(base({ repoLogins: { [CHARIZ]: { token: "tok-a" } } }), null, null, 100);
  assert.deepEqual(first.repoLogins, { [CHARIZ]: { token: "tok-a", at: 100 } });
  // a payload written before repo sign-ins: nothing in it, nothing for this device to apply or drop
  const old = { v: 1, ...base(), stamps: {}, savedAt: 1 };
  assert.ok(!("repoLogins" in summarize(old)));
  assert.equal(changesFor(base(), old).empty, true);
  assert.equal(changesFor(base(), old).adoptLogins, undefined);
  assert.ok(!("repoLogins" in mergePayload(base(), old, summarize(old), 5)), "left out while empty");
  // a device with a sign-in meets it: the sign-in goes up (even against a "seen" without the field)
  const up = mergePayload(base({ repoLogins: { [CHARIZ]: { token: "tok-a" } } }), old, summarize(old), 200);
  assert.deepEqual(up.repoLogins, { [CHARIZ]: { token: "tok-a", at: 200 } });
  assert.ok(differs(up, old));
  // a summary keeps a fingerprint, never the token
  assert.ok(!JSON.stringify(summarize(up)).includes("tok-a"));
  assert.equal(summarize(up).repoLogins[CHARIZ], loginPrint("tok-a"));
});

test("merge: per repo, the account's sign-in lands on another device; a sign-out travels; last write wins", () => {
  const acct = mergePayload(base({ repoLogins: { [CHARIZ]: { token: "tok-a" }, [HAVOC]: { token: "tok-h" } } }), null, null, 100);
  // device B, never synced, nothing of its own: takes both
  const b = base();
  const toB = mergePayload(b, acct, null, 150);
  const cb = changesFor(b, toB);
  assert.deepEqual(cb.adoptLogins, [{ base: CHARIZ, token: "tok-a" }, { base: HAVOC, token: "tok-h" }]);
  assert.equal(cb.empty, false);
  // device A signs out of Chariz since its last sync: a sign-out (token null) goes up, Havoc stays
  const seenA = summarize(acct);
  const aOut = base({ repoLogins: { [HAVOC]: { token: "tok-h" } } });
  assert.equal(changedSince(aOut, seenA), true);
  const afterOut = mergePayload(aOut, acct, seenA, 300);
  assert.deepEqual(afterOut.repoLogins, { [CHARIZ]: { token: null, at: 300 }, [HAVOC]: { token: "tok-h", at: 100 } });
  // B, holding Chariz from the account, gets the sign-out
  const bHas = base({ repoLogins: { [CHARIZ]: { token: "tok-a" }, [HAVOC]: { token: "tok-h" } } });
  const toB2 = mergePayload(bHas, afterOut, summarize(acct), 400);
  const cb2 = changesFor(bHas, toB2);
  assert.deepEqual(cb2.dropLogins, [CHARIZ]);
  assert.equal(cb2.adoptLogins, undefined);
  // B signs in to Chariz again later: its new token wins over the older sign-out
  const bNew = base({ repoLogins: { [CHARIZ]: { token: "tok-b" }, [HAVOC]: { token: "tok-h" } } });
  const back = mergePayload(bNew, afterOut, summarize(afterOut), 500);
  assert.deepEqual(back.repoLogins[CHARIZ], { token: "tok-b", at: 500 });
  // a change of this device's own loses to an account entry stamped later (another device's newer write)
  const newer = { ...afterOut, repoLogins: { ...afterOut.repoLogins, [CHARIZ]: { token: "tok-c", at: 900 } } };
  assert.deepEqual(mergePayload(bNew, newer, summarize(afterOut), 500).repoLogins[CHARIZ], { token: "tok-c", at: 900 });
  // nothing changed here: the account's entry stands, tombstones included
  assert.deepEqual(mergeLogins({ [HAVOC]: { token: "tok-h" } }, afterOut.repoLogins, summarize(afterOut), 600), afterOut.repoLogins);
});

test("the token travels only inside the sealed payload", async () => {
  const { key } = await deriveAccount(KEY);
  const merged = mergePayload(base({ repoLogins: { [CHARIZ]: { token: "chariz-token-0123456789" } } }), null, null, 7);
  const sealed = await seal(key, merged);
  assert.ok(!Buffer.from(sealed).toString("latin1").includes("chariz-token"), "no token in the ciphertext");
  assert.ok(!Buffer.from(sealed).toString("latin1").includes("chariz.com"), "nor the repo");
  assert.deepEqual((await unseal(key, sealed)).repoLogins, { [CHARIZ]: { token: "chariz-token-0123456789", at: 7 } });
  // no payment secret goes in: collectHere sends tokens only
  const storage = memStorage();
  const keychain = new Map();
  const secure = { get: async (k) => keychain.get(k) ?? null, set: async (k, v) => { keychain.set(k, v); }, remove: async (k) => { keychain.delete(k); } };
  await createCredentialStore({ storage, secure }).save(CHARIZ, { token: "t1", secret: "s3cret" });
  const plain = createCredentialStore({ storage });
  await plain.save(HAVOC, { token: "t2", secret: "also-s3cret" }); // the website's store keeps the secret beside the token
  const p = await collectHere(fakeHere(plain));
  assert.deepEqual(p.repoLogins, { [CHARIZ]: { token: "t1" }, [HAVOC]: { token: "t2" } });
  assert.ok(!JSON.stringify(p).includes("s3cret"));
});

test("credential store: adopt keeps this device's own sign-in, decline reads as signed out but still reports", async () => {
  const storage = memStorage({ unrelated: "x", [CREDENTIAL_PREFIX + "not a url"]: JSON.stringify({ token: "junk" }) });
  const keychain = new Map();
  const secure = { get: async (k) => keychain.get(k) ?? null, set: async (k, v) => { keychain.set(k, v); }, remove: async (k) => { keychain.delete(k); } };
  const s = createCredentialStore({ storage, secure });
  assert.deepEqual(s.logins(), {});
  assert.equal(await s.adopt(CHARIZ, "from-account"), true);
  assert.deepEqual(await s.load(CHARIZ), { token: "from-account", secret: null, synced: true });
  assert.deepEqual(s.logins(), { [CHARIZ]: "from-account" });
  // signed in here: own token and secret; the account's token doesn't replace it
  await s.save(HAVOC, { token: "mine", secret: "sec" });
  assert.equal(await s.adopt(HAVOC, "theirs"), false);
  assert.deepEqual(await s.load(HAVOC), { token: "mine", secret: "sec" });
  // declined: signed out here, still reported (so the account doesn't read a sign-out), not adopted again
  await s.decline(CHARIZ);
  assert.equal(await s.load(CHARIZ), null);
  assert.deepEqual(s.logins(), { [CHARIZ]: "from-account", [HAVOC]: "mine" });
  assert.equal(await s.adopt(CHARIZ, "from-account"), false);
  // a different token from the account (a new sign-in elsewhere) is taken
  assert.equal(await s.adopt(CHARIZ, "newer"), true);
  assert.equal((await s.load(CHARIZ)).token, "newer");
  // a sign-out from elsewhere drops it, own token included
  await s.drop(HAVOC);
  assert.equal(await s.load(HAVOC), null);
  assert.equal(keychain.has(CREDENTIAL_PREFIX + HAVOC), false);
});

test("a synced token the repo turns down: dropped on this device, Sign In shows, no error loop", async () => {
  const storage = memStorage();
  const credentials = createCredentialStore({ storage });
  const calls = [];
  // the vendor ties tokens to the UDID they signed in on: this device's UDID gets 401 for the synced token
  const request = async ({ url, body }) => {
    calls.push(url);
    const b = body ? JSON.parse(body) : {};
    if (url.endsWith("/info") && url.includes("/package/")) return { status: 200, json: { price: "$1", purchased: b.token === "own", available: true } };
    if (b.token && b.token !== "own") return { status: 401, json: { error: "Unknown token" } };
    return { status: 200, json: { items: [], user: {} } };
  };
  const client = createPaymentClient({ base: CHARIZ, request, credentials, device: () => ({ udid: "U2", model: "iPhone15,2" }) });
  await credentials.adopt(CHARIZ, "synced");
  assert.equal(await client.signedIn(), true);
  await assert.rejects(client.userInfo(), (e) => e.invalidate === true);
  assert.equal(await client.signedIn(), false, "Sign In shows");
  assert.deepEqual(credentials.logins(), { [CHARIZ]: "synced" }, "the account keeps it");
  await assert.rejects(client.userInfo(), /sign in first/, "signed out now: no call goes to the vendor");
  assert.equal(calls.length, 1);
  // an own token's 401 without invalidate is just an error (as before)
  await credentials.save(CHARIZ, { token: "bad-own", secret: "s" });
  await assert.rejects(client.userInfo(), (e) => e.invalidate === false);
  assert.equal(await client.signedIn(), true);
});

test("buying with a sign-in the account brought asks for Sign In again (the payment secret never travels)", async () => {
  const credentials = createCredentialStore({ storage: memStorage() });
  const request = async () => { throw new Error("no call should be made"); };
  const client = createPaymentClient({ base: HAVOC, request, credentials, device: () => ({ udid: "U", model: "M" }) });
  await credentials.adopt(HAVOC, "synced");
  await assert.rejects(client.purchase("com.paid.tweak"), (e) => e.invalidate === true && /Sign in again/.test(e.message));
  assert.equal(await client.signedIn(), false);
  await client.finishSignIn("sileo://authentication_success?token=own&payment_secret=sec");
  assert.deepEqual(await credentials.load(HAVOC), { token: "own", secret: "sec" });
});

// ---- two devices end to end: Settings > Account's collect/apply, the real Worker code over a fake fetch -----------

function fakeHere(logins) {
  const backend = { sources: async () => [], addSource: async () => {}, removeSource: async () => {} };
  const store = { isShown: () => false, get: () => undefined, set: () => {}, holds: { list: () => [], set: () => {} } };
  const db = { all: async () => [] };
  const wishes = { list: () => [], set: () => {} };
  return { backend, store, appStore: async () => db, mode: "jailbreak", wishes, logins };
}

function fakeServer() {
  const kv = new Map();
  const env = { HOSTED: {
    put: async (k, v, o) => kv.set(k, { v, m: o?.metadata ?? null }),
    getWithMetadata: async (k) => ({ value: kv.get(k)?.v ?? null, metadata: kv.get(k)?.m ?? null }),
    delete: async (k) => { kv.delete(k); } } };
  const limit = rateLimiter({ rate: 1e6, writes: 1e6 });
  return { kv, fetcher: async (url, init = {}) => serve(new Request("https://ifizbox.example" + url, { ...init, cache: undefined }), env, { limit }) };
}

function device(server) {
  let key = null, saved = null;
  const logins = createCredentialStore({ storage: memStorage() });
  const here = fakeHere(logins);
  const acct = createAccountSync({
    keys: { get: async () => key, set: async (k) => { key = k; }, remove: async () => { key = null; } },
    state: { get: () => (saved ? JSON.parse(saved) : null), set: (v) => { saved = v ? JSON.stringify(v) : null; } },
    collect: () => collectHere(here), apply: (c) => applyHere(c, here), fetcher: server.fetcher,
  });
  return { acct, logins };
}

test("two devices: a Chariz sign-in reaches the other, a decline there stays there, a sign-out travels", async () => {
  const server = fakeServer();
  const a = device(server), b = device(server);
  await a.logins.save(CHARIZ, { token: "tok-a", secret: "sec-a" });
  const code = await a.acct.create();
  await b.acct.signIn(keyLink(parseKey(code)));
  assert.deepEqual(await b.logins.load(CHARIZ), { token: "tok-a", secret: null, synced: true }, "B is signed in to Chariz");
  assert.equal(await b.acct.save(), false, "nothing new to write");
  // Chariz turns the token down on B: B shows Sign In, saves nothing, A stays signed in
  await b.logins.decline(CHARIZ);
  assert.equal(await b.acct.save(), false, "a decline is not a sign-out");
  await b.acct.sync();
  assert.equal(await b.logins.load(CHARIZ), null, "not brought back");
  await a.acct.sync();
  assert.equal((await a.logins.load(CHARIZ)).token, "tok-a");
  // B signs in itself: its token goes up; A keeps its own sign-in, and doesn't write it back
  await b.logins.save(CHARIZ, { token: "tok-b", secret: "sec-b" });
  assert.equal(await b.acct.save(), true);
  await a.acct.sync();
  assert.deepEqual(await a.logins.load(CHARIZ), { token: "tok-a", secret: "sec-a" });
  assert.equal(await a.acct.save(), false, "A's own token counts as seen");
  // A signs out of Chariz: the sign-out reaches B
  await a.logins.forget(CHARIZ);
  assert.equal(await a.acct.save(), true);
  await b.acct.sync();
  assert.equal(await b.logins.load(CHARIZ), null);
  assert.deepEqual(b.logins.logins(), {});
  assert.equal(await b.acct.save(), false);
});
