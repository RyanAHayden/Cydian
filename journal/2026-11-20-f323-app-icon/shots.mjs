// F323's Chromium check: web/app as the jailbreak (or sideload: MODE=sideload) app with a fake bridge, at 402x874 @3x.
// Serves web/app and the shell's appicon/<icon>.png (native/icon/themes/<t>/AppIcon[Lite]60x60@3x.png, Clear plain),
// then shoots Home, Theme with Match Theme on and off (and mid-slide), the Dark Icon grid, a pick, and Theme > Dark's
// preview; prints every app.icon call the page made.
//   node shots.mjs <out dir>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "web", "app");
const out = process.argv[2] ?? ".";
const MODE = process.env.MODE ?? "jailbreak";
const lite = MODE === "sideload";
await mkdir(out, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path;
  const icon = url.pathname.match(/^\/appicon\/([a-z0-9]+)\.png$/);
  if (icon) {
    path = icon[1] === "clear" ? join(ROOT, "native/icon/clear/AppIcon60x60@3x.png")
      : join(ROOT, "native/icon/themes", icon[1], `AppIcon${lite ? "Lite" : ""}60x60@3x.png`);
  } else {
    path = normalize(join(WEB, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!path.startsWith(WEB)) { res.writeHead(403).end(); return; }
  }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const BRIDGE = `(() => {
  globalThis.ifizboxApp = true;
  globalThis.__iconCalls = [];
  const answers = { "app.info": { version: "0.17.1", build: "1", ios: "18.1", jailbreak: ${lite ? '"none"' : '"rootless"'}, mode: "${MODE}", markers: [] } };
  const call = (m, p) => { if (m === "app.icon") globalThis.__iconCalls.push(p); return Promise.resolve(answers[m] ?? null); };
  globalThis.ifizboxNative = { call, mode: "${MODE}", jailbreak: ${lite ? '"none"' : '"rootless"'}, emit() {},
    helper: () => Promise.resolve({ code: 0, stdout: "" }), dpkgStatus: () => Promise.resolve("") };
})();`;

const prof = await mkdtemp(join(tmpdir(), "f323-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (ws) await new Promise((r) => ws.addEventListener("open", r));
  else await sleep(200);
}
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, name), Buffer.from(r.result.data, "base64")); console.log("shot", name); };
const tap = async (expr) => {
  const at = await ev(`(()=>{const e=${expr}; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`);
  if (!at) { console.log("tap: nothing for", expr); return false; }
  await sleep(250);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return true;
};
const go = async (hash, wait = 1400) => { await ev(`location.hash = ${JSON.stringify(hash)}`); await sleep(wait); };

await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", platform: "iPhone" });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
await send("Page.navigate", { url: base });
await sleep(2500);
await ev(`localStorage.setItem("ifizbox.appearance", "dark"); localStorage.setItem("ifizbox.darkTheme", "gunmetal"); 1`);
await send("Page.navigate", { url: base + "#/home" });
await sleep(3500);
console.log("home icon", await ev(`document.querySelector(".home-icon")?.getAttribute("src")`));
await shot("1-home-gunmetal.png");
await go("#/home/settings/theme", 1800);
await ev(`document.querySelector(".page-body:not([hidden]) [data-key=appicon]")?.scrollIntoView({block:"center"}); 1`);
await sleep(500);
await shot("2-theme-match-on.png");
await tap(`[...document.querySelectorAll(".switch[data-key=iconMatch]")].at(-1)`);
await sleep(120);
await shot("3-theme-match-off-sliding.png");
await sleep(900);
await shot("3-theme-match-off.png");
console.log("picks hidden", await ev(`[...document.querySelectorAll("[data-key=appicon-picks]")].at(-1)?.hidden`));
await tap(`[...document.querySelectorAll("[data-key=appicon-picks] a.cell-inner")].at(-1)`);
await sleep(1500);
console.log("route", await ev("location.hash"), "title", await ev(`[...document.querySelectorAll(".nav-title")].map(e=>e.textContent).join("|")`));
await shot("4-dark-icon-grid.png");
await tap(`[...document.querySelectorAll(".icon-cell[data-icon=clear]")].at(-1)`);
await sleep(900);
await shot("5-dark-icon-clear-picked.png");
console.log("checked", await ev(`[...document.querySelectorAll(".icon-cell[aria-checked=true]")].map(e=>e.dataset.icon).join(",")`));
await tap(`document.querySelector('.nav-item.is-top .back')`);
await sleep(1200);
await shot("6-theme-dark-clear.png");
await go("#/home/settings/theme/darkTheme", 1500);
await tap(`[...document.querySelectorAll(".cell-inner")].find(e=>e.textContent.includes("Nord"))`);
await sleep(1200);
await shot("7-preview-dark-clear.png");
await go("#/home/settings/theme/lightTheme", 1500);
await tap(`[...document.querySelectorAll(".cell-inner")].find(e=>e.textContent.includes("Sepia"))`);
await sleep(1200);
await shot("8-preview-light-sepia.png");
await go("#/home", 1800);
await ev(`localStorage.setItem("ifizbox.appearance", "dark"); 1`);
await go("#/home/settings", 800);
await go("#/home", 1500);
console.log("home icon now", await ev(`[...document.querySelectorAll(".home-icon")].map(e=>e.getAttribute("src")).join(",")`));
await shot("9-home-now.png");
console.log("app.icon calls", JSON.stringify(await ev("globalThis.__iconCalls")));
ws.close(); chrome.kill(); server.close(); process.exit(0);
