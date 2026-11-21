// B253 scratch: the Sources tab at 3x (402x874), jailbroken (fake bridge with two apt sources) or site; prints each
// row's icon box and title x, and writes a screenshot.  node srcshot.mjs <web/app> <out.png> [--site] [--style ios7]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const args = process.argv.slice(2);
const SITE = args.includes("--site");
const si = args.indexOf("--style"); const STYLE = si >= 0 ? args[si + 1] : null;
const ROOT = resolve(args[0]); const OUT = args[1];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const b = await readFile(path); res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(b); } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "b253-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); } } catch { ws = null; }
  if (!ws) await sleep(200);
}
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === "Runtime.exceptionThrown") console.error("page error", m.params.exceptionDetails?.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const LIST = "deb https://repo.chariz.com/ ./\\ndeb https://havoc.app/ ./\\ndeb https://repo.packix.com/ ./\\n";
const BRIDGE = `window.ifizboxNative = { jailbreak: "rootless", call: async (m) => m === "apt.sources" ? [{ path: "/var/jb/etc/apt/sources.list.d/test.list", text: "${LIST}" }] : null };`;
const styleSet = STYLE ? `try { localStorage.setItem("ifizbox.style", ${JSON.stringify(STYLE)}); } catch {}` : "";
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
const SIDE = `window.ifizboxNative = { mode: "sideload", call: async () => null };`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: args.includes("--sideload") ? SIDE + styleSet : (SITE ? `try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}` : BRIDGE) + styleSet });
await send("Page.navigate", { url: base + "#/sources" });
await sleep(6000);
if (STYLE) console.log("data-style", await ev("document.documentElement.dataset.style"));
console.log(await ev(`JSON.stringify([...document.querySelectorAll('.page.is-top .table.plain > .cell')].map((li) => {
  const ic = li.querySelector('.folder, .cell-icon'); const t = li.querySelector('.cell-label'); const s = li.querySelector('.cell-subtitle');
  const r = ic?.getBoundingClientRect(), row = li.getBoundingClientRect(), tr = t?.getBoundingClientRect();
  return { cls: li.className, label: t?.textContent, icon: r && [r.x, r.y - row.y, r.width, r.height, +(r.y + r.height / 2 - row.y - row.height / 2).toFixed(2)], titleX: tr?.x, subX: s?.getBoundingClientRect().x };
}), null, 0)`));
const r = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(r.result.data, "base64"));
chrome.kill(); server.close(); await sleep(500); await rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
