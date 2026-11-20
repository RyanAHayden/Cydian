// node serve.mjs <root> <port>: static files; /api/fetch answers 502 after 5 s so a site refresh lasts a while.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
const [root, port] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" };
createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) { setTimeout(() => { res.writeHead(502); res.end("slow fail"); }, 5000); return; }
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  try { const b = await readFile(join(root, p)); res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(Number(port), "127.0.0.1");
