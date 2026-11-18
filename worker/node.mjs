// The same server as the Cloudflare Worker (src/index.js), on any machine with Node 22: the website (web/app/),
// /api/fetch, /api/applookup, /api/ipainfo and /sign/*. For people who'd rather run it on their own PC or in Docker than on Cloudflare.
//   node worker/node.mjs            PORT (8787), HOST (0.0.0.0), WEB (../web/app), HOST_IDS, TTL as in wrangler.toml
//   F187: reviews (/reviews/*) in SQLite at REVIEWS_DB (reviews.db, "off" for none); REVIEWS_ADMIN, REVIEWS_SALT,
//   REVIEW_DAILY, REPORT_HIDE as the Worker's.
// iOS takes the install manifest only over HTTPS with a trusted certificate: put it behind Tailscale
// (`tailscale serve --bg 8787`), a Cloudflare Tunnel or Caddy with a domain (worker/README.md).
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(process.env.WEB ?? join(here, "../web/app"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon", ".woff2": "font/woff2" };

// KV in memory, with expiry: held updates are minutes-long, so a restart losing them is fine.
const kv = new Map();
const HOSTED = {
  async put(k, v, o = {}) { kv.set(k, { v, m: o.metadata ?? null, until: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : Infinity }); }, // F97: accounts have no TTL
  live(k) { const e = kv.get(k); if (e && e.until < Date.now()) { kv.delete(k); return null; } return e ?? null; },
  async get(k) { return this.live(k)?.v ?? null; },
  async getWithMetadata(k, o = {}) { const e = this.live(k); return { value: o.type === "arrayBuffer" ? e?.v ?? null : null, metadata: e?.m ?? null }; },
  async delete(k) { kv.delete(k); }, // F97: Delete Account
};
setInterval(() => { for (const k of kv.keys()) HOSTED.live(k); }, 60_000).unref();

// Static files as Workers static assets would serve them: revalidated every load, index.html for app routes.
const ASSETS = {
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(WEB, path);
    if (!file.startsWith(WEB)) return new Response("Not found", { status: 404 });
    try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(WEB, "index.html"); }
    try {
      return new Response(await readFile(file), { headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=0, must-revalidate" } });
    } catch { return new Response("Not found", { status: 404 }); }
  },
};

// F161: /api/applookup's day-long cache (and F160's /api/ipainfo's 30 days), as Cloudflare's edge cache keeps it (caches.default isn't in Node).
const looked = new Map();
const LOOKUP_CACHE = {
  async match(req) { const e = looked.get(req.url); if (!e || e.until < Date.now()) { looked.delete(req.url); return undefined; } return new Response(e.body, e.init); },
  async put(req, res) {
    const ttl = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
    if (ttl > 0) looked.set(req.url, { body: await res.text(), init: { status: res.status, headers: Object.fromEntries(res.headers) }, until: Date.now() + ttl * 1000 });
  },
};
setInterval(() => { const now = Date.now(); for (const [k, e] of looked) if (e.until < now) looked.delete(k); }, 3_600_000).unref();

const env = { HOSTED, ASSETS, LOOKUP_CACHE, HOST_IDS: process.env.HOST_IDS ?? "*.cydian", TTL: process.env.TTL ?? "600", MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB };

// F187: F182's reviews in a SQLite file (node:sqlite, Node 22.5+) with D1's API, kept across restarts. Without
// node:sqlite, or with REVIEWS_DB=off, /reviews/* answers as a Worker with no D1 binding does.
const REVIEWS_DB = process.env.REVIEWS_DB || "reviews.db";
if (REVIEWS_DB !== "off") {
  try {
    const { d1 } = await import("./src/d1-sqlite.js");
    env.REVIEWS = d1(REVIEWS_DB);
    for (const k of ["REVIEWS_ADMIN", "REVIEWS_SALT", "REVIEW_DAILY", "REPORT_HIDE"]) if (process.env[k]) env[k] = process.env[k];
  } catch (e) { console.warn(`reviews off: ${e?.message ?? e}`); }
}
const server = http.createServer(async (inc, out) => {
  try {
    const proto = inc.headers["x-forwarded-proto"] ?? "http";
    const url = `${proto}://${inc.headers["x-forwarded-host"] ?? inc.headers.host}${inc.url}`;
    const body = ["GET", "HEAD"].includes(inc.method) ? undefined : inc;
    const req = new Request(url, { method: inc.method, headers: inc.headers, body, duplex: "half" });
    const res = await worker.fetch(req, env);
    out.writeHead(res.status, Object.fromEntries(res.headers));
    if (res.body && inc.method !== "HEAD") for await (const chunk of res.body) out.write(chunk);
    out.end();
  } catch (e) {
    out.writeHead(500, { "Content-Type": "text/plain" }); out.end(String(e?.message ?? e));
  }
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`cydian: http://${process.env.HOST ?? "0.0.0.0"}:${port} (web: ${WEB}${env.REVIEWS ? `, reviews: ${REVIEWS_DB}` : ""})`));
