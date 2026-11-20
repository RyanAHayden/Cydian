// B169's Chromium check: open the site, tap a Home link, and log whether a push slide ran (a .page.is-moving appears)
// and where the route went.   node probe.mjs <base url> <selector> [text] [native]
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, sel, text = "", native = ""] = process.argv.slice(2);
const prof = await mkdtemp(join(tmpdir(), "b169-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (ws) await new Promise((r) => ws.addEventListener("open", r));
  else await sleep(200);
}
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.enable");
if (native) await send("Page.addScriptToEvaluateOnNewDocument", { source: native });
await send("Page.navigate", { url: base });
await sleep(3000);
// moves: class changes while a page slides; slideMs: how long .page.is-moving stayed on (a push is DURATION, ~350 ms;
// near 0 means the slide was cut short and the page jumped into place).
await ev(`window.__moves = 0; window.__slideMs = []; let since = null; new MutationObserver(() => { const on = !!document.querySelector('.page.is-moving'); if (on) window.__moves++; if (on && since == null) since = performance.now(); if (!on && since != null) { window.__slideMs.push(Math.round(performance.now() - since)); since = null; } }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] }); 1`);
console.log("before", await ev("location.hash"));
if (process.env.SHOT) { const { writeFile } = await import("node:fs/promises"); const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(process.env.SHOT, Buffer.from(r.result.data, "base64")); }
const tap = async (expr) => { // a real mouse press and release at the element's centre (the tap guard ignores el.click())
  const at = await ev(`(()=>{const e=${expr}; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2, e.getAttribute('href')||e.textContent]})()`);
  if (!at) return "none";
  await sleep(300);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return at[2];
};
// PRE: steps before the tap, as JSON: [{ "hash": "#/installed/myipas" } | { "tap": "css" }]
for (const s of JSON.parse(process.env.PRE || "[]")) {
  if (s.hash) await ev(`location.hash = ${JSON.stringify(s.hash)}`);
  if (s.tap) console.log("pre-tap", await tap(`document.querySelector(${JSON.stringify(s.tap)})`));
  await sleep(900);
  console.log("pre", await ev("location.hash"));
}
await ev("window.__moves = 0; window.__slideMs = []");
console.log("tap", await tap(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.offsetParent&&e.textContent.includes(${JSON.stringify(text)})).at(-1)`));
if (process.env.MID) { // freeze the slide at 40% and shoot it
  await sleep(60);
  console.log("anims", await ev(`(()=>{const a=document.getAnimations(); a.forEach(x=>{x.pause(); x.currentTime=140}); return a.length})()`));
  await sleep(100);
  const { writeFile } = await import("node:fs/promises"); const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(process.env.MID, Buffer.from(r.result.data, "base64"));
  await ev(`document.getAnimations().forEach(x=>x.play())`);
}
await sleep(1200);
console.log("after",await ev("location.hash"), "moves", await ev("window.__moves"), "slideMs", await ev("JSON.stringify(window.__slideMs.splice(0))"), "title", await ev("document.title"));
await ev("window.__moves = 0");
console.log("back", await tap(`document.querySelector('.nav-item.is-top .back')`));
await sleep(1200);
console.log("after back", await ev("location.hash"), "moves", await ev("window.__moves"), "slideMs", await ev("JSON.stringify(window.__slideMs)"));
// POST: steps after Back, as JSON: [{ "tap": "css" } | { "eval": "js" }]
for (const s of JSON.parse(process.env.POST || "[]")) {
  if (s.tap) { console.log("post-tap", await tap(`document.querySelector(${JSON.stringify(s.tap)})`)); await sleep(900); }
  if (s.eval) console.log("post-eval", JSON.stringify(await ev(s.eval)));
}
ws.close(); chrome.kill(); process.exit(0);
