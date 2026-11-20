// Runs the harness in headless Chromium (a dry run before the phone): node chromium.mjs URL
// Prints the results JSON once every run is in. Needs `chromium` on PATH.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "r44-"));
const chrome = spawn("chromium", ["--headless", "--no-first-run", "--window-size=375,667", `--remote-debugging-port=${port}`,
  `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
}
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.navigate", { url });
const deadline = Date.now() + 240000;
let out = null;
while (Date.now() < deadline) {
  await sleep(2000);
  const r = await send("Runtime.evaluate", { expression: "document.querySelector('.r44-out') ? localStorage.getItem('r44.results') : ''", returnByValue: true });
  if (r.result?.result?.value) { out = r.result.result.value; break; }
}
console.log(out ?? "timed out");
chrome.kill();
process.exit(out ? 0 : 1);
