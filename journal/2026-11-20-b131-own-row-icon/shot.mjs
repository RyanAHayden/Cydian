// Installed in headless Chromium with an in-page fake ifizboxNative (native/bridge.js's shape), one build per run.
//   node shot.mjs <base url> <jailbreak|sideload> <out.png>
// Prints the rows' labels with whether each has a loaded <img> in its .cell-icon (and its src).
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const [base, mode, out] = process.argv.slice(2);
const prof = await mkdtemp(join(tmpdir(), "b131-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const STATUS = ["Package: com.ryha.ifizbox", "Status: install ok installed", "Name: iFizBox", "Version: 0.9.9", "Section: Packaging", "Architecture: iphoneos-arm64", "",
  "Package: com.ex.tweak", "Status: install ok installed", "Name: Example Tweak", "Version: 1.0", "Section: Tweaks", "Architecture: iphoneos-arm64", ""].join("\n");
const BRIDGE = `(() => {
  const mode = ${JSON.stringify(mode)};
  const answers = { "app.info": { mode, version: "0.9.9" }, "signing.installed": { apps: [] }, "apt.dpkgStatus": ${JSON.stringify(STATUS)},
    "apt.sources": [], "apt.installDates": {}, "library.list": { ipas: [] } };
  const call = async (m, p) => { if (m in answers) return answers[m]; console.log("fake: null for " + m); return null; };
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { call, mode, jailbreak: mode === "jailbreak" ? "rootless" : undefined, emit() {},
    helper: async () => ({ code: 0, stdout: "", stderr: "" }), dpkgStatus: () => call("apt.dpkgStatus") };
})();`;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 2, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
await send("Page.navigate", { url: base + "#installed" });
await sleep(9000);
console.log(await ev(`JSON.stringify([...document.querySelectorAll('.cell')].filter(c=>c.offsetParent).map(c=>{const i=c.querySelector('.cell-icon img'); const l=c.querySelector('.cell-label, .cell-title')?.textContent||c.textContent.trim().slice(0,30); return l+' | img='+(i?(i.complete&&i.naturalWidth?'loaded ':'broken ')+i.getAttribute('src'):'none')+' | iconEl='+(c.querySelector('.cell-icon')?.className||'-')}),null,1)`));
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(shot.result.data, "base64"));
chrome.kill(); await sleep(500); await rm(prof, { recursive: true, force: true }).catch(() => {}); process.exit(0);
