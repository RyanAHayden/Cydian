// F280: push notifications (APNs) for the sideload app, so an update alert arrives at once instead of whenever iOS
// lets the background check run (native/Sources/BackgroundCheck.swift). The app registers its device token and what
// it follows; a Cron Trigger (wrangler.toml [triggers]) checks those AltStore sources and pushes through APNs with
// token auth. Kept in D1 (binding PUSH, made by Wrangler on the first deploy; the tables make themselves).
//
//   GET    /api/push              {enabled, topics, reason}: whether this Worker can push (a key and the database)
//   POST   /api/push/register     {token, environment, topic, team, version, ios, apps: [{id, name, version, source}],
//                                 known: ["<id> <version>"], expires: [{id, name, at}]} -> {ok, enabled}
//                                 (again with a new list replaces it; `known` are the updates already on screen)
//   POST   /api/push/unregister   {token} -> {ok}: the device and everything kept for it are deleted
//   POST   /api/push/status       {token} -> {registered, lastPush, lastStatus, enabled}
//   POST   /api/push/test         {token} -> {ok, status, reason}: one push now ("Test Push" in Settings)
//
// Pushes (scheduled(): every 30 minutes): "n Updates" for app versions newer than the device's in its sources (the
// same rules as native/sign/Updates.swift: minOSVersion/maxOSVersion against `ios`, each "<id> <version>" once, never
// one in `known`), "<NAME> <version>" when iFizBox's own source has a newer iFizBox, and a signature about to expire
// (an `expires` entry within EXPIRY_WARN, once per date). A tap opens Changes (Notifications.swift's "url" route).
//
// APNs delivers by topic = the app's Info.plist bundle ID, whichever team signed the copy (a copy signed by Arctic
// Sign that kept com.ryha.ifizbox gets pushes too), as long as its profile has aps-environment; `environment` (the
// embedded profile's aps-environment) picks the APNs host. The key must come from the team that owns the topic's App
// ID (com.ryha.ifizbox on S8NFX3A2LT for ifizbox.com). Topics outside APNS_TOPICS (default brand.js BUNDLE_ID) are
// refused: this key can't reach them.
//
// Settings (wrangler.toml [vars] and secrets): APNS_KEY (secret: the AuthKey_<id>.p8, PEM), APNS_KEY_ID, APNS_TEAM_ID,
// APNS_TOPICS (comma separated), APNS_HOST (tests, or a relay: replaces both APNs hosts). Without the key or the
// database, push is off and the app keeps its local background check. Device tokens, watch lists and the key are
// never logged: the scheduled run logs counts only.
// SPDX-License-Identifier: GPL-3.0-or-later

import { rateLimiter } from "./account.js";
import { compareVersions } from "../../web/app/core/apt.js";
import { NAME, BUNDLE_ID, DOMAIN } from "../../web/app/brand.js";

export const SELF_ID = BUNDLE_ID;
export const MAX_APPS = 500, MAX_KNOWN = 1000, MAX_EXPIRES = 50, MAX_SOURCES_RUN = 200, MAX_DEVICES_RUN = 2000;
export const SOURCE_MAX_BYTES = 8 << 20, SOURCE_TIMEOUT = 15000;
export const EXPIRY_WARN = 2 * 86400 * 1000; // a signature ending within two days gets one push
export const APNS_PROD = "https://api.push.apple.com", APNS_DEV = "https://api.sandbox.push.apple.com";
const JWT_LIFE = 40 * 60 * 1000; // APNs wants a new token at most every 20 min and at least every 60

const TOKEN = /^[0-9a-fA-F]{64,200}$/;
const TEAM = /^[A-Z0-9]{10}$/;
const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type" };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS, ...extra } });
const fail = (code, error, status = 400) => json({ code, error }, status);

export const isPushPath = (pathname) => pathname === "/api/push" || pathname.startsWith("/api/push/");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_devices (token TEXT PRIMARY KEY, environment TEXT NOT NULL, topic TEXT NOT NULL,
    team TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '', ios TEXT NOT NULL DEFAULT '',
    apps TEXT NOT NULL DEFAULT '[]', known TEXT NOT NULL DEFAULT '[]', expires TEXT NOT NULL DEFAULT '[]',
    notified TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, updated INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
    last_push INTEGER, last_status TEXT)`,
  "CREATE INDEX IF NOT EXISTS push_devices_checked ON push_devices (checked)",
];
const ready = new WeakMap();
// B207: `counted` (JSON keys, NULL = same as `known`) came after the first tables were made: added where missing.
const COUNTED = "ALTER TABLE push_devices ADD COLUMN counted TEXT";
function schema(db) {
  if (!ready.has(db)) {
    ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s)))
      .then(() => db.prepare(COUNTED).run().catch(() => { /* already there */ }))
      .catch((e) => { ready.delete(db); throw e; }));
  }
  return ready.get(db);
}

// Whether this Worker can push: {enabled, reason, topics}. reason: "no_database" | "no_key" | null.
export function pushConfig(env = {}) {
  const topics = String(env.APNS_TOPICS || BUNDLE_ID).split(",").map((s) => s.trim()).filter(Boolean);
  if (!env.PUSH?.prepare) return { enabled: false, reason: "no_database", topics };
  if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return { enabled: false, reason: "no_key", topics };
  return { enabled: true, reason: null, topics };
}

const text = (v, max = 500) => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s && s.length <= max ? s : null;
};
const httpsUrl = (v) => {
  const s = text(v, 2000);
  if (!s) return null;
  try { const u = new URL(s); return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password ? u.href : null; } catch { return null; }
};

// A register body -> {ok: true, device} | {ok: false, error}. Unknown entries are dropped, not refused.
export function parseRegistration(b, topics = [BUNDLE_ID]) {
  if (!b || typeof b !== "object") return { ok: false, error: "Send JSON." };
  const token = typeof b.token === "string" && TOKEN.test(b.token) ? b.token.toLowerCase() : null;
  if (!token) return { ok: false, error: "That isn't a device token." };
  const environment = b.environment === "development" ? "development" : b.environment === "production" ? "production" : null;
  if (!environment) return { ok: false, error: "environment is production or development (the profile's aps-environment)." };
  const topic = typeof b.topic === "string" && BUNDLE.test(b.topic) ? b.topic : null;
  if (!topic) return { ok: false, error: "topic is the app's bundle ID." };
  if (!topics.includes(topic)) return { ok: false, code: "wrong_topic", error: `This server pushes only to ${topics.join(", ")}; this ${NAME} runs as ${topic}.` };
  const team = typeof b.team === "string" && TEAM.test(b.team) ? b.team : "";
  const apps = [];
  for (const a of (Array.isArray(b.apps) ? b.apps : []).slice(0, MAX_APPS)) {
    const id = text(a?.id, 200), version = text(a?.version, 100), source = httpsUrl(a?.source);
    if (id && version && source) apps.push({ id, name: text(a?.name, 100) ?? id, version, source });
  }
  const known = (Array.isArray(b.known) ? b.known : []).slice(0, MAX_KNOWN).map((k) => text(k, 300)).filter(Boolean);
  // B207: the keys of Changes' counted rows, when the page sends them apart from `known` (which also holds ignored
  // versions); null: `known` stands for them
  const counted = Array.isArray(b.counted) ? b.counted.slice(0, MAX_KNOWN).map((k) => text(k, 300)).filter(Boolean) : null;
  const expires = [];
  for (const e of (Array.isArray(b.expires) ? b.expires : []).slice(0, MAX_EXPIRES)) {
    const id = text(e?.id, 200), at = Date.parse(e?.at ?? "");
    if (id && Number.isFinite(at)) expires.push({ id, name: text(e?.name, 100) ?? id, at: new Date(at).toISOString() });
  }
  return { ok: true, device: { token, environment, topic, team, version: text(b.version, 100) ?? "", ios: text(b.ios, 20) ?? "",
    apps, known, counted, expires } };
}

// ---- what a device gets told -----------------------------------------------------------------------------------

// altstore.js runsOn, as Updates.swift runs(min:max:on:): maxOSVersion "16" means any 16.x.
export function compareOS(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0), pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function runs(min, max, ios) {
  if (!ios) return true;
  if (min && compareOS(ios, min) < 0) return false;
  if (max && compareOS(String(ios).split(".").slice(0, String(max).split(".").length).join("."), max) > 0) return false;
  return true;
}

// An AltStore source's JSON -> {bundleId: {name, version}}: each app's newest version that runs on `ios`
// (Updates.swift offers(_:ios:)).
export function offers(source, ios = "") {
  let root = source;
  if (typeof source === "string") { try { root = JSON.parse(source.replace(/^﻿/, "")); } catch { return {}; } }
  const out = {};
  for (const a of Array.isArray(root?.apps) ? root.apps : []) {
    const id = text(a?.bundleIdentifier, 200);
    if (!id) continue;
    let versions = (Array.isArray(a.versions) ? a.versions : []).filter((v) => v && typeof v === "object");
    if (!versions.length) versions = [a];
    for (const v of versions) {
      const ver = text(v.version, 100) ?? text(v.marketingVersion, 100);
      if (!ver || !runs(text(v.minOSVersion, 20), text(v.maxOSVersion, 20), ios)) continue;
      if (!out[id] || compareVersions(out[id].version, ver) < 0) out[id] = { name: text(a.name, 100) ?? id, version: ver };
      break;
    }
  }
  return out;
}

// The updates to push: newer than the device's version in the source it follows them in, not on screen (`known`),
// not pushed before (`notified`). `offersBy`: {sourceUrl: offers(...)}; a source missing there failed to load.
export function updatesFor(device, offersBy) {
  const skip = new Set([...(device.known ?? []), ...(device.notified ?? [])]);
  const seen = new Set(), out = [];
  for (const w of device.apps ?? []) {
    if (seen.has(w.id)) continue;
    const o = offersBy[w.source]?.[w.id];
    if (!o || compareVersions(o.version, w.version) <= 0) continue;
    seen.add(w.id);
    const key = `${w.id} ${o.version}`;
    if (!skip.has(key)) out.push({ id: w.id, name: w.name || o.name, installed: w.version, version: o.version, key });
  }
  return out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
}

// B207: the icon badge an update push carries (aps.badge), as native/sign/Updates.swift's badge for the background
// check: the rows Changes counted when last open (`counted`, else `known`), plus every app with an update now that
// isn't on screen (pushed before or not); a newer version of a counted row is the same row. `pushed`: this run's
// updates, never fewer than they. Before, pushes carried no badge, so an update alert left the icon bare.
const keyId = (k) => { const i = String(k).lastIndexOf(" "); return i > 0 ? String(k).slice(0, i) : null; };
export function badgeFor(device, offersBy, pushed = []) {
  const known = new Set(device.known ?? []);
  const ids = new Set((device.counted ?? device.known ?? []).map(keyId).filter(Boolean));
  for (const w of device.apps ?? []) {
    const o = offersBy[w.source]?.[w.id];
    if (o && compareVersions(o.version, w.version) > 0 && !known.has(`${w.id} ${o.version}`)) ids.add(w.id);
  }
  return Math.max(ids.size, new Set(pushed.map((u) => u.id)).size);
}

// Signatures ending within EXPIRY_WARN (or already ended less than a day ago) not warned about yet.
export function expiringFor(device, now = Date.now()) {
  const skip = new Set(device.notified ?? []);
  return (device.expires ?? []).filter((e) => {
    const at = Date.parse(e.at);
    return at - now <= EXPIRY_WARN && at - now > -86400000 && !skip.has(`expires ${e.id} ${e.at}`);
  }).map((e) => ({ ...e, key: `expires ${e.id} ${e.at}` }));
}

const names = (list) => {
  const n = list.map((u) => `${u.name} ${u.version}`);
  if (n.length <= 1) return n[0] ?? "";
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
};
const inWords = (ms) => {
  const h = Math.max(0, Math.round(ms / 3600000));
  if (h < 1) return "within the hour";
  if (h < 36) return `in ${h} hour${h === 1 ? "" : "s"}`;
  return `in ${Math.round(h / 24)} days`;
};

// The alert for one run's findings, or null. iFizBox's own update leads.
export function alertFor(updates, expiring, now = Date.now()) {
  if (updates.length) {
    const self = updates.find((u) => u.id === SELF_ID);
    if (self && updates.length === 1) return { title: `${NAME} ${self.version}`, body: `${NAME} ${self.version} is available. Tap to update.`, url: "#/changes" };
    const list = self ? [self, ...updates.filter((u) => u !== self)] : updates;
    return { title: updates.length === 1 ? "1 Update" : `${updates.length} Updates`, body: names(list), url: "#/changes" };
  }
  if (expiring.length) {
    const e = expiring.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    const left = Date.parse(e.at) - now;
    const when = left <= 0 ? "has expired" : `expires ${inWords(left)}`;
    const more = expiring.length > 1 ? ` (and ${expiring.length - 1} more)` : "";
    return { title: "Signature Expiring", body: `${e.name}'s signature ${when}${more}. Re-sign it in ${NAME} to keep it opening.` };
  }
  return null;
}

// ---- APNs ------------------------------------------------------------------------------------------------------

const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unpem = (pem) => Uint8Array.from(atob(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));

// The provider token: ES256 over {alg, kid}.{iss: team, iat}; WebCrypto's ECDSA signature is already JWS's r||s.
export async function apnsJwt({ key, keyId, teamId, now = Date.now(), subtle = crypto.subtle }) {
  const k = await subtle.importKey("pkcs8", unpem(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const te = new TextEncoder();
  const head = b64url(te.encode(JSON.stringify({ alg: "ES256", kid: keyId })));
  const body = b64url(te.encode(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) })));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, te.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

// One token per isolate, renewed after JWT_LIFE (APNs refuses one renewed more often than every 20 minutes).
let cached = null;
async function providerToken(env, now) {
  if (cached && cached.keyId === env.APNS_KEY_ID && now - cached.at < JWT_LIFE) return cached.jwt;
  const jwt = await apnsJwt({ key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, now });
  cached = { jwt, keyId: env.APNS_KEY_ID, at: now };
  return jwt;
}
export const resetPushCache = () => { cached = null; };

// Sends one alert -> {ok, status, reason, gone}. `gone`: APNs says the token is dead (410, BadDeviceToken,
// DeviceTokenNotForTopic), so the device is forgotten.
export async function sendPush(device, alert, env, { fetcher = fetch, now = Date.now() } = {}) {
  const host = env.APNS_HOST || (device.environment === "development" ? APNS_DEV : APNS_PROD);
  const payload = { aps: { alert: { title: alert.title, body: alert.body }, sound: "default" } };
  if (Number.isInteger(alert.badge) && alert.badge >= 0) payload.aps.badge = alert.badge; // B207
  if (alert.url) payload.url = alert.url;
  let r;
  try {
    r = await fetcher(`${host}/3/device/${device.token}`, { method: "POST", body: JSON.stringify(payload), headers: {
      authorization: `bearer ${await providerToken(env, now)}`, "apns-topic": device.topic, "apns-push-type": "alert",
      "apns-priority": "10", "apns-expiration": String(Math.floor(now / 1000) + 86400), "content-type": "application/json" } });
  } catch (e) {
    return { ok: false, status: 0, reason: "unreachable", gone: false };
  }
  if (r.status === 200) return { ok: true, status: 200, reason: null, gone: false };
  let reason = null;
  try { reason = (await r.json())?.reason ?? null; } catch { /* no body */ }
  const gone = r.status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic" || reason === "Unregistered";
  return { ok: false, status: r.status, reason: reason ?? `HTTP ${r.status}`, gone };
}

// ---- storage ---------------------------------------------------------------------------------------------------

const parse = (s, fallback = []) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : fallback; } catch { return fallback; } };
const rowDevice = (r) => r && { token: r.token, environment: r.environment, topic: r.topic, team: r.team, version: r.version, ios: r.ios,
  apps: parse(r.apps), known: parse(r.known), counted: r.counted == null ? null : parse(r.counted, null),
  expires: parse(r.expires), notified: parse(r.notified),
  lastPush: r.last_push ?? null, lastStatus: r.last_status ?? null };

// The notified keys still worth keeping: an app still followed and not yet at that version, an expiry still listed.
export function keepNotified(notified, device) {
  const at = new Map((device.apps ?? []).map((a) => [a.id, a.version]));
  const exp = new Set((device.expires ?? []).map((e) => `expires ${e.id} ${e.at}`));
  return (notified ?? []).filter((k) => {
    if (k.startsWith("expires ")) return exp.has(k);
    const sp = k.lastIndexOf(" ");
    const v = at.get(k.slice(0, sp));
    return v != null && compareVersions(k.slice(sp + 1), v) > 0;
  });
}

async function getDevice(db, token) {
  return rowDevice(await db.prepare("SELECT * FROM push_devices WHERE token = ?").bind(token).first());
}

async function record(db, token, result, now) {
  if (result.gone) return db.prepare("DELETE FROM push_devices WHERE token = ?").bind(token).run();
  const status = result.ok ? "delivered" : String(result.reason ?? result.status).slice(0, 100);
  return result.ok
    ? db.prepare("UPDATE push_devices SET last_push = ?, last_status = ? WHERE token = ?").bind(now, status, token).run()
    : db.prepare("UPDATE push_devices SET last_status = ? WHERE token = ?").bind(status, token).run();
}

// ---- the routes ------------------------------------------------------------------------------------------------

const limiter = rateLimiter({ rate: 30, writes: 10 });
const testLimiter = rateLimiter({ rate: 3, writes: 3 });

async function body(req) {
  const n = Number(req.headers.get("Content-Length") || 0);
  if (n > 256 * 1024) return { tooLarge: true };
  const t = await req.text();
  if (t.length > 256 * 1024) return { tooLarge: true };
  try { return { value: JSON.parse(t) }; } catch { return { value: null }; }
}

// A Response for /api/push..., or null for anything else.
export async function push(req, env = {}, { fetcher = fetch, now = Date.now(), limit = limiter, testLimit = testLimiter } = {}) {
  const u = new URL(req.url);
  if (!isPushPath(u.pathname)) return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const cfg = pushConfig(env);
  if (u.pathname === "/api/push" && req.method === "GET") return json({ enabled: cfg.enabled, reason: cfg.reason, topics: cfg.topics });
  const action = u.pathname.slice("/api/push/".length);
  if (!["register", "unregister", "status", "test"].includes(action)) return fail("not_found", "No such push call.", 404);
  if (req.method !== "POST") return fail("bad_request", "POST JSON.", 405);
  const ip = req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "?";
  if (!limit.allow(ip, action !== "status", now)) return fail("rate_limited", "Too many requests. Try again in a minute.", 429);
  const b = await body(req);
  if (b.tooLarge) return fail("too_large", "That list is too long.", 413);
  if (!env.PUSH?.prepare) return json({ code: "off", error: `Push is off on this server (no database).`, enabled: false, reason: cfg.reason }, 503);
  const db = env.PUSH;
  await schema(db);

  if (action === "register") {
    const p = parseRegistration(b.value, cfg.topics);
    if (!p.ok) return json({ code: p.code ?? "bad_request", error: p.error }, 400);
    const d = p.device;
    const old = await getDevice(db, d.token);
    const notified = JSON.stringify(keepNotified(old?.notified ?? [], d));
    await db.prepare(`INSERT INTO push_devices (token, environment, topic, team, version, ios, apps, known, counted, expires, notified, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET environment = excluded.environment,
      topic = excluded.topic, team = excluded.team, version = excluded.version, ios = excluded.ios, apps = excluded.apps,
      known = excluded.known, counted = excluded.counted, expires = excluded.expires, notified = excluded.notified,
      updated = excluded.updated`)
      .bind(d.token, d.environment, d.topic, d.team, d.version, d.ios, JSON.stringify(d.apps), JSON.stringify(d.known),
        d.counted == null ? null : JSON.stringify(d.counted), JSON.stringify(d.expires), notified, now, now).run();
    return json({ ok: true, enabled: cfg.enabled, reason: cfg.reason });
  }

  const token = typeof b.value?.token === "string" && TOKEN.test(b.value.token) ? b.value.token.toLowerCase() : null;
  if (!token) return fail("bad_request", "That isn't a device token.");
  if (action === "unregister") {
    await db.prepare("DELETE FROM push_devices WHERE token = ?").bind(token).run();
    return json({ ok: true });
  }
  const d = await getDevice(db, token);
  if (action === "status") {
    return json({ registered: Boolean(d), lastPush: d?.lastPush ? new Date(d.lastPush).toISOString() : null,
      lastStatus: d?.lastStatus ?? null, enabled: cfg.enabled, reason: cfg.reason });
  }
  // test
  if (!d) return fail("not_registered", "This iPhone isn't registered for push. Turn Push off and on again.", 404);
  if (!cfg.enabled) return json({ code: "off", error: "This server has no APNs key, so it can't push.", enabled: false, reason: cfg.reason }, 503);
  if (!testLimit.allow(token, true, now)) return fail("rate_limited", "Three test pushes a minute. Try again shortly.", 429);
  const r = await sendPush(d, { title: "Test Push", body: `Push notifications from ${DOMAIN} reach this iPhone.` }, env, { fetcher, now });
  await record(db, token, r, now);
  return json({ ok: r.ok, status: r.status, reason: r.reason, registered: !r.gone });
}

// ---- the scheduled check ---------------------------------------------------------------------------------------

async function fetchSource(url, fetcher) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SOURCE_TIMEOUT);
  try {
    const r = await fetcher(url, { signal: ctl.signal, headers: { Accept: "application/json", "User-Agent": `${NAME}-push` },
      cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok || Number(r.headers.get("Content-Length") || 0) > SOURCE_MAX_BYTES) { r.body?.cancel?.(); return null; }
    const t = await r.text();
    return t.length > SOURCE_MAX_BYTES ? null : t;
  } catch { return null; } finally { clearTimeout(timer); }
}

// One run: every device (oldest checked first, up to MAX_DEVICES_RUN), each source fetched once (up to
// MAX_SOURCES_RUN; the rest wait for the next run). Returns counts only, which is all it logs.
export async function runPushCheck(env, { fetcher = fetch, now = Date.now(), concurrency = 6 } = {}) {
  const cfg = pushConfig(env);
  if (!cfg.enabled) return { enabled: false, reason: cfg.reason, devices: 0, sources: 0, pushed: 0, failed: 0, gone: 0 };
  const db = env.PUSH;
  await schema(db);
  const rows = (await db.prepare("SELECT * FROM push_devices ORDER BY checked ASC LIMIT ?").bind(MAX_DEVICES_RUN).all()).results ?? [];
  const devices = rows.map(rowDevice);
  const wanted = [];
  for (const d of devices) for (const a of d.apps) if (!wanted.includes(a.source)) wanted.push(a.source);
  const urls = wanted.slice(0, MAX_SOURCES_RUN);
  const texts = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (next < urls.length) { const url = urls[next++]; texts.set(url, await fetchSource(url, fetcher)); }
  }));
  const parsed = new Map(); // `${ios}\n${url}` -> offers
  const offersFor = (d) => {
    const out = {};
    for (const a of d.apps) {
      const t = texts.get(a.source);
      if (t == null) continue;
      const k = `${d.ios}\n${a.source}`;
      if (!parsed.has(k)) parsed.set(k, offers(t, d.ios));
      out[a.source] = parsed.get(k);
    }
    return out;
  };
  const counts = { enabled: true, reason: null, devices: devices.length, sources: urls.length, pushed: 0, failed: 0, gone: 0 };
  for (const d of devices) {
    const offersBy = offersFor(d);
    const ups = updatesFor(d, offersBy), exp = expiringFor(d, now);
    const alert = alertFor(ups, exp, now);
    if (alert && ups.length) alert.badge = badgeFor(d, offersBy, ups); // B207: an update alert badges the icon
    let notified = d.notified;
    if (alert) {
      const r = await sendPush(d, alert, env, { fetcher, now });
      await record(db, d.token, r, now);
      if (r.gone) { counts.gone++; continue; }
      if (!r.ok) { counts.failed++; } else {
        counts.pushed++;
        notified = [...notified, ...ups.map((u) => u.key), ...exp.map((e) => e.key)].slice(-MAX_KNOWN);
      }
    }
    await db.prepare("UPDATE push_devices SET checked = ?, notified = ? WHERE token = ?").bind(now, JSON.stringify(notified), d.token).run();
  }
  return counts;
}

export async function scheduled(event, env, ctx, deps = {}) {
  const r = await runPushCheck(env, deps);
  console.log(`push: ${r.enabled ? `${r.devices} devices, ${r.sources} sources, ${r.pushed} pushed, ${r.failed} failed, ${r.gone} gone` : `off (${r.reason})`}`);
  return r;
}
