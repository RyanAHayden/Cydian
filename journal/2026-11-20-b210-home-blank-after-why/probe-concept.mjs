// B210 in the concept tool: a built --standalone concept page (tools/concept/build.py), Lite mode, dark; Home > Why,
// then the Home tab; log what Home draws and shoot each step.
//   node probe-concept.mjs PAGE.html [shot prefix] [theme, default dark:gunmetal] [mode, default sideload]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [PAGE, shot = "", theme = "dark:gunmetal", mode = "sideload"] = process.argv.slice(2);
const page = await readFile(PAGE);
// SANDBOX=1: serve it sandboxed (an opaque origin, as in the Artifact viewer's frame): IndexedDB refuses there
const headers = { "Content-Type": "text/html; charset=utf-8", ...(process.env.SANDBOX ? { "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-modals" } : {}) };
const server = createServer((req, res) => res.writeHead(200, headers).end(page));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const prof = await mkdtemp(join(tmpdir(), "b210c-"));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };
// The phone's frame runs in its own execution context (the newest default context that isn't the top frame's): a
// sandboxed page gives no contentDocument, so evaluate there instead.
const contexts = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.method === "Runtime.executionContextCreated" && m.params.context.auxData?.isDefault) contexts.push(m.params.context);
  if (m.method === "Runtime.executionContextDestroyed") { const i = contexts.findIndex((c) => c.id === m.params.executionContextId); if (i >= 0) contexts.splice(i, 1); } });
let topFrame = null;
const inApp = async (body) => {
  const c = contexts.filter((x) => x.auxData.frameId !== topFrame).at(-1);
  if (!c) return "no frame context";
  const r = await send("Runtime.evaluate", { expression: `(() => { const d = document, w = window; ${body} })()`, contextId: c.id, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text;
};
await send("Page.enable"); await send("Runtime.enable");
topFrame = (await send("Page.getFrameTree")).result.frameTree.frame.id;
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(1000);
if (process.env.BEFORE) console.log("before:", await ev(`(() => { const b = [...document.querySelectorAll("#version button")].find((x) => /before/i.test(x.textContent)); b?.click(); return b?.textContent ?? "no toggle"; })()`));
await sleep(process.env.BEFORE ? 3000 : 0);
await ev(`document.getElementById("mode-${mode}").click()`);
await ev(`(() => { const s = document.getElementById("theme"); s.value = ${JSON.stringify(theme)}; s.dispatchEvent(new Event("change")); })()`);
await sleep(4000);
async function tap(js) {
  const el = await inApp(`const e = (${js})(d); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.trim().slice(0, 30) };`);
  if (!el || typeof el !== "object") return el;
  const fr = await ev(`(() => { const f = document.getElementById("app"), b = f.getBoundingClientRect(); return { left: b.left, top: b.top, k: b.width / f.offsetWidth }; })()`);
  const at = { x: fr.left + el.x * fr.k, y: fr.top + el.y * fr.k, text: el.text };
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  return at.text;
}
const snap = (label) => inApp(`const hs=[...d.querySelectorAll('.home')]; return ${JSON.stringify(label)} + ' hash=' + w.location.hash + ' homes=' + hs.length + ' ' + hs.map(h => '[' + [...h.children].map(c => (c.className||c.tagName).toString().slice(0,24) + (c.hidden?'(hidden)':'') + ':' + Math.round(c.getBoundingClientRect().height) + '@' + Math.round(c.getBoundingClientRect().top)).join(', ') + '] page=' + (h.closest('.page')?.className ?? '') + ' scrollTop=' + h.closest('.page-body')?.scrollTop + ' bodyH=' + Math.round(h.closest('.page-body')?.getBoundingClientRect().height)).join(' | ');`);
const shoot = async (name) => { if (!shot) return; const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(`${shot}-${name}.png`, Buffer.from(r.result.data, "base64")); };
const HOME_TAB = `(d) => [...d.querySelectorAll('#tabbar a, .tabbar a, #tabbar button, .tabbar button')].find((e) => /home/i.test(e.getAttribute('href') || e.textContent))`;
if (!(await inApp(`return w.location.hash.startsWith('#/home')`))) { console.log("to home", await tap(HOME_TAB)); await sleep(1500); }
// HOMESCROLL=px: scroll Home down that far before tapping Why (the tile must stay on screen)
if (process.env.HOMESCROLL) { console.log("home scroll", await inApp(`const b = d.querySelector('.home').closest('.page-body'); b.scrollTop = ${Number(process.env.HOMESCROLL)}; return b.scrollTop`)); await sleep(500); }
console.log(await snap("start"));
await shoot("1-home");
console.log("tap why", await tap(`(d) => [...d.querySelectorAll('.why a')].find((e) => e.getClientRects().length)`));
// WAIT: ms on Why before the tab tap (short = mid-slide); SCROLL=1: scroll Why's page to its end first
await sleep(Number(process.env.WAIT ?? 1500));
if (process.env.SCROLL) console.log("scroll", await inApp(`const b = [...d.querySelectorAll('.page.is-top .page-body')].at(-1); b.scrollTop = b.scrollHeight; return b.scrollTop`));
await sleep(process.env.SCROLL ? 600 : 0);
console.log(await snap("on why"));
await shoot("2-why");
console.log("tap tab", await tap(HOME_TAB));
await sleep(1500);
console.log(await snap("after tab"));
await shoot("3-after");
for (const l of logs) console.log(l);
ws.close(); chrome.kill(); server.close(); process.exit(0);
