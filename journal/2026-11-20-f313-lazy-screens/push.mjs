// F313: time to the first page on the site, and what loads for it, in headless Chromium over CDP.
//
//   node firstpaint.mjs <base url> [runs] [--slow]
//
// An iPhone user agent and 402x874 at DPR 3 (as the README captures), browsing unlocked (ifizbox.firstVisit=later),
// cache disabled so every run fetches every module. --slow: 4x CPU throttle and 40 ms of latency per request, roughly
// a phone on Wi-Fi. Prints, per run: ms to first contentful paint, ms until #boot (the loading screen) is gone (the
// first page drawn), and the scripts fetched by then; then the medians.
// Then, on the last run, it opens a few routes (a tab, Browse, Settings, a push from Home) and checks each drew.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const slow = args.includes("--slow");
const [base, runsArg] = args.filter((a) => !a.startsWith("--"));
const runs = Number(runsArg || 5);
const prof = await mkdtemp(join(process.env.SCRATCH || tmpdir(), "prof-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = async (code) => { try { chrome.kill(); } catch {} await sleep(300); await rm(prof, { recursive: true, force: true }); process.exit(code); };
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const handlers = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) for (const h of handlers) h(m);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

const errors = [];
handlers.push((m) => {
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
if (slow) {
  await send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 10e6 / 8 });
}
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  try { localStorage.setItem("ifizbox.firstVisit", "later"); } catch {}
  window.__f313 = {};
  new MutationObserver((_, o) => {
    if (document.readyState !== "loading" && !document.getElementById("boot") && !window.__f313.drawn) {
      window.__f313.drawn = performance.now();
      window.__f313.scripts = performance.getEntriesByType("resource").filter((e) => e.initiatorType === "script" || /\\.js$/.test(e.name)).length;
      o.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });` });

// push.mjs: a push to a page whose module is still loading slides in drawn.
//   node push.mjs <base url> [delay ms] [wait ms]
// screens/browse.js is held back <delay> ms (CDP Fetch). Right after Home draws, the Browse tile is clicked; every
// frame after, the newest page on Home's stack is checked: when it first exists, has its body content?
const delay = Number(args.filter((a) => !a.startsWith("--"))[1] || 800);
await send("Fetch.enable", { patterns: [{ urlPattern: "*screens/browse.js*" }] });
// --fail-once: the first request for browse.js fails instead, so the route shows without it (lazy.js NotLoaded, the
// empty page) and app.js drawPage draws it once a second load gets through.
let failNext = args.includes("--fail-once");
handlers.push((m) => {
  if (m.method !== "Fetch.requestPaused") return;
  if (failNext) { failNext = false; send("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "ConnectionReset" }); return; }
  setTimeout(() => send("Fetch.continueRequest", { requestId: m.params.requestId }), delay);
});
await send("Page.navigate", { url: `${base}?push=1#/home` });
let drawn = null;
for (let t = 0; t < 200 && !drawn; t++) { await sleep(50); drawn = await ev("window.__f313 && window.__f313.drawn || null"); }
await sleep(Number(args.filter((a) => !a.startsWith("--"))[2] || 0)); // [wait ms]: a tap that much after Home drew
const r = await ev(`new Promise((done) => {
  const stack = document.querySelector('.tab-stack[data-tab="home"]');
  const before = stack.querySelectorAll('.page').length;
  const link = document.querySelector('a[href="#/home/browse"]');
  if (!link) return done("no Browse link on Home");
  const t0 = performance.now();
  link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }));
  link.click();
  const frames = [];
  const look = () => {
    const pages = stack.querySelectorAll('.page');
    if (pages.length > before) {
      const p = pages[pages.length - 1];
      return done(JSON.stringify({ ms: Math.round(performance.now() - t0), children: p.querySelector('.page-body').childElementCount,
        moving: p.classList.contains('is-moving'), title: [...document.querySelectorAll('.nav-stack[data-tab="home"] .nav-title')].at(-1)?.textContent }));
    }
    if (performance.now() - t0 > 5000) return done("no page in 5 s");
    requestAnimationFrame(look);
  };
  look();
})`);
console.log(`Browse held back ${delay} ms; the pushed page first appeared: ${r}`);
await sleep(1500);
console.log(`1.5 s later: ${await ev(`JSON.stringify({ children: [...document.querySelectorAll('.tab-stack[data-tab="home"] .page')].at(-1).querySelector('.page-body').childElementCount,
  title: [...document.querySelectorAll('.nav-stack[data-tab="home"] .nav-title')].at(-1)?.textContent })`)}`);
console.log(errors.length ? `errors:\n  ${[...new Set(errors)].join("\n  ")}` : "errors: none");
await done(0);
