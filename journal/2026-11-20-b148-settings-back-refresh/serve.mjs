// B148's Chromium check: web/app as static files plus /api/account/<id> kept in memory (the Worker's GET/PUT/DELETE
// with ETag versions), so Settings > iFizBox Account > Create Account works without the real site.
//   node serve.mjs <web/app dir> <port>
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const [root, port] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
const accounts = new Map(); // id -> { version, data }

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/api\/account\/([^/]+)$/);
  if (m) {
    const have = accounts.get(m[1]);
    if (req.method === "GET") {
      if (!have) { res.writeHead(404).end(); return; }
      res.writeHead(200, { ETag: `"${have.version}"` }).end(have.data);
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const version = (have?.version ?? 0) + 1;
      accounts.set(m[1], { version, data: Buffer.concat(chunks) });
      res.writeHead(200, { ETag: `"${version}"`, "Content-Type": "application/json" }).end(JSON.stringify({ version }));
      return;
    }
    if (req.method === "DELETE") { accounts.delete(m[1]); res.writeHead(204).end(); return; }
  }
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
  const path = normalize(join(root, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(port), "127.0.0.1", () => console.log(`ready ${port}`));
