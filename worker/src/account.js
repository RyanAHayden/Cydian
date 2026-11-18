// F97: Cydian Account's storage. One encrypted blob per account in KV (HOSTED, keys "acct:<hash>"). The device
// encrypts everything with its account key before sending (web/app/core/account.js), so this only ever sees
// ciphertext, and never the key: the path's id is derived from the key with HKDF, and KV's key is the SHA-256 of
// that id, so even a dump of KV doesn't give the URLs.
//
//   GET    /api/account/<id>   the blob (application/octet-stream), ETag "<version>"; 404 when there is none
//   PUT    /api/account/<id>   body: the blob (up to MAX_ACCOUNT bytes). If-Match: "<version>" to replace that version,
//                              If-None-Match: * to make a new one. Another version there: 409 (with its ETag), so a
//                              second device merges instead of overwriting -> {version}
//   DELETE /api/account/<id>   gone -> {ok}
//
// <id> is 64 hex characters. Each address gets ACCOUNT_RATE requests a minute (ACCOUNT_WRITES of them writes),
// never counted in KV, which has only 1,000 free writes a day. F98: with Cloudflare's Rate Limiting bindings
// (ACCOUNT_RATE_LIMIT, ACCOUNT_WRITE_LIMIT in wrangler.toml's [[ratelimits]]) the count holds across isolates
// (per Cloudflare location); without them, or if one throws, it is counted in this isolate's memory.
// Bodies are never logged.
// SPDX-License-Identifier: GPL-3.0-or-later

export const MAX_ACCOUNT = 256 * 1024;
const ACCOUNT_RATE = 60, ACCOUNT_WRITES = 12;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-Match, If-None-Match", "Access-Control-Expose-Headers": "ETag" };
const PATH = /^\/api\/account\/([0-9a-f]{64})$/;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra } });
const fail = (code, error, status, extra) => json({ code, error }, status, extra);

export const isAccountPath = (pathname) => pathname.startsWith("/api/account");

export async function kvKey(id) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  return "acct:" + [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Requests per address per minute, in memory: { allow(ip, write, now) -> true | false }.
export function rateLimiter({ rate = ACCOUNT_RATE, writes = ACCOUNT_WRITES } = {}) {
  const seen = new Map();
  return {
    allow(ip, write, now = Date.now()) {
      const minute = Math.floor(now / 60000);
      let e = seen.get(ip);
      if (!e || e.minute !== minute) {
        if (seen.size > 10000) seen.clear(); // a bounded map: forgetting everyone only lets a minute through again
        e = { minute, n: 0, w: 0 };
        seen.set(ip, e);
      }
      if (e.n >= rate || (write && e.w >= writes)) return false;
      e.n++;
      if (write) e.w++;
      return true;
    },
  };
}
const limiter = rateLimiter();

// F98: Cloudflare's Rate Limiting bindings, { allow(ip, write) -> Promise<bool> }. Every request takes one from
// `all`; a write also from `writes` (or from `all` again under a "w:" key when only one is bound). A binding that
// throws hands that request to the memory limiter, so an outage there never locks accounts out or lets floods in.
export function bindingLimiter(all, writes, fallback = limiter) {
  return {
    async allow(ip, write, now = Date.now()) {
      try {
        if (!(await all.limit({ key: ip })).success) return false;
        if (write && !(await (writes ?? all).limit({ key: writes ? ip : "w:" + ip })).success) return false;
        return true;
      } catch {
        return fallback.allow(ip, write, now);
      }
    },
  };
}
const limiterFor = (env) => env?.ACCOUNT_RATE_LIMIT?.limit
  ? bindingLimiter(env.ACCOUNT_RATE_LIMIT, env.ACCOUNT_WRITE_LIMIT?.limit ? env.ACCOUNT_WRITE_LIMIT : null)
  : limiter;

const tag = (v) => `"${v}"`;
const untag = (h) => String(h ?? "").trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");

async function current(env, key) {
  const r = await env.HOSTED.getWithMetadata(key, { type: "arrayBuffer" });
  return r?.value ? { data: r.value, version: Number(r.metadata?.version) || 1 } : null;
}

// A Response for /api/account..., or null for anything else.
export async function account(req, env, { limit = limiterFor(env), now = Date.now() } = {}) {
  const u = new URL(req.url);
  if (!isAccountPath(u.pathname)) return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = PATH.exec(u.pathname);
  if (!m) return fail("bad_request", "No such account.", 404);
  const write = req.method === "PUT" || req.method === "DELETE";
  if (!write && req.method !== "GET") return fail("bad_request", "GET, PUT or DELETE.", 405);
  const ip = req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "?";
  if (!(await limit.allow(ip, write, now))) return fail("rate_limited", "Too many requests. Try again in a minute.", 429, { "Retry-After": "60" });
  const key = await kvKey(m[1]);

  if (req.method === "GET") {
    const cur = await current(env, key);
    if (!cur) return fail("not_found", "There is no account with that key.", 404);
    return new Response(cur.data, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
      ETag: tag(cur.version), ...CORS } });
  }
  if (req.method === "DELETE") {
    await env.HOSTED.delete(key);
    return json({ ok: true });
  }

  // PUT: the size first (the header, then what really came), then the version.
  const told = Number(req.headers.get("Content-Length") || 0);
  if (told > MAX_ACCOUNT) { req.body?.cancel?.(); return fail("too_large", `An account holds up to ${MAX_ACCOUNT / 1024} KB.`, 413); }
  const body = await readCapped(req, MAX_ACCOUNT);
  if (!body) return fail("too_large", `An account holds up to ${MAX_ACCOUNT / 1024} KB.`, 413);
  if (body.byteLength < 29) return fail("bad_request", "That isn't an encrypted account.", 400); // 12-byte IV + 16-byte tag + data
  const cur = await current(env, key);
  const match = req.headers.get("If-Match"), none = req.headers.get("If-None-Match");
  if (cur) {
    if (none?.trim() === "*" || !match || (match.trim() !== "*" && Number(untag(match)) !== cur.version)) {
      return fail("conflict", "The account changed on another device.", 409, { ETag: tag(cur.version) });
    }
  } else if (match && match.trim() !== "*") {
    return fail("not_found", "There is no account with that key.", 404);
  }
  const version = (cur?.version ?? 0) + 1;
  await env.HOSTED.put(key, body.buffer.byteLength === body.byteLength ? body.buffer : body.slice().buffer, { metadata: { version, size: body.byteLength, at: now } });
  return json({ version }, cur ? 200 : 201, { ETag: tag(version) });
}

// The body as bytes, or null once it passes max.
async function readCapped(req, max) {
  if (!req.body) return new Uint8Array(0);
  const parts = [];
  let n = 0;
  for await (const chunk of req.body) {
    n += chunk.byteLength;
    if (n > max) return null;
    parts.push(chunk);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
