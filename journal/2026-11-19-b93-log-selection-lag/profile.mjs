// node profile.mjs <harness url> : headless Chromium, a trace while the harness runs; prints its result and the
// renderer main thread's tasks over 16 ms in the measured (selection active) window.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const url = process.argv[2];
const prof = await mkdtemp(join(process.argv[3] || tmpdir(), "chr-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--window-size=402,874", "about:blank"], { stdio: "ignore" });
const done = (code) => { try { chrome.kill(); } catch {} process.exit(code); };
setTimeout(() => { console.error("timeout"); done(2); }, 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const events = []; let traceDone;
const traceEnd = new Promise((r) => { traceDone = r; });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
  else if (m.method === "Tracing.tracingComplete") traceDone();
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Tracing.start", { categories: "devtools.timeline,toplevel", transferMode: "ReportEvents" });
await send("Page.navigate", { url });
let result = null;
for (let i = 0; i < 100 && !result; i++) {
  await sleep(200);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__result ?? null)", returnByValue: true });
  result = JSON.parse(r.result?.result?.value ?? "null");
}
await send("Tracing.end");
await traceEnd;
const names = new Map();
for (const e of events) if (e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args?.name);
const main = (e) => names.get(`${e.pid}:${e.tid}`) === "CrRendererMain";
const tasks = events.filter((e) => main(e) && e.ph === "X" && /RunTask/.test(e.name) && e.dur);
// the measured window: the last 4 s of tasks before the result was ready (the harness measures 4 s after 1.5 s)
const end = Math.max(...tasks.map((t) => t.ts + t.dur));
const win = tasks.filter((t) => t.ts > end - 4_000_000 - 200_000);
const over = win.filter((t) => t.dur > 16_000).map((t) => Math.round(t.dur / 1000));
console.log(JSON.stringify({ ...result, tasksInWindow: win.length, tasksOver16ms: over.length, worstTaskMs: Math.round(Math.max(0, ...win.map((t) => t.dur)) / 1000), over }));
done(0);
