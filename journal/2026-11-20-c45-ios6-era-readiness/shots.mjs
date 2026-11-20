#!/usr/bin/env node
// C45: C46's harness (below) with routes for the rest of ios6.css: the HUD, the menu callout and the queue hint,
// the banner (and its button), the share sheet (system and app icons), the reload bar, the undo bar, and a "controls"
// page added to a Settings page (segmented control, switches, a plain table with its section header, the button
// pair, signing rows with the password field waiting and its glyphs, both placeholders, the empty-state note), plus
// Home's pull area shown at its foot. The dump also covers those overlays.
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
  ${shell === "app" ? `window.ifizboxNative = { jailbreak: "rootless", call: async () => null }; document.documentElement.setAttribute("data-shell", "app");` : ""}
  addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(FREEZE)}; document.head.append(s); });
})();`;

const DUMP = `(() => {
  const out = {};
  const name = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 0, s = e; while ((s = s.previousElementSibling)) i++; p.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).join(".") : "") + ":" + i); } return p.join(">"); };
  const take = (el, pseudo) => { const cs = getComputedStyle(el, pseudo); const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); return o; };
  const roots = [document.documentElement, document.body];
  const scope = [...document.querySelectorAll(".nav-stack.is-active .nav-item.is-top, #tabbar, .navbar, .tab-stack.is-active > .page.is-top, .sheet, .action-scrim, .filter-drop, .hud-scrim, .menu, .queue-hint, .banner, .share-scrim, .reload-bar, .undo-bar, .pull-clip")];
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
  "settings+hud", "settings+menu", "home+banner", "home+share", "installed+reload", "installed+undo", "settings+controls", "home+pull"];
// What each extra route does on the page once it has drawn (the C44 routes: "settings+push").
const ACTIONS = {
  typed: `(() => { const i = document.querySelector(".page.is-top .search-field input, .search-field input"); if (!i) return false;
    i.value = "velvet"; i.dispatchEvent(new Event("input", { bubbles: true })); i.blur(); return true; })()`,
  filter: `(() => { const b = [...document.querySelectorAll(".scope-filter")].find((e) => e.offsetParent); b?.click(); return !!b; })()`,
  action: `import("./nav/actionsheet.js").then((m) => { m.showActionSheet({ title: "Velvet 1.2", buttons: ["Reinstall", "Downgrade", "Remove"], destructive: 2 }); return true; })`,
  sheet: `Promise.all([import("./nav/sheet.js"), import("./screens/storepage.js")]).then(([s, sp]) => {
    const art = document.createElement("span"); art.className = "pkg-icon large"; art.innerHTML = '<span class="pkg-letter">V</span>';
    const h = sp.storeHeader({ art, name: "Velvet", author: "Example Dev", line: "Version 1.2 · Free" });
    h.setRating({ average: 3.5, count: 12 });
    const body = document.createElement("div"); body.className = "sheet-scroll page-body"; body.append(h.head); // as browse.js's sheets
    s.showSheet({ title: "Velvet", body }); return true; })`,
  hud: `import("./nav/hud.js").then((m) => { m.showHUD("Reloading Data"); return true; })`,
  menu: `import("./nav/menu.js").then((m) => {
    const a = [...document.querySelectorAll(".page.is-top .cell-inner")].find((e) => e.offsetParent); if (!a) return false;
    m.showMenu(a, [{ label: "Copy", onClick() {} }, { label: "Share", onClick() {} }]);
    const q = document.createElement("div"); q.className = "queue-hint"; q.style.cssText = "left: 150px; top: 640px";
    q.innerHTML = '<span class="queue-hint-text">Hold Installed to see the queue</span><span class="queue-hint-arrow" style="left: 60px"></span>';
    document.body.append(q); return true; })`,
  banner: `import("./nav/banner.js").then((m) => { m.showBanner({ message: "2 upgrades are ready.", action: { label: "Upgrade", onClick() {} }, duration: 60000 }); return true; })`,
  share: `import("./nav/sharesheet.js").then((m) => { m.showShareSheet({ items: [{ label: "Copy", glyph: "copy" }, { label: "QR Code", glyph: "qr" },
    { label: "Notes", letter: "N", color: "#e0a030" }, { label: "Mail", letter: "M" }] }); return true; })`,
  reload: `import("./nav/reloadbar.js").then((m) => { m.showReloadBar("Downloading Packages", { onCancel() {} }); return true; })`,
  undo: `import("./nav/undobar.js").then((m) => { m.showUndoBar({ message: "Removed Velvet from the queue", onUndo() {}, duration: 60000 }); return true; })`,
  controls: `Promise.all([import("./nav/ui.js"), import("./nav/switch.js")]).then(([ui, sw]) => {
    const body = document.querySelector(".tab-stack.is-active > .page.is-top .page-body"); if (!body) return false;
    body.textContent = "";
    const seg = ui.segmented(["Details", "Reviews", "Related"], { selected: 1 }); body.append(seg.bar);
    const g = document.createElement("div"); g.className = "group sign-files";
    g.innerHTML = '<ul class="table grouped">'
      + '<li class="cell"><div class="cell-inner has-switch"><span class="cell-label">Keep Bundle ID</span></div></li>'
      + '<li class="cell"><div class="cell-inner has-switch"><span class="cell-label">arm64e Fix-Up</span></div></li>'
      + '<li class="cell"><div class="cell-inner sign-row"><span class="cell-label">Certificate</span><span class="sign-value">dev.p12</span><span class="bar-button sign-browse">Choose</span></div></li>'
      + '<li class="cell"><div class="cell-inner sign-row has-browse"><span class="cell-label">Icon</span><span class="sign-value is-empty">The App\\'s</span><span class="bar-button sign-browse">Choose</span></div></li>'
      + '<li class="cell server-field"><div class="cell-inner"><span class="cell-label">Server</span><span class="cell-detail">sign.example</span></div></li>'
      + '</ul><div class="button-pair"><button class="cell-inner pair-button">Replace</button><button class="cell-inner pair-button delete-button">Remove Certificate</button></div>'
      + '<div class="sign-password"><ul class="table grouped"><li class="cell sign-pw-cell" data-state="waiting"><div class="cell-inner sign-pw-row"><span class="sign-pw-glyph pw-lock"></span><input class="sign-value sign-field sign-pw-input" placeholder="Required"></div></li>'
      + '<li class="cell"><div class="cell-inner sign-pw-row"><span class="sign-pw-glyph pw-right"></span><span class="sign-pw-glyph pw-wrong"></span><span class="sign-pw-glyph pw-kept"></span></div></li>'
      + '<li class="cell sign-pw-txt-cell"><button class="cell-inner sign-pw-txt">Read From a .txt File</button></li></ul>'
      + '<p class="group-footer sign-pw-status"><span class="sign-pw-wrong">Wrong password.</span></p></div>';
    body.append(g);
    const rows = g.querySelectorAll(".has-switch");
    rows[0].append(sw.createSwitch({ label: "Keep Bundle ID", checked: true })); rows[1].append(sw.createSwitch({ label: "arm64e", checked: false }));
    const p = document.createElement("div");
    p.innerHTML = '<div class="section-header">V</div><ul class="table plain"><li class="cell"><div class="cell-inner chevron"><div class="cell-text"><span class="cell-label">Velvet</span><span class="cell-subtitle">A tweak</span></div></div></li></ul>';
    body.append(p, ui.placeholder("list", 2), ui.placeholder("page", 1), ui.note("Nothing here yet."));
    return true; })`,
  // nav/pullrefresh.js adds its area on the first touch; this puts the same markup after the page's scroller, shown at
  // its foot (grouped on Home, as pullrefresh.js marks it) and a plain copy under it.
  pull: `(() => { const s = document.querySelector(".tab-stack.is-active > .page.is-top .page-body"); if (!s) return false;
    const make = (grouped, top) => { const c = document.createElement("div"); c.className = "pull-clip on" + (grouped ? " grouped" : "");
      c.style.cssText = "top: " + top + "px; height: 80px";
      c.innerHTML = '<div class="pull-refresh"><div class="pull-inner"><span class="pull-arrow"></span><span class="pull-spinner"></span>'
        + '<span class="pull-text"><b class="pull-title">Pull down to refresh...</b><span class="pull-time">Last Updated: Never</span></span></div></div>';
      c.firstChild.style.transform = "translateY(-400px)"; return c; };
    s.after(make(true, 120), make(false, 220)); return true; })()`,
};

const capture = async (name) => {
  await sleep(400);
  if (PRESSED) await ev(PRESS);
  await sleep(200);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
  await writeFile(join(OUT, name + ".json"), JSON.stringify(await ev(DUMP)));
  console.log("shot", name);
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
  const only = process.env.ONLY; // e.g. ONLY=pull: just the routes whose name holds it
  for (const theme of THEMES) for (const route of ROUTES) if (!only || route.includes(only)) await run("app", theme, route);
  if (!only) for (const route of ["home", "settings"]) await run("site", THEMES[0], route);
} finally { await cleanup(); }
