// My IPAs in the sideload app ("Lite") with long file names, at 390x844 CSS px and DPR 3 in headless Chromium.
// The shell is a stub answering in the page: library.list gives the IPAs below (no name parsed, so the rows show
// their file names), everything else null.
//
//   node shot.mjs <base url of web/app> <outdir> [width]
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir, w = "390"] = process.argv.slice(2);
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const exited = new Promise((r) => chrome.on("exit", r));
const done = async (code) => { try { chrome.kill(); } catch {} await exited; await rm(prof, { recursive: true, force: true }); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
if (!ws) { console.error("no chromium"); await done(1); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const IPAS = [
  { file: "opentennis-beta-p146.ipa", size: 48213000, version: "0.1", bundleId: "com.example.opentennis" },
  { file: "SomeVeryLongApplicationName-iOS-universal-build-2026.11.19-release.ipa", size: 120400000, version: "3.2", bundleId: "com.example.long" },
  { file: "Short.ipa", size: 2100000, version: "1.0", bundleId: "com.example.short" },
  { name: "A Named App With A Rather Long Display Name Indeed", file: "named.ipa", size: 5000000, version: "2.0", bundleId: "com.example.named" },
];
const STUB = `(() => {
  const ipas = ${JSON.stringify(IPAS)};
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", jailbreak: "none",
    call: async (m) => (m === "library.list" ? { ipas, identity: true } : null), emit() {} };
})();`;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: Number(w), height: 844, deviceScaleFactor: 3, mobile: true });
await send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("shot", name);
};
await send("Page.navigate", { url: `${base}/index.html#/installed/myipas` });
await sleep(4000);
console.log(JSON.stringify(await ev(`[...document.querySelectorAll(".midtrunc")].map((e) => [e.dataset.full, e.textContent, e.clientWidth])`)));
await shot(`myipas-${w}`);
await send("Page.navigate", { url: `${base}/index.html#/installed/myipas/ipa:${encodeURIComponent(IPAS[1].file)}` });
await sleep(3000);
await shot(`page-${w}`);
await done(0);
