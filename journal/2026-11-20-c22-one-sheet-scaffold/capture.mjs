// C22's before/after check: open each sheet built on nav/sheet.js (Confirm, Write a Review, the progress page, the
// Install sheet) in headless Chromium at 402x874@3x over the site, record the sheet's slide (Web Animations: duration,
// easing, keyframes), shoot it mid-slide (paused at 140 ms) and settled, and print the bar's DOM shape.
//   node capture.mjs <base url of web/app> <out dir>
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const prof = await mkdtemp(join(tmpdir(), "c22-"));
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
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result?.exceptionDetails?.text; };
const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, file), Buffer.from(r.result.data, "base64")); };
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.enable");

const INFO = JSON.stringify({ token: "tok1", app: { name: "Delta", bundleId: "com.rileytestut.Delta", version: "1.6", minimumOS: "14.0", size: 52000000,
  entitlements: { "application-identifier": "X.com.rileytestut.Delta" }, permissions: [{ key: "NSCameraUsageDescription", label: "Camera", text: "Scan QR codes." }],
  extensions: [{ path: "PlugIns/Share.appex", bundleId: "com.rileytestut.Delta.Share", name: "Share", point: "com.apple.share-services" }] }, icon: null });

const SHEETS = {
  confirm: `const q = await import('./screens/queue.js'); const ui = await import('./nav/ui.js');
    const m = q.modal({ title: 'Confirm', left: q.confirmCancel(), right: ui.barButton('Confirm', 'done'), cls: 'confirm-sheet' });
    m.scroll.append(ui.grouped([{ header: 'Modifications', rows: [{ label: 'Install: Example Tweak' }], footer: 'One package.' }]));`,
  review: `(await import('./screens/reviews.js')).writeReviewSheet({ version: '1.2', initial: { stars: 4, title: 'Nice', name: 'Ry', text: 'Works well.' }, onDelete: async () => {} });`,
  progress: `const p = (await import('./nav/progress.js')).openProgress(); p.line('step', 'Downloading Example Tweak'); p.line('raw', 'Get:1 https://repo.example.com ./ example 1.0');
    p.status('Installing'); p.progress(40); p.cancellable(true);`,
  sign: `(await import('./signing-sheet.js')).inspectAndInstall({ url: 'https://example.com/Delta.ipa', name: 'Delta' },
    { native: { call: async () => (${INFO}) }, hud: () => ({ set() {}, hide() {} }) });`,
};
const shape = `(() => { const s = [...document.querySelectorAll('.sheet')].at(-1); if (!s) return null;
  const row = s.querySelector('.sheet-bar-row');
  return { cls: s.className, label: s.getAttribute('aria-label'), body: s.querySelector(':scope > :last-child').className,
    row: [...row.children].map((c) => c.className + ':' + [...c.children].map((b) => b.textContent).join('|')) }; })()`;
const anims = `JSON.stringify(document.getAnimations().filter((a) => a.effect?.target?.classList?.contains('sheet')).map((a) => {
  const t = a.effect.getTiming(); return { duration: t.duration, easing: t.easing, fill: t.fill, frames: a.effect.getKeyframes().map((k) => k.transform) }; }))`;

for (const [name, code] of Object.entries(SHEETS)) {
  await send("Page.navigate", { url: `${base}/index.html` });
  await sleep(2500);
  await ev(`(async () => { ${code} })()`);
  // the slide up, frozen at 140 ms
  console.log(name, "open", await ev(anims));
  await ev(`document.getAnimations().forEach((a) => { if (a.effect?.target?.classList?.contains('sheet')) { a.pause(); a.currentTime = 140; } }); 1`);
  await sleep(150);
  await shot(`${name}-mid.png`);
  await ev(`document.getAnimations().forEach((a) => { if (a.effect?.target?.classList?.contains('sheet')) a.finish(); }); 1`);
  await sleep(800);
  await shot(`${name}.png`);
  console.log(name, "shape", JSON.stringify(await ev(shape)));
}
process.exit(0);
