#!/usr/bin/env node
// C49: shots.mjs's harness, but for chrome the routes never show (console bar and buttons, My IPAs' Delete, red,
// Done, plain and back bar buttons, search bar with scope bar, segments, Filter and its Done, Cancel, field, the
// package header band, the App Store segmented control). On Search in the app shell it appends that markup as a
// fixture and writes <out dir>/app-<palette>-search.json: each element's computed paint (colours, backgrounds,
// borders, border image, shadows, filter). Compare two runs with diff -r.
//
//   PALETTES=sepia,solarized node probe.mjs <web/app dir> <out dir>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve } from "node:path";

const args = process.argv.slice(2);
const PRESSED = args.includes("--pressed");
const [rootArg, outArg] = args.filter((a) => !a.startsWith("--"));
const ROOT = resolve(rootArg), OUT = resolve(outArg);
await mkdir(OUT, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2" };
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

const prof = await mkdtemp(join(tmpdir(), "c44-shots-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROMIUM ?? "chromium", ["--headless", "--hide-scrollbars", "--no-first-run", "--font-render-hinting=none",
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };

let ws;
for (let i = 0; i < 75 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
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

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
// Frozen clock-free look: no animation moves, no transition runs, no caret blinks.
const FREEZE = `*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}`;
const PREP = (shell, theme) => `(() => {
  try {
    localStorage.setItem("ifizbox.firstVisit", "later");
    localStorage.setItem("ifizbox.appearance", ${JSON.stringify(theme.tone)});
    localStorage.setItem(${JSON.stringify(theme.tone === "dark" ? "ifizbox.darkTheme" : "ifizbox.lightTheme")}, ${JSON.stringify(theme.palette)});
  } catch {}
  ${shell === "app" ? `window.ifizboxNative = { jailbreak: "rootless", call: async () => null }; document.documentElement.setAttribute("data-shell", "app");` : ""}
  addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(FREEZE)}; document.head.append(s); });
})();`;

const DUMP = `(() => {
  const out = {};
  const name = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") + ":" + i); } return p.join(">"); };
  const take = (el, pseudo) => { const cs = getComputedStyle(el, pseudo); const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); return o; };
  const roots = [document.documentElement, document.body];
  const scope = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top, #tabbar, .navbar, .tab-stack.is-active > .page.is-top, .sheet")];
  const els = new Set(roots);
  for (const s of scope) { els.add(s); for (const e of s.querySelectorAll("*")) els.add(e); }
  for (const el of els) {
    if (el.tagName === "svg" || el.closest("svg")) continue;
    const n = name(el);
    out[n] = take(el, null);
    for (const p of ["::before", "::after"]) { const c = getComputedStyle(el, p).content; if (c && c !== "none" && c !== "normal") out[n + p] = take(el, p); }
  }
  return out;
})()`;

const PRESS = `(() => {
  const q = (s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent && !e.closest('.page:not(.is-top), .nav-item:not(.is-top), [hidden]'));
  for (const s of [".nav-item.is-top .bar-button:not(.back)", ".nav-item.is-top .bar-button.back", ".page.is-top .cell-inner"]) q(s)?.classList.add("is-pressed");
  const b = document.querySelector("#tabbar .tab .badge"); if (b) { b.hidden = false; b.textContent = "3"; }
  return true;
})()`;

const THEMES = [
  { tone: "light", palette: "classic" }, { tone: "light", palette: "sepia" }, { tone: "light", palette: "solarized" },
  { tone: "light", palette: "legalpad" }, { tone: "light", palette: "metal" }, // C49: every light palette
  { tone: "dark", palette: "oled" }, { tone: "dark", palette: "gunmetal" }, { tone: "dark", palette: "midnight" },
].filter((t) => !process.env.PALETTES || process.env.PALETTES.split(",").includes(t.palette));
const ROUTES = ["home", "settings", "settings+push", "sources", "changes", "installed", "search"];

// C49 probe: chrome the routes never show, built as a fixture in the page and read back as computed paint only.
const FIXTURE = `<div class="console"><div class="navbar sheet-bar"><h1 class="nav-title" id="p-console-title">Running</h1><button class="bar-button" id="p-console-btn">Close</button></div></div>
<div class="manage-toolbar shown"><button class="bar-button manage-delete" id="p-delete">Delete</button></div>
<button class="bar-button red" id="p-red">Cancel</button><button class="bar-button red is-pressed" id="p-red-pressed">Cancel</button>
<button class="bar-button done" id="p-done">Done</button><button class="bar-button" id="p-btn">Edit</button><button class="bar-button back" id="p-back">Back</button>
<div class="search-root"><div class="search-bar has-scope" id="p-search-bar"><label class="search-field" id="p-search-field"><input placeholder="x"></label><button class="search-cancel" id="p-cancel">Cancel</button></div>
<div class="search-scope" id="p-scope"><div class="scope-segments"><button class="scope-segment selected" id="p-seg-sel">A</button><button class="scope-segment" id="p-seg">B</button><button class="scope-segment" id="p-seg2">C</button></div><button class="scope-filter" id="p-filter">Filter</button><button class="scope-filter done" id="p-filter-done">Done</button></div></div>
<div class="search-bar" id="p-search-bar-plain"></div>
<div class="store-head" id="p-store-head"></div>
<div class="store-segmented" id="p-store-seg"><button class="store-segment selected">A</button><button class="store-segment" id="p-store-seg-b">B</button><button class="store-segment" id="p-store-seg-c">C</button></div>`;
const PAINT = ["color", "text-shadow", "background-image", "background-color", "border-top-color", "border-right-color", "border-bottom-color",
  "border-left-color", "border-image-source", "box-shadow", "filter"];
const PROBE = `(() => {
  const box = document.createElement("div"); box.innerHTML = ${JSON.stringify(FIXTURE)}; document.body.append(box);
  const out = {};
  for (const el of box.querySelectorAll("[id^=p-], .console .navbar")) {
    const cs = getComputedStyle(el); const o = {}; for (const p of ${JSON.stringify(PAINT)}) o[p] = cs.getPropertyValue(p);
    out[el.id || el.className] = o;
  }
  return out;
})()`;
const capture = async (name) => {
  await sleep(400);
  await writeFile(join(OUT, name + ".json"), JSON.stringify(await ev(PROBE), null, 1));
  console.log("probe", name);
};

const run = async (shell, theme, route) => {
  const script = await send("Page.addScriptToEvaluateOnNewDocument", { source: PREP(shell, theme) });
  const [tab, push] = route.split("+");
  await send("Page.navigate", { url: base + "#/" + tab });
  await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
  await sleep(1500);
  if (push) {
    const before = await ev("location.hash");
    await ev(`(() => { const a = [...document.querySelectorAll(".page.is-top a.cell-inner[href*='settings/'], .page.is-top a[href*='settings/']")].find((e) => e.offsetParent); if (a) location.hash = a.getAttribute("href"); return !!a; })()`);
    await until(`location.hash !== ${JSON.stringify(before)}`, 3000);
    await sleep(1500);
  }
  await capture(`${shell}-${theme.palette}-${route}`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.result.identifier });
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
};

try {
  for (const theme of THEMES) await run("app", theme, "search");
} finally { await cleanup(); }
