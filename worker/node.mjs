// The same server as the Cloudflare Worker (src/index.js), on any machine with Node 22: the website (web/app/),
// /api/fetch and /sign/*. For people who'd rather run it on their own PC or in Docker than on Cloudflare.
//   node worker/node.mjs            PORT (8787), HOST (0.0.0.0), WEB (../web/app), HOST_IDS, TTL as in wrangler.toml
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
  async put(k, v, o = {}) { kv.set(k, { v, m: o.metadata ?? null, until: Date.now() + (o.expirationTtl ?? 600) * 1000 }); },
  live(k) { const e = kv.get(k); if (e && e.until < Date.now()) { kv.delete(k); return null; } return e ?? null; },
  async get(k) { return this.live(k)?.v ?? null; },
  async getWithMetadata(k) { const e = this.live(k); return { value: null, metadata: e?.m ?? null }; },
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

const env = { HOSTED, ASSETS, HOST_IDS: process.env.HOST_IDS ?? "*.cydian", TTL: process.env.TTL ?? "600" };
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
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`cydian: http://${process.env.HOST ?? "0.0.0.0"}:${port} (web: ${WEB})`));
