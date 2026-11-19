// F244: render Home's certificate tile in each stage as the sideload build (fake ifizboxNative, mode "sideload"),
// at 402x874 CSS px, DPR 3, in headless Chromium over CDP.  node certshots.mjs <base url> <outdir>
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = () => { try { chrome.kill(); } catch {} };
process.on("exit", done);
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
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

// The stage comes from ?days=N (certificate) / &prof=N (profile), days from now; &theme=dark; &off=1 (switch off).
const BRIDGE = `(() => {
  const q = new URLSearchParams(location.search);
  const at = (d) => new Date(Date.now() + Number(d) * 864e5).toISOString();
  const identity = { name: "Ryan Hayden", team: "TEAM", expires: at(q.get("days") ?? 300),
    profile: { name: "Wildcard", team: "TEAM", appId: "TEAM.*", devices: 1, expires: at(q.get("prof") ?? 300) } };
  localStorage.setItem("ifizbox.appearance", q.get("theme") || "light");
  localStorage.setItem("ifizbox.showExpiryWarning", q.get("off") ? "false" : "true");
  const answer = (m) => m === "signing.status" ? { identity, server: "https://example.invalid" } : null;
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call: (m) => new Promise((r) => setTimeout(() => r(answer(m)), 5)) };
})();`;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 402, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 62, bottom: 34, left: 0, right: 0 } }).catch(() => {});
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
const shots = [
  ["soon", "?days=6.5"], ["close", "?days=1.5"], ["gone", "?days=-2"], ["profile-soon", "?days=300&prof=4.5"],
  ["soon-dark", "?days=6.5&theme=dark"], ["close-dark", "?days=1.5&theme=dark"], ["gone-dark", "?days=-2&theme=dark"],
  ["off-soon", "?days=1.5&off=1"], ["off-gone", "?days=-2&off=1"], ["far", "?days=60"],
];
for (const [name, q] of shots) {
  await send("Page.navigate", { url: base + q + "#/home" });
  await sleep(3500);
  const info = await ev(`(() => { const r = document.querySelector(".home-row.cert"); return r ? (r.hidden ? "hidden" : r.className + " | " + r.innerText.replace(/\\n/g, " / ")) : "none"; })()`);
  console.log(name, "->", info);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outdir, name + ".png"), Buffer.from(r.result.data, "base64"));
}
// Settings > Signing's expiry group, switch on, then off
for (const [name, q] of [["settings-on", "?days=6.5"], ["settings-off", "?days=6.5&off=1"]]) {
  await send("Page.navigate", { url: base + q + "#/home/settings/signing" });
  await sleep(3500);
  const info = await ev(`(() => { const s = [...document.querySelectorAll(".cell")].filter((c) => /Expiry Warning/.test(c.innerText)); s[0]?.scrollIntoView({ block: "center" }); return s.map((c) => c.innerText.replace(/\\n/g, " ") + (c.hidden ? " [hidden]" : "")).join(" | "); })()`);
  console.log(name, "->", info);
  await sleep(400);
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outdir, name + ".png"), Buffer.from(r.result.data, "base64"));
}
done();
process.exit(0);
