// F248: renders Settings > Signing's Password group on the website (web/app served over http) at 402x874 @3x in
// headless Chromium over CDP, one shot per state and theme. A cut-down journal/2026-11-18-t12-readme-shots/capture.mjs
// (no native bridge) with one more step, "files": real files into a file input (DOM.setFileInputFiles), so a pick
// runs chooseFiles as a person's would.
//
//   node shots.mjs <base url ending in web/app/> <outdir> <script.json>
//
// steps: { "nav": "#/x", "ms" } | { "wait": ms } | { "eval": "js" } | { "files": ["/abs/path"], "into": "css" } | { "shot": "name" }
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [base, outdir, scriptFile] = process.argv.slice(2);
const steps = JSON.parse(await readFile(scriptFile, "utf8"));
const prof = await mkdtemp(join(tmpdir(), "f248-prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} };
process.on("exit", cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") console.log("page exception:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };

await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.navigate", { url: base });
await sleep(3000);
for (const s of steps) {
  if (s.nav !== undefined) { await send("Page.navigate", { url: base + "?r=" + (++id) + s.nav }); await sleep(s.ms ?? 4000); }
  else if (s.wait) await sleep(s.wait);
  else if (s.eval) console.log("eval:", String(JSON.stringify(await ev(s.eval))).slice(0, 2000));
  else if (s.files) {
    const doc = await send("DOM.getDocument", { depth: -1, pierce: true });
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: s.into });
    const r = await send("DOM.setFileInputFiles", { files: s.files, nodeId: q.result?.nodeId });
    console.log("files", s.into, r.error ? r.error.message : "ok");
    await sleep(s.ms ?? 3000);
  }
  else if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, s.shot + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot", s.shot); }
}
ws.close(); cleanup();
await sleep(500);
await rm(prof, { recursive: true, force: true });
process.exit(0);
