// node f341shots.mjs <web/app> <out>: action sheet and alerts in iOS 6, iOS 7 White and iOS 7 OLED, 390x844 @3x.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const [rootArg, outArg] = process.argv.slice(2);
const ROOT = resolve(rootArg), OUT = resolve(outArg);
await mkdir(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) { res.writeHead(404).end(); return; }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "f341-"));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", "--no-first-run", "--font-render-hinting=none",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const VARIANTS = [["ios6", "ios6", "light"], ["white", "ios7", "light"], ["oled", "ios7", "dark"]];
const CASES = {
  sheet: `import('./nav/actionsheet.js').then(a=>{a.showActionSheet({title:'Remove this source and its packages?',buttons:['Remove Source','Refresh','Share'],destructive:0});return 1})`,
  sheetnotitle: `import('./nav/actionsheet.js').then(a=>{a.showActionSheet({buttons:['Reinstall','Remove'],destructive:1});return 1})`,
  alert2: `import('./nav/alert.js').then(a=>{a.showAlert({title:'Add Source',message:'Enter the address of a source.',input:{placeholder:'https://'},buttons:['Cancel','Add Source']});return 1})`,
  alert1: `import('./nav/alert.js').then(a=>{a.showAlert({title:'Done',message:'The source was added.',buttons:['OK']});return 1})`,
  alert3: `import('./nav/alert.js').then(a=>{a.showAlert({title:'Install',message:'Pick one.',buttons:['Cancel','Install Now','Later']});return 1})`,
};
for (const [name, style, tone] of VARIANTS) {
  for (const [c, js] of Object.entries(CASES)) {
    const s = await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('ifizbox.firstVisit','later');localStorage.setItem('ifizbox.style','${style}');localStorage.setItem('ifizbox.appearance','${tone}');localStorage.setItem('ifizbox.darkTheme','oled');localStorage.setItem('ifizbox.lightTheme','classic');window.ifizboxNative={jailbreak:'rootless',call:async()=>null};document.documentElement.setAttribute('data-shell','app');` });
    await send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await send("Page.navigate", { url: base + "#/home" });
    await sleep(2500);
    await ev(js);
    await sleep(900);
    if (c === "alert2") await ev(`document.querySelectorAll('.alert-button')[1]?.classList.add('is-pressed')`);
    const geo = await ev(`JSON.stringify([...document.querySelectorAll('.alert,.alert-button,.action-sheet,.action-list,.action-title,.action-button')].map(e=>{const r=e.getBoundingClientRect();return e.className+' '+r.x.toFixed(1)+','+r.y.toFixed(1)+' '+r.width.toFixed(1)+'x'+r.height.toFixed(1)}))`);
    console.log(name, c, geo);
    const r = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, `${name}-${c}.png`), Buffer.from(r.result.data, "base64"));
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: s.result.identifier });
  }
}
chrome.kill(); server.close(); await sleep(500); await rm(prof, { recursive: true, force: true }).catch(() => {});
