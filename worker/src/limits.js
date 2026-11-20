// F312: per-address limits on the routes anyone can use to make this server fetch or hold bytes: the fetch proxy
// (/api/fetch), iFizBox's own update host (POST /sign/host, an IPA held TTL seconds; its parts aren't counted again) and the website's signed
// uploads (POST /sign/upload, up to MAX_UPLOAD_MB held TTL seconds; its parts belong to that one upload and aren't
// counted again). The same pattern as /api/account (src/account.js): Cloudflare's Rate Limiting binding counts
// across isolates (FETCH_RATE_LIMIT, HOST_RATE_LIMIT, UPLOAD_RATE_LIMIT in wrangler.toml's [[ratelimits]]); without
// one, or when it throws, this isolate's memory counts (node.mjs always counts in memory).
//
// A minute's worth per address, by default: /api/fetch 300 (the website fetches every source's Release and Packages,
// icons and depiction images through it, and an IPA download resumes with Range), /sign/host 10, /sign/upload 12
// (an install reserves its token, then starts the upload: 2 each). FETCH_RATE, HOST_RATE and UPLOAD_RATE ([vars] or
// node.mjs's environment) change the memory count ("0": no limit); a binding keeps its own `limit`.
// SPDX-License-Identifier: GPL-3.0-or-later

import { rateLimiter } from "./account.js";

export const ROUTE_LIMITS = {
  fetch: { rate: 300, var: "FETCH_RATE", binding: "FETCH_RATE_LIMIT", error: "Too many fetches from here. Try again in a minute." },
  host: { rate: 10, var: "HOST_RATE", binding: "HOST_RATE_LIMIT", error: "Too many updates from here. Try again in a minute." },
  upload: { rate: 12, var: "UPLOAD_RATE", binding: "UPLOAD_RATE_LIMIT", error: "Too many installs from here. Try again in a minute." },
};

// Which limit a request falls under, or null.
export function routeOf(req, pathname) {
  if (pathname === "/api/fetch" && req.method === "GET") return "fetch";
  if (pathname === "/sign/host" && req.method === "POST") return "host";
  if (pathname === "/sign/upload" && req.method === "POST") return "upload";
  return null;
}

// The address a request came from: Cloudflare's header (node.mjs sets it from the socket).
export const addressOf = (req) =>
  req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ?? "?";

export function rateOf(env, route) {
  const v = env?.[ROUTE_LIMITS[route].var];
  if (v === undefined || v === "") return ROUTE_LIMITS[route].rate;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : ROUTE_LIMITS[route].rate;
}

const memories = new Map(); // "<route>:<rate>" -> this isolate's count
function memoryFor(route, rate) {
  const k = `${route}:${rate}`;
  if (!memories.has(k)) memories.set(k, rateLimiter({ rate, writes: rate }));
  return memories.get(k);
}

// true when this request may go on.
export async function allowRoute(env, route, ip, now = Date.now()) {
  const rate = rateOf(env, route);
  const bound = env?.[ROUTE_LIMITS[route].binding];
  if (bound?.limit) {
    try {
      return (await bound.limit({ key: `${route}:${ip}` })).success;
    } catch { /* the binding is down: count here */ }
  }
  if (rate === 0) return true;
  return memoryFor(route, rate).allow(ip, false, now);
}

// A 429 Response when the request is over its limit, else null (also for routes that have none).
export async function limited(req, pathname, env, { now = Date.now(), headers = {} } = {}) {
  const route = routeOf(req, pathname);
  if (!route || (await allowRoute(env, route, addressOf(req), now))) return null;
  return new Response(JSON.stringify({ code: "rate_limited", error: ROUTE_LIMITS[route].error }), { status: 429,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "60", ...headers } });
}
