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
// --native: a stand-in for the jailbreak app's shell that answers every call with null (no apt state), to run the
// app's own startup path (the install queue, the .ipa links) rather than the website's.
if (args.includes("--native")) await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { jailbreak: "rootless", mode: "jailbreak", call: async () => null, emit() {},
    helper: async () => null, dpkgStatus: async () => null };` });
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

const results = [];
for (let i = 0; i < runs; i++) {
  await send("Page.navigate", { url: `${base}?run=${i}#/home` }); // a new query each run: a hash alone doesn't reload
  let r = null;
  for (let t = 0; t < 200 && !r; t++) { await sleep(100); r = await ev("window.__f313 && window.__f313.drawn ? JSON.stringify(window.__f313) : null"); }
  if (!r) { console.log(`run ${i + 1}: the first page never drew in 20 s`, errors); await done(1); }
  const fcp = await ev("performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null");
  const f = JSON.parse(r);
  results.push({ fcp, drawn: f.drawn, scripts: f.scripts });
  console.log(`run ${i + 1}: first contentful paint ${Math.round(fcp)} ms, first page drawn ${Math.round(f.drawn)} ms, ${f.scripts} scripts by then`);
}
const med = (k) => { const v = results.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
console.log(`median: first contentful paint ${Math.round(med("fcp"))} ms, first page drawn ${Math.round(med("drawn"))} ms, ${med("scripts")} scripts`);

// A few routes, each checked for a drawn page (the top page's body has content, its title in the nav bar).
await sleep(3000); // the background load
const allScripts = await ev("performance.getEntriesByType('resource').filter((e) => /\\.js$/.test(e.name)).length");
console.log(`scripts after the background load: ${allScripts}`);
const top = `(() => { const s = document.querySelector('.tab-stack.is-active'); const p = s && [...s.querySelectorAll('.page')].at(-1);
  const n = document.querySelector('.nav-stack.is-active'); const t = n && [...n.querySelectorAll('.nav-title')].at(-1);
  return JSON.stringify({ title: t?.textContent ?? null, children: p?.querySelector('.page-body')?.childElementCount ?? 0 }); })()`;
for (const hash of ["#/installed", "#/changes", "#/sources", "#/search", "#/home", "#/home/settings", "#/home/settings/general", "#/home/browse", "#/home/guides"]) {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(1200);
  console.log(`${hash}: ${await ev(top)}`);
}
// A deep link at launch to a lazily loaded page.
await send("Page.navigate", { url: base + "#/installed/myipas" });
await sleep(4000);
console.log(`deep link #/installed/myipas: ${await ev(top)}`);
console.log(errors.length ? `errors:\n  ${[...new Set(errors)].join("\n  ")}` : "errors: none");
await done(0);
