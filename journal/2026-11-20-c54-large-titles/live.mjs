#!/usr/bin/env node
// C54: the large-title hook turned on in headless Chromium (app shell, fake bridge, 390x844 at 3x). Opens Sources,
// turns the hook on through nav/navbar.js setLargeTitles(true), then shoots and measures it at the top, half
// collapsed, collapsed, pulled down, after the body is drawn again, after a push (no large title on a pushed page),
// and after turning the hook off again.
//
//   node live.mjs <web/app dir> <out dir>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const [rootArg, outArg] = process.argv.slice(2);
const ROOT = resolve(rootArg), OUT = resolve(outArg);
await mkdir(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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
const prof = await mkdtemp(join(tmpdir(), "c54-live-"));
const port = 9800 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
if (!ws) { console.error("no chromium"); await cleanup(); process.exit(2); }
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const shot = async (name) => {
  await sleep(300);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
};
const STATE = `(() => {
  const body = document.querySelector(".tab-stack.is-active > .page.is-top > .page-body");
  const lt = body?.querySelector(":scope > .large-title");
  const h1 = document.querySelector(".nav-stack.is-active > .nav-item.is-top .nav-title");
  const r = lt?.getBoundingClientRect();
  const cs = lt && getComputedStyle(lt);
  return { first: body?.firstElementChild === lt, text: lt?.textContent, top: r?.top, h: r?.height, left: r?.left,
    font: cs && cs.fontSize + " " + cs.fontWeight, ltOpacity: lt?.style.opacity, ltTransform: lt?.style.transform,
    barOpacity: h1?.style.opacity, scrollTop: body?.scrollTop, attr: document.documentElement.getAttribute("data-nav") };
})()`;
const log = [];
const step = async (name, js = null) => {
  if (js) await ev(js);
  await sleep(250);
  const s = await ev(STATE);
  log.push({ name, ...s });
  console.log(name, JSON.stringify(s));
  await shot(name);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}
  window.ifizboxNative = { jailbreak: "rootless", call: async () => null }; document.documentElement.setAttribute("data-shell", "app");` });
await send("Page.navigate", { url: base + "#/sources" });
await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
await sleep(1500);
const BODY = `document.querySelector(".tab-stack.is-active > .page.is-top > .page-body")`;
// a long page so it can scroll: pad the bottom of Sources' body
await ev(`(() => { const s = document.createElement("div"); s.style.height = "1500px"; ${BODY}.append(s); return 1; })()`);
await step("off-top");
await step("on-top", `import("./nav/navbar.js").then((m) => { m.setLargeTitles(true); return 1; })`);
await step("on-half", `${BODY}.scrollTop = 26`);
await step("on-collapsed", `${BODY}.scrollTop = 120`);
await step("on-back-top", `${BODY}.scrollTop = 0`);
await step("on-redrawn", `(() => { const b = ${BODY}; const kids = [...b.children].filter((c) => !c.classList.contains("large-title")); b.replaceChildren(...kids); return 1; })()`);
await step("on-other-tab", `(location.hash = "#/changes", 1)`);
await sleep(800);
await step("on-pushed", `(() => { location.hash = "#/home"; return 1; })()`);
await ev(`(() => { const a = [...document.querySelectorAll(".page.is-top a[href*='settings']")].find((e) => e.offsetParent); if (a) location.hash = a.getAttribute("href"); return !!a; })()`);
await sleep(1200);
await step("on-pushed-page");
await step("off-again", `import("./nav/navbar.js").then((m) => { m.setLargeTitles(false); return 1; })`);
await writeFile(join(OUT, "live.json"), JSON.stringify(log, null, 1));
await cleanup();
