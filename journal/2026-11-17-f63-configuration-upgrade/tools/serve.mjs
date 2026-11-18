// F63 walk-through server (N4's, copied): web/app/ as the jailbreak app sees it, with native/fake/ as the Swift side. index.html
// gets a classic script that defines cydianNative (like native/bridge.js) whose call() POSTs to /call; the answer is
// NDJSON, one {event} line per streamed helper line as it comes, then {result} or {error}. POST /env sets the fake
// helper's env (FAKE_FAIL, FAKE_SLOW, ...). apt's lists start filled (as after apt-get update), plus an older Example
// Tweak 0.9 that depends on mobilesubstrate, for Downgrade and Restart SpringBoard.
// Usage: node serve.mjs [port]   SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from "node:http";
import { readFileSync, existsSync, copyFileSync, readdirSync, appendFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createFakeNative, makeFixture } from "../../../native/fake/fake-native.mjs";

const ROOT = new URL("../../../web/app/", import.meta.url).pathname;
const port = Number(process.argv[2] || 8781);
const fx = makeFixture();
const lists = join(fx.prefix, "var/lib/apt/lists");
for (const f of readdirSync(join(fx.remote, "lists"))) copyFileSync(join(fx.remote, "lists", f), join(lists, f));
const OLD = "\n\nPackage: com.example.tweak\nVersion: 0.9\nArchitecture: iphoneos-arm64\n" +
  "Maintainer: Example Dev <dev@example.com>\nSection: Tweaks\nName: Example Tweak\nDepends: mobilesubstrate\n" +
  "Filename: debs/com.example.tweak_0.9_iphoneos-arm64.deb\nSize: 90\nDescription: an example tweak\n";
// Both copies: the fake apt-get update copies the remote lists over apt's.
for (const dir of [lists, join(fx.remote, "lists")]) appendFileSync(join(dir, "havoc.app_._Packages"), OLD);
let env = {};
let native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
process.on("exit", fx.cleanup);
process.on("SIGTERM", () => process.exit(0));

const SHIM = `<script>
(function (g) {
  function withCode(msg) { const m = /^([a-z_]+): ([\\s\\S]*)$/.exec(msg); const e = new Error(m ? m[2] : msg); if (m) e.code = m[1]; return e; }
  async function call(method, params, onEvent) {
    const r = await fetch("/call", { method: "POST", body: JSON.stringify({ method, params: params || {}, stream: Boolean(onEvent) }) });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.event) { try { onEvent && onEvent(m.event); } catch (e) { console.error(e); } }
        else if ("result" in m) return m.result;
        else if (m.error) throw withCode(m.error);
      }
      if (done) throw new Error("network: bridge closed");
    }
  }
  g.cydianApp = true;
  g.cydianNative = { call, emit() {}, mode: "jailbreak", jailbreak: "rootless",
    helper: (words, onEvent) => call("helper.run", { words: [...words].map(String), stream: Boolean(onEvent) }, onEvent),
    dpkgStatus: () => call("apt.dpkgStatus") };
})(globalThis);
</script>`;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    if (url.pathname === "/env") {
      env = JSON.parse(body || "{}");
      native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env });
      res.end("ok");
      return;
    }
    const { method, params, stream } = JSON.parse(body);
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    try {
      const result = await native.call(method, params, stream ? (event) => res.write(JSON.stringify({ event }) + "\n") : undefined);
      res.end(JSON.stringify({ result: result ?? null }) + "\n");
    } catch (e) {
      res.end(JSON.stringify({ error: e.message }) + "\n");
    }
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
  if (!path || path.endsWith("/")) path += "index.html";
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let data = readFileSync(file);
  if (path === "index.html") data = data.toString().replace("<head>", "<head>" + SHIM);
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(data);
}).listen(port, "127.0.0.1", () => console.log(`serving on ${port}, prefix ${fx.prefix}`));
