#!/usr/bin/env node
// B202 repro (a copy of tools/smoke/smoke.mjs with its scenario swapped): the sideload app (fake bridge, mode
// "sideload") in headless Chromium, Search "dislike" (Canister answered from core/fixtures/f305), tap the tweak in
// Other Sources · Canister, tap View Repo, then check the page still answers, the repo page shows, its Tweaks
// sheet opens, Back and the Sources tab work.
//
//   node journal/2026-11-20-b202-view-repo-freeze/repro.mjs [web/app dir] [--shots DIR]
//   env: TOUCH=1 CDP touch taps instead of mouse; REAL=1 ask the real api.canister.me (through the script's own
//        /proxy); Q=<query> ROW=<text of the row to tap>; WAITCOUNT=1 time the Tweaks count and log long tasks;
//        LOGAPI=1 log the site's unanswered /api calls and what Canister's search gave.
// --site: the website with Device Jailbroken and Works on My Phone off (the fixture's Keycap row is for another
// architecture). It has no View Repo from Search, so it checks that the Other Sources row's alert opens, goes and
// opens again.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; args.splice(i, 1); return true; };
const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const SITE = flag("--site");
const KEEP = flag("--keep");
const SHOTS = opt("--shots");
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(args[0] ?? join(here, "../../web/app"));
const CHROME = process.env.CHROMIUM ?? "chromium";

// Animated properties that make the browser lay out again every frame.
const LAYOUT = /^(height|width|(min|max)-(height|width)|top|right|bottom|left|inset(-.*)?|margin(-.*)?|padding(-.*)?|flex(-basis|-grow|-shrink)?|grid(-.*)?|gap|row-gap|column-gap|font-size|line-height|letter-spacing|word-spacing|border(-(top|right|bottom|left))?-width|border-width|block-size|inline-size|(min|max)-(block|inline)-size|all)$/;
export const isLayoutProperty = (p) => LAYOUT.test(p);

// --- static server ---------------------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/proxy") {
    try { const r = await fetch(url.searchParams.get("url")); const b = Buffer.from(await r.arrayBuffer()); res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: r.status, body: b.toString("base64"), headers: {} })); }
    catch (e) { res.writeHead(200).end(JSON.stringify({ status: 599, body: "", headers: {} })); }
    return;
  }
  // The site's proxy, for Canister's package search only (from the fixture); everything else isn't here.
  if (url.pathname === "/api/fetch" && /package\/search/.test(url.searchParams.get("url") ?? "")) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(FIX)); return;
  }
  if (url.pathname.startsWith("/api/")) { if (process.env.LOGAPI) console.log("404", req.url.slice(0, 160)); res.writeHead(404).end(); return; }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

// --- Chromium over CDP ---------------------------------------------------------------------------------------------
const prof = await mkdtemp(join(tmpdir(), "ifizbox-smoke-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
let chromeFailed = null;
chrome.on("error", (e) => { chromeFailed = e; });
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bail = async (code, msg) => { console.error(msg); await cleanup(); process.exit(code); };

let ws;
for (let i = 0; i < 75 && !ws && !chromeFailed; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = list.find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(200);
}
if (!ws) await bail(2, `smoke: couldn't start ${CHROME}${chromeFailed ? `: ${chromeFailed.message}` : ""} (set CHROMIUM=<path>)`);

let nextId = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++nextId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n  ${expr}`);
  return r.result?.result?.value;
};

// Runs before any page script: the animation recorder, and the fake bridge for the app.
const RECORDER = `(() => {
  const rec = window.__smoke = { anims: [], moves: 0, seen: new WeakSet() };
  const name = (el) => el && el.nodeType === 1 ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : "") : String(el);
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const SKIP = new Set(["offset", "easing", "composite", "computedOffset"]);
  const note = (kind, target, props, extra) => rec.anims.push({ kind, target: name(target), props, extra, at: Math.round(performance.now()) });
  const fromAnim = (a, kind) => {
    if (rec.seen.has(a)) return; rec.seen.add(a);
    let props = [];
    try { props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !SKIP.has(x)).map(kebab)))]; } catch {}
    if (a.transitionProperty) props.push(a.transitionProperty);
    note(kind || a.constructor.name, a.effect && a.effect.target, [...new Set(props)], a.animationName || a.transitionProperty || "");
  };
  document.addEventListener("transitionrun", (e) => note("transitionrun", e.target, [e.propertyName]), true);
  document.addEventListener("animationstart", (e) => { note("animationstart", e.target, [], e.animationName); for (const a of e.target.getAnimations()) fromAnim(a); }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...a) { const r = animate.apply(this, a); fromAnim(r, "animate"); return r; };
  const poll = () => { try { for (const a of document.getAnimations()) fromAnim(a); } catch {} if (document.querySelector(".page.is-moving")) rec.moves++; requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
})();`;
const FIX = JSON.parse(await readFile(join(here, "../../web/app/core/fixtures/f305/package-dislike.json"), "utf8"));
const REPO = { data: { slug: "chariz", id: "chariz", name: "Chariz", uri: "https://repo.chariz.com/", suite: "./", tier: 1, package_count: 500 } };
const BRIDGE = `(() => {
  const FIX = ${JSON.stringify(FIX)}, REPO = ${JSON.stringify(REPO)};
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
  window.__calls = [];
  window.ifizboxNative = { mode: "sideload", call: async (m, p) => {
    window.__calls.push(m + " " + (p?.url ?? ""));
    if (m === "net.fetch" && ${process.env.REAL ? "true" : "false"} && /canister|tale\\.me/.test(p.url)) return (await fetch("/proxy?url=" + encodeURIComponent(p.url))).json();
    if (m === "net.fetch" && /canister|tale\\.me/.test(p.url)) {
      const u = p.url;
      const body = /package\\/search/.test(u) ? FIX : /repository\\/[^/?]+\\/packages/.test(u) ? { data: FIX.data } : /repository\\/[^/?]+/.test(u) ? REPO : { data: [] };
      return { status: 200, body: b64(JSON.stringify(body)), headers: {} };
    }
    return null;
  } };
})();`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
if (process.env.TOUCH) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER + (SITE ? `try { localStorage.setItem("ifizbox.firstVisit", "later"); localStorage.setItem("ifizbox.device", "iphoneos-arm64"); localStorage.setItem("ifizbox.worksOnMyPhone", "false"); } catch {}` : BRIDGE) });
await send("Page.navigate", { url: base + "#/home" });

const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100); } return false; };
const settle = () => until("!document.querySelector('.page.is-moving, .sheet.is-moving') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity)", 4000);
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return ok; };
const shot = async (n) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(SHOTS, n + ".png"), Buffer.from(r.result.data, "base64"));
};
const hash = () => ev("location.hash");
// The centre of the last visible element matching css (and holding text), scrolled into view; null if none.
const find = (css, text = "") => ev(`(() => {
  const e = [...document.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.offsetParent && x.getClientRects().length && x.textContent.includes(${JSON.stringify(text)})
    && !x.closest('.page:not(.is-top), [hidden], [aria-hidden=true]')).at(-1);
  if (!e) return null;
  e.scrollIntoView({ block: "center" });
  const r = e.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2];
})()`);
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1, pointerType: "mouse" });
const tap = async (css, text = "") => {
  const at = await find(css, text);
  if (!at) return false;
  await sleep(150);
  if (process.env.TOUCH) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at[0], y: at[1], id: 1 }] });
    await sleep(60);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    return true;
  }
  await mouse("mouseMoved", at[0], at[1], 0);
  await mouse("mousePressed", at[0], at[1]);
  await sleep(60);
  await mouse("mouseReleased", at[0], at[1], 0);
  return true;
};
const touch = (type, x, y) => send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
const swipeBack = async () => { // a finger from the left edge to two thirds across, over ~300 ms
  const y = 420;
  await touch("touchStart", 4, y);
  for (let x = 10; x <= 280; x += 15) { await sleep(16); await touch("touchMove", x, y); }
  await sleep(16);
  await touch("touchEnd", 280, y);
};
const resetMoves = () => ev("window.__smoke.moves = 0");
const moved = () => ev("window.__smoke.moves");

try {
  check(await until("document.querySelector('.page.is-top') && document.querySelector('#tabbar .tab')", 15000), "the app draws Home");
  await sleep(1500);
  await shot("1-home");
  await ev("location.hash = '#/search'");
  await until("document.querySelector('.page.is-top input[type=search]')", 5000);
  await settle();
  await ev(`(() => { const i = document.querySelector('.page.is-top input[type=search]'); i.focus(); i.value = ${JSON.stringify(process.env.Q ?? "dislike")}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  if (SITE) {
    // The website (Device: Jailbroken) has no View Repo from Search (offerTweak is the sideload app's): its Other
    // Sources row opens an alert (extras.js offer: Add Source & Install). Check that it answers and goes.
    check(await until("document.querySelector('.discovery .cell')", 8000), "Search shows Other Sources");
    if (process.env.LOGAPI) console.log("ask:", await ev(`import("./screens/extras.js").then((m) => m.canisterApi().search("dislike")).then((j) => "rows " + j?.data?.length, (e) => "error " + e.message)`));
    if (process.env.LOGAPI) console.log("rows:", await ev(`Promise.all([import("./core/canister.js"), import("./backend.js"), import("./screens/extras.js")]).then(async ([c, b, x]) => { const have = await b.getBackend().sources(); const j = await x.canisterApi().search("dislike"); return JSON.stringify(c.mapResults(j, { have, arch: b.getArch() }).map((r) => [r.name, r.repo.name, r.repo.added, r.archOk])); }, (e) => "error " + e.message)`));
    if (process.env.LOGAPI) console.log("group:", await ev(`import("./screens/extras.js").then(async (m) => { const g = m.discoveryGroup(null, { wait: 0 }); await g.search("dislike"); return g.el.textContent.slice(0, 200); }, (e) => "error " + e.message)`));
    if (process.env.LOGAPI) console.log("discovery:", await ev("[...document.querySelectorAll('.discovery')].map((d) => d.outerHTML.slice(0, 300)).join(' | ')"));
    await shot("2-search");
    check(await tap(".discovery .cell-inner", process.env.ROW ?? ""), "tap the package");
    check(await until("document.querySelector('.alert-scrim')", 3000), "the alert opens");
    await sleep(500);
    await shot("3-alert");
    check(await tap(".alert-button", "Cancel"), "tap Cancel");
    check(await until("!document.querySelector('.alert-scrim')", 3000), "the alert goes");
    check(await tap(".discovery .cell-inner", process.env.ROW ?? ""), "the row still answers");
    check(await until("document.querySelector('.alert-scrim')", 3000), "the alert opens again");
    await shot("4-again");
    check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ").slice(0, 600) : ""}`);
    throw null; // done: the shared ending below
  }
  check(await until("document.querySelector('.discovery-tweak')", 8000), "Search shows Other Sources · Canister");
  await shot("2-search");
  console.log("rows:", await ev("[...document.querySelectorAll('.discovery-tweak')].map(e => e.textContent).join(' | ')"));
  check(await tap(".discovery-tweak", process.env.ROW ?? ""), "tap the tweak");
  check(await until("document.querySelector('.action-sheet')", 3000), "sheet opens");
  await sleep(500);
  await shot("3-sheet");
  await ev("window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false })");
  check(await tap(".action-button", "View Repo"), "tap View Repo");
  if (process.env.WAITCOUNT) { const t = Date.now(); await until("(document.querySelector('.find-tweaks .cell-detail')?.textContent ?? '…') !== '…'", 60000); console.log("count after", Date.now() - t, "ms:", await ev("document.querySelector('.find-tweaks .cell-detail')?.textContent"), "long tasks", await ev("JSON.stringify(window.__long)")); }
  const t0 = Date.now();
  const alive = await Promise.race([ev("1").then(() => true), sleep(5000).then(() => false)]);
  check(alive, `page answers after View Repo (${Date.now() - t0} ms)`);
  await sleep(1500);
  const alive2 = await Promise.race([ev("location.hash").then((h) => h), sleep(5000).then(() => false)]);
  check(alive2, `page still answers: ${alive2}`);
  await shot("4-repo");
  console.log("at 4,420", await ev("(() => { const e = document.elementFromPoint(200, 300); return e ? e.tagName + '.' + e.className : 'nothing'; })()"));
  console.log("overlays", await ev("[...document.querySelectorAll('.action-scrim, .sheet, .scrim, [class*=guard], [class*=block]')].map(e => e.className + ' ' + getComputedStyle(e).pointerEvents).join(' | ')"));
  check(await tap(".cell", "Tweaks for Sideloaded Apps"), "tap Tweaks row");
  check(await until("document.querySelector('.sheet')", 3000), "tweaks sheet opens");
  await sleep(800); await shot("5-tweaks");
  check(await tap(".sheet .sheet-right *", "Done"), "Done");
  await sleep(800);
  check(await tap(".nav-item.is-top .back, .navbar .back"), "tap back");
  await sleep(1000);
  console.log("after back", await hash());
  await tap("#tabbar .tab", "Sources"); await sleep(800);
  console.log("after Sources tab", await hash());
  await shot("6-end");
  console.log("calls", (await Promise.race([ev("JSON.stringify(window.__calls.slice(-20))"), sleep(3000)])));
  console.log("errors", pageErrors);
  console.log("top", await Promise.race([ev("document.querySelector('.page.is-top')?.textContent.slice(0,300)"), sleep(3000)]));
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ").slice(0, 600) : ""}`);
} catch (e) {
  if (e !== null) failures.push(String(e?.stack ?? e));
  console.error(e);
}
ws.close();
await cleanup();
console.log(failures.length ? `smoke: ${failures.length} failed` : "smoke: passed");
process.exit(failures.length ? 1 : 0);
