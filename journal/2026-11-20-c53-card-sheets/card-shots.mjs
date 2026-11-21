#!/usr/bin/env node
// C53: C46's harness below, cut to the modal sheet over Settings in Classic and OLED Black, with
// <html data-sheet="card"> set before the page loads (nav/sheet.js's card hook), so the card and the scaled-back
// page show. `node card-shots.mjs <web/app dir> <out dir>`. Web Animations are not frozen by FREEZE, so the shot is
// the end state.
//
// C46: C44's harness (journal/2026-11-20-c44-era-readiness/shots.mjs) with routes for packages.css's pieces: Search
// with text in the field (Cancel, the clear button), with the Filter panel open (Filter as Done, the pinstriped
// panel), an action sheet over Search (title, buttons, a red one, Cancel), and a modal sheet holding the store
// header (screens/storepage.js storeHeader with a letter icon) over a Settings page. The dump also covers
// .action-scrim and .filter-drop.
//
// C44: 3x screenshots and a computed-style dump of web/app, for a before/after diff of a CSS refactor that must not
// change a pixel. Same harness as tools/smoke/smoke.mjs (static server, headless Chromium over CDP, the fake bridge).
//
//   node shots.mjs <web/app dir> <out dir> [--pressed]
//
// For each theme (Classic, Sepia, Solarized, OLED Black, Gunmetal, Midnight) it opens Home, Settings, a Settings page pushed from
// it, Sources, Changes, Installed and Search in the app shell (data-shell="app", fake bridge), plus Home and Settings
// on the website (Classic), at 390x844 and deviceScaleFactor 3. Animations are frozen at their first frame.
// Writes <name>.png and <name>.json (every element's and ::before/::after's computed style under the nav bar, the
// tab bar and the shown page, plus html and body). With --pressed, the first bar button, back button and cell get
// .is-pressed and the first tab badge is shown before the shot, so pressed looks are compared too.
// Compare two runs with diff.py.
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
  addEventListener("DOMContentLoaded", () => document.documentElement.setAttribute("data-sheet", "card"));
  ${shell === "app" ? `window.ifizboxNative = { jailbreak: "rootless", call: async () => null }; document.documentElement.setAttribute("data-shell", "app");` : ""}
  addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(FREEZE)}; document.head.append(s); });
})();`;

const DUMP = `(() => {
  const out = {};
  const name = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") + ":" + i); } return p.join(">"); };
  const take = (el, pseudo) => { const cs = getComputedStyle(el, pseudo); const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); return o; };
  const roots = [document.documentElement, document.body];
  const scope = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top, #tabbar, .navbar, .tab-stack.is-active > .page.is-top, .sheet, .action-scrim, .filter-drop")];
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
  { tone: "dark", palette: "oled" }, { tone: "dark", palette: "gunmetal" }, { tone: "dark", palette: "midnight" },
];
const ROUTES = ["home", "settings", "settings+push", "sources", "changes", "installed", "search",
  "search+typed", "search+filter", "search+action", "settings+sheet"];
// What each extra route does on the page once it has drawn (the C44 routes: "settings+push").
const ACTIONS = {
  typed: `(() => { const i = document.querySelector(".page.is-top .search-field input, .search-field input"); if (!i) return false;
    i.value = "velvet"; i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`,
  filter: `(() => { const b = [...document.querySelectorAll(".scope-filter")].find((e) => e.offsetParent); b?.click(); return !!b; })()`,
  action: `import("./nav/actionsheet.js").then((m) => { m.showActionSheet({ title: "Velvet 1.2", buttons: ["Reinstall", "Downgrade", "Remove"], destructive: 2 }); return true; })`,
  // a notched phone's gap (safe top 47px + 10px), which headless Chromium's env() can't give
  notch: `(document.documentElement.style.setProperty("--sheet-top", "57px"), import("./nav/sheet.js")).then((s) => {
    const body = document.createElement("div"); body.className = "sheet-scroll page-body"; s.showSheet({ title: "Notch", body }); return true; })`,
  sheet: `Promise.all([import("./nav/sheet.js"), import("./screens/storepage.js")]).then(([s, sp]) => {
    const art = document.createElement("span"); art.className = "pkg-icon large"; art.innerHTML = '<span class="pkg-letter">V</span>';
    const h = sp.storeHeader({ art, name: "Velvet", author: "Example Dev", line: "Version 1.2 · Free" });
    h.setRating({ average: 3.5, count: 12 });
    const body = document.createElement("div"); body.className = "sheet-scroll page-body"; body.append(h.head); // as browse.js's sheets
    s.showSheet({ title: "Velvet", body }); return true; })`,
};

const capture = async (name) => {
  await sleep(400);
  if (PRESSED) await ev(PRESS);
  await sleep(200);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
  await writeFile(join(OUT, name + ".json"), JSON.stringify(await ev(DUMP)));
  console.log("shot", name, await ev(`JSON.stringify([document.documentElement.getAttribute("data-sheet"), (() => { const s = document.querySelector(".sheet"); return s && [getComputedStyle(s).top, getComputedStyle(s).borderTopLeftRadius]; })(), document.getElementById("screens")?.getAnimations().length])`));
};

const run = async (shell, theme, route) => {
  const script = await send("Page.addScriptToEvaluateOnNewDocument", { source: PREP(shell, theme) });
  const [tab, push] = route.split("+");
  await send("Page.navigate", { url: base + "#/" + tab });
  await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000);
  await sleep(1500);
  if (push && ACTIONS[push]) {
    if (!(await ev(ACTIONS[push]))) console.error(`${route}: the action found nothing to act on`);
    await sleep(1200);
  } else if (push) {
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
  for (const theme of [THEMES[0], THEMES[3]]) await run("app", theme, "settings+sheet");
  await run("site", THEMES[0], "settings+sheet");
  for (const theme of [THEMES[0], THEMES[3]]) await run("app", theme, "settings+notch");
} finally { await cleanup(); }
