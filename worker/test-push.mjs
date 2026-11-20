// F280: push notifications (src/push.js) against Node's SQLite with D1's API and a fake APNs that checks the provider
// token's signature, the topic, the host and the payload. tools/check.sh runs it with the other worker/test*.mjs.
import assert from "node:assert/strict";
import w from "./src/index.js";
import { push, runPushCheck, parseRegistration, offers, updatesFor, expiringFor, alertFor, keepNotified, pushConfig,
  runs, resetPushCache, APNS_PROD, APNS_DEV, EXPIRY_WARN, SELF_ID } from "./src/push.js";
import { rateLimiter } from "./src/account.js";
import { d1 } from "./src/d1-sqlite.js";
import { NAME } from "../web/app/brand.js";

const subtle = crypto.subtle;
const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const unb64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const TOKEN_A = "a".repeat(64), TOKEN_B = "b1".repeat(32), TOKEN_DEAD = "d".repeat(64);
const SRC = "https://apps.example/source.json", SELF_SRC = "https://ifizbox.example/repo/source.json";
const sources = {
  [SRC]: { apps: [
    { name: "Velvet", bundleIdentifier: "com.example.velvet", versions: [{ version: "2.0", minOSVersion: "17.0" }, { version: "1.5" }] },
    { name: "Ember", bundleIdentifier: "com.example.ember", version: "3.1" },
    { name: "Same", bundleIdentifier: "com.example.same", versions: [{ version: "1.0" }] },
  ] },
  [SELF_SRC]: { apps: [{ name: NAME, bundleIdentifier: SELF_ID, versions: [{ version: "9.9" }] }] },
};

// The fake APNs: records each push, answers 410 for TOKEN_DEAD, and checks the JWT against the public key.
const sent = [];
const fetcher = async (url, init = {}) => {
  url = String(url);
  if (sources[url]) return new Response(JSON.stringify(sources[url]), { headers: { "Content-Type": "application/json" } });
  const m = /^(https:\/\/[^/]+)\/3\/device\/([0-9a-f]+)$/.exec(url);
  if (!m) return new Response("nope", { status: 404 });
  const h = init.headers;
  const [head, body, sig] = h.authorization.replace(/^bearer /, "").split(".");
  assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, unb64(sig), new TextEncoder().encode(`${head}.${body}`)), "JWT signed with the key");
  assert.deepEqual(JSON.parse(unb64(head)), { alg: "ES256", kid: "KEY1234567" });
  assert.equal(JSON.parse(unb64(body)).iss, "S8NFX3A2LT");
  sent.push({ host: m[1], token: m[2], topic: h["apns-topic"], type: h["apns-push-type"], payload: JSON.parse(init.body) });
  if (m[2] === TOKEN_DEAD) return new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 });
  return new Response(null, { status: 200 });
};

const db = d1(":memory:");
const env = { PUSH: db, APNS_KEY: pem, APNS_KEY_ID: "KEY1234567", APNS_TEAM_ID: "S8NFX3A2LT" };
const call = (path, body, { e = env, method = "POST", now = 1_000_000, limit = rateLimiter({ rate: 1000, writes: 1000 }) } = {}) =>
  push(new Request("https://ifizbox.example" + path, { method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) }), e, { fetcher, now, limit, testLimit });
const testLimit = rateLimiter({ rate: 3, writes: 3 });

// config: no database, no key, then on
assert.deepEqual(pushConfig({}), { enabled: false, reason: "no_database", topics: [SELF_ID] });
assert.equal(pushConfig({ PUSH: db }).reason, "no_key");
assert.equal(pushConfig(env).enabled, true);
assert.deepEqual(pushConfig({ ...env, APNS_TOPICS: "a.b, c.d" }).topics, ["a.b", "c.d"]);
let r = await call("/api/push", undefined, { method: "GET", e: {} });
assert.deepEqual(await r.json(), { enabled: false, reason: "no_database", topics: [SELF_ID] });
assert.equal((await call("/api/push/register", { token: TOKEN_A }, { e: {} })).status, 503);
assert.equal((await call("/api/push/nope", {})).status, 404);
assert.equal((await call("/api/push/register", undefined, { method: "GET" })).status, 405);
// routed by the Worker itself
r = await w.fetch(new Request("https://ifizbox.example/api/push"), {});
assert.equal((await r.json()).enabled, false);

// registration rules
assert.equal(parseRegistration({ token: "xyz", environment: "production", topic: SELF_ID }).ok, false);
assert.equal(parseRegistration({ token: TOKEN_A, environment: "sandbox", topic: SELF_ID }).ok, false);
let p = parseRegistration({ token: TOKEN_A, environment: "production", topic: "com.you.ifizbox" });
assert.equal(p.code, "wrong_topic", "a copy renamed by its signer can't be reached with this key");
p = parseRegistration({ token: TOKEN_A.toUpperCase(), environment: "development", topic: SELF_ID, team: "ABCDE12345",
  apps: [{ id: "a", version: "1", source: "ftp://x" }, { id: "b", version: "1", source: SRC }, { id: "", version: "1", source: SRC }],
  expires: [{ id: SELF_ID, name: NAME, at: "2026-11-20T00:00:00Z" }, { id: "x", at: "never" }] });
assert.equal(p.device.token, TOKEN_A);
assert.deepEqual(p.device.apps, [{ id: "b", name: "b", version: "1", source: SRC }]);
assert.deepEqual(p.device.expires, [{ id: SELF_ID, name: NAME, at: "2026-11-20T00:00:00.000Z" }]);
assert.equal(p.device.team, "ABCDE12345", "any team: APNs goes by topic, not by who signed the copy");

// what a source offers
assert.ok(runs("17.0", null, "17.1") && !runs("17.0", null, "16.7") && runs(null, "16", "16.7.2") && !runs(null, "16", "17.0"));
assert.deepEqual(offers(sources[SRC], "16.7")["com.example.velvet"], { name: "Velvet", version: "1.5" }, "the newest that runs here");
assert.deepEqual(offers(JSON.stringify(sources[SRC]), "17.2")["com.example.velvet"].version, "2.0");
assert.equal(offers(sources[SRC])["com.example.ember"].version, "3.1", "AltStore 1.x: the version on the app");
assert.deepEqual(offers("not json"), {});

const dev = { apps: [
  { id: "com.example.velvet", name: "Velvet", version: "1.0", source: SRC },
  { id: "com.example.ember", name: "Ember", version: "3.1", source: SRC },
  { id: "com.example.same", name: "Same", version: "1.0", source: SRC },
], known: [], notified: [] };
const by = { [SRC]: offers(sources[SRC], "17.2") };
assert.deepEqual(updatesFor(dev, by).map((u) => u.key), ["com.example.velvet 2.0"]);
assert.deepEqual(updatesFor({ ...dev, known: ["com.example.velvet 2.0"] }, by), [], "already on screen");
assert.deepEqual(updatesFor({ ...dev, notified: ["com.example.velvet 2.0"] }, by), [], "pushed before");
assert.deepEqual(updatesFor(dev, {}), [], "a source that failed tells nothing");
assert.deepEqual(keepNotified(["com.example.velvet 2.0", "com.example.ember 3.1", "gone.app 2", "expires x 2026-01-01T00:00:00.000Z"], dev),
  ["com.example.velvet 2.0"], "installed, or no longer followed: forgotten");

// the alerts
assert.deepEqual(alertFor([{ id: SELF_ID, name: NAME, version: "9.9" }], []).title, `${NAME} 9.9`);
let a = alertFor([{ id: "x", name: "Velvet", version: "2.0" }, { id: SELF_ID, name: NAME, version: "9.9" }], []);
assert.deepEqual([a.title, a.body, a.url], ["2 Updates", `${NAME} 9.9 and Velvet 2.0`, "#/changes"]);
const now = Date.parse("2026-11-19T12:00:00Z");
const soon = [{ id: SELF_ID, name: NAME, at: new Date(now + 5 * 3600000).toISOString() }];
assert.equal(expiringFor({ expires: soon }, now).length, 1);
assert.equal(expiringFor({ expires: [{ id: "a", name: "A", at: new Date(now + EXPIRY_WARN + 60000).toISOString() }] }, now).length, 0);
assert.equal(expiringFor({ expires: soon, notified: [`expires ${SELF_ID} ${soon[0].at}`] }, now).length, 0, "warned once");
a = alertFor([], expiringFor({ expires: soon }, now), now);
assert.ok(a.body.startsWith(`${NAME}'s signature expires in 5 hours. Re-sign it`), a.body);
assert.equal(alertFor([], []), null);

// register, status, test push, unregister
const reg = { token: TOKEN_A, environment: "production", topic: SELF_ID, team: "S8NFX3A2LT", version: "1.0", ios: "17.2",
  apps: [...dev.apps, { id: SELF_ID, name: NAME, version: "1.0", source: SELF_SRC }], known: [], expires: [] };
r = await call("/api/push/register", reg);
assert.deepEqual(await r.json(), { ok: true, enabled: true, reason: null });
assert.equal((await call("/api/push/register", { ...reg, topic: "com.you.ifizbox" })).status, 400);
assert.deepEqual(await (await call("/api/push/status", { token: TOKEN_A })).json(),
  { registered: true, lastPush: null, lastStatus: null, enabled: true, reason: null });
assert.equal((await (await call("/api/push/status", { token: TOKEN_B })).json()).registered, false);
assert.equal((await call("/api/push/test", { token: TOKEN_B })).status, 404);
resetPushCache();
r = await call("/api/push/test", { token: TOKEN_A });
assert.deepEqual(await r.json(), { ok: true, status: 200, reason: null, registered: true });
assert.deepEqual([sent.at(-1).host, sent.at(-1).topic, sent.at(-1).type, sent.at(-1).payload.aps.alert.title], [APNS_PROD, SELF_ID, "alert", "Test Push"]);
assert.equal((await (await call("/api/push/status", { token: TOKEN_A })).json()).lastPush, new Date(1_000_000).toISOString());
assert.equal((await call("/api/push/test", { token: TOKEN_A }, { e: { PUSH: db } })).status, 503, "no key: no test push");
for (let i = 0; i < 2; i++) await call("/api/push/test", { token: TOKEN_A });
assert.equal((await call("/api/push/test", { token: TOKEN_A })).status, 429, "three a minute");

// the scheduled run: one push for both updates, none the next time, development host for a development profile
await call("/api/push/register", { ...reg, token: TOKEN_B, environment: "development", ios: "16.0", known: ["com.example.velvet 1.5"] });
await call("/api/push/register", { ...reg, token: TOKEN_DEAD });
sent.length = 0;
let c = await runPushCheck(env, { fetcher, now });
assert.deepEqual([c.devices, c.sources, c.pushed, c.gone], [3, 2, 2, 1]);
const toA = sent.find((s) => s.token === TOKEN_A), toB = sent.find((s) => s.token === TOKEN_B);
assert.deepEqual([toA.host, toA.payload.aps.alert.title, toA.payload.aps.alert.body, toA.payload.url],
  [APNS_PROD, "2 Updates", `${NAME} 9.9 and Velvet 2.0`, "#/changes"]);
assert.deepEqual([toB.host, toB.payload.aps.alert.title], [APNS_DEV, `${NAME} 9.9`], "Velvet 1.5 (iOS 16) is already on its screen");
assert.equal((await (await call("/api/push/status", { token: TOKEN_DEAD })).json()).registered, false, "APNs said gone: forgotten");
sent.length = 0;
c = await runPushCheck(env, { fetcher, now: now + 1800000 });
assert.deepEqual([c.devices, c.pushed, sent.length], [2, 0, 0], "each update pushed once");
// re-registering keeps that, and a newer version pushes again
await call("/api/push/register", reg);
sources[SRC].apps[1].version = "3.2";
c = await runPushCheck(env, { fetcher, now: now + 3600000 });
assert.equal(sent.find((s) => s.token === TOKEN_A).payload.aps.alert.body, "Ember 3.2");
// the expiry warning
sent.length = 0;
await call("/api/push/register", { ...reg, expires: soon });
await runPushCheck(env, { fetcher, now });
assert.equal(sent.find((s) => s.token === TOKEN_A).payload.aps.alert.title, "Signature Expiring");
// gone on unregister, and no key: the run does nothing
assert.deepEqual(await (await call("/api/push/unregister", { token: TOKEN_A })).json(), { ok: true });
assert.equal((await (await call("/api/push/status", { token: TOKEN_A })).json()).registered, false);
assert.deepEqual((await runPushCheck({ PUSH: db }, { fetcher })).enabled, false);
// the scheduled handler logs counts only, never a token
const logs = [];
const log = console.log;
console.log = (...x) => logs.push(x.join(" "));
try { await w.scheduled({}, { ...env, APNS_HOST: "https://apns.example" }, {}); } finally { console.log = log; }
assert.ok(logs.length === 1 && !logs[0].includes(TOKEN_B) && /^push: /.test(logs[0]), logs.join("\n"));
console.log("worker push: ok");
