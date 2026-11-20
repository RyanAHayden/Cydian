// B210's Chromium check: Home > Why, then the Home tab; log what Home draws (its groups, visible or not) and shoot it.
//   node probe.mjs <base url> <sideload|jailbreak|site> [shot prefix]
// A minimal fake bridge (every call -> null) for the app modes; the site gets firstVisit=later? no: left fresh, as a
// visitor sees it (set FIRST=later to unlock).
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, mode = "sideload", shot = ""] = process.argv.slice(2);
const prof = await mkdtemp(join(tmpdir(), "b210-"));
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
const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };
const BRIDGE = `globalThis.ifizboxApp = true; globalThis.ifizboxNative = { call: () => Promise.resolve(null), jailbreak: ${mode === "jailbreak" ? '"rootless"' : "null"}, mode: ${JSON.stringify(mode)}, emit() {}, helper: () => Promise.resolve(null), dpkgStatus: () => Promise.resolve("") };`;
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.enable");
await send("Runtime.enable");
let pre = `try { localStorage.setItem("ifizbox.appearance", ${JSON.stringify(process.env.APPEARANCE ?? "dark")}); ${process.env.FIRST ? `localStorage.setItem("ifizbox.firstVisit", ${JSON.stringify(process.env.FIRST)});` : ""} } catch {}`;
if (mode !== "site") pre += BRIDGE;
await send("Page.addScriptToEvaluateOnNewDocument", { source: pre });
await send("Page.navigate", { url: base + "#/home" });
await sleep(3000);
const snap = (label) => ev(`(()=>{ const hs=[...document.querySelectorAll('.home')]; return ${JSON.stringify(label)} + ' hash=' + location.hash + ' homes=' + hs.length + ' ' + hs.map(h => '[' + [...h.children].map(c => (c.className||c.tagName).toString().slice(0,24) + (c.hidden?'(hidden)':'') + ':' + Math.round(c.getBoundingClientRect().height)).join(', ') + '] connectedPage=' + !!h.closest('.page') + ' pageClass=' + (h.closest('.page')?.className ?? '') + ' op=' + getComputedStyle(h).opacity).join(' | '); })()`);
const shoot = async (name) => { if (!shot) return; const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(`${shot}-${name}.png`, Buffer.from(r.result.data, "base64")); };
const tap = async (expr) => {
  const at = await ev(`(()=>{const e=${expr}; if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2, e.getAttribute('href')||e.textContent]})()`);
  if (!at) return "none";
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
  return at[2];
};
console.log(await snap("start"));
await shoot("1-home");
console.log("tap why", await tap(`[...document.querySelectorAll('.why a')].find(e => e.offsetParent)`));
await sleep(1500);
console.log(await snap("on why"));
await shoot("2-why");
console.log("tap tab", await tap(`[...document.querySelectorAll('#tabbar a, .tabbar a, #tabbar button, .tabbar button')].find(e => /home/i.test(e.getAttribute('href') || e.textContent))`));
await sleep(1500);
console.log(await snap("after tab"));
await shoot("3-after");
for (const l of logs) console.log(l);
ws.close(); chrome.kill(); process.exit(0);
