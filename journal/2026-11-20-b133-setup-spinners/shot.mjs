// node shot.mjs <base url> <outdir> — B133: This iPhone's setup in headless Chromium (402x874 @3x) with a fake
// sideload ifizboxNative whose every reply is slowed (SLOW ms), shooting each step while it waits.
// Serve web/app first: python3 -m http.server <port> -d web/app --bind 127.0.0.1
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const W = 402, SLOW = 2500;
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = (c) => { try { chrome.kill(); } catch {} process.exit(c); };
setTimeout(() => { console.error("timeout"); done(2); }, 150000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("page:", m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

// Every call answers after SLOW ms. idevice.pair sends the code after SLOW, the "waiting" step after 2*SLOW, never ends
// until pairCancel. fake.status / fake.apps in localStorage.
const BRIDGE = `(() => {
  const SLOW = ${SLOW};
  const st = () => JSON.parse(localStorage.getItem("fake.status") || "{}");
  const later = (v) => new Promise((r) => setTimeout(() => r(typeof v === "function" ? v() : v), SLOW));
  let cancel = null;
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params, onEvent) {
    window.__calls = (window.__calls || []).concat(method);
    if (method === "idevice.status") return later(st);
    if (method === "idevice.vpnApps") return later({ localdevvpn: true, tailscale: false });
    if (method === "idevice.developerMode") return later({ on: true });
    if (method === "signing.status") return Promise.resolve({ identity: null });
    if (method === "idevice.pair") {
      setTimeout(() => onEvent?.([{ pin: "042917" }]), SLOW);
      setTimeout(() => onEvent?.([{ step: "advertised", text: "Waiting for the iPhone to connect (port 49152)." }]), 2 * SLOW);
      return new Promise((_, no) => { cancel = () => no(Object.assign(new Error("cancelled"), { code: "canceled" })); });
    }
    if (method === "idevice.pairCancel") { cancel?.(); return Promise.resolve(null); }
    if (method === "idevice.pairState") return Promise.resolve({ active: false });
    if (method === "idevice.forget") return later(() => { localStorage.setItem("fake.status", JSON.stringify({ paired: null, pairOnPhone: true, localDevVPN: false, tailscale: { connect: "auto" } })); return null; });
    return later(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
  const seen = await ev(`[...document.querySelectorAll(".page.is-top .loading, .page.is-top .cell-inner[aria-busy] , .hud-label")].map((e) => (e.classList.contains("hud-label") ? "HUD " : "") + e.textContent.trim()).join(" | ")`);
  console.log(name.padEnd(22), seen || "(no spinner)");
};
const open = async (status, route, path) => {
  await ev(`localStorage.setItem("fake.status", ${JSON.stringify(JSON.stringify(status))}); localStorage.setItem("ifizbox.installRoute", ${JSON.stringify(route)})`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#/home/${path}` });
};
const tapRow = (label) => ev(`(() => { const c = [...document.querySelectorAll(".page.is-top .cell-inner")].find((n) => n.querySelector(".cell-label")?.textContent === ${JSON.stringify(label)}); c?.click(); return Boolean(c); })()`);

const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: true, tailscale: { connect: "auto", signedIn: false } };
await send("Page.navigate", { url: base });
await sleep(3000);

// 1. Installation & Signing, This iPhone chosen: status, then Developer Mode, each slow
await open(PAIRED, "iphone", "settings/installation");
await sleep(1500); await shot("1-main-status");
await sleep(SLOW); await shot("2-main-devmode");
await sleep(SLOW); await shot("3-main-done");
await sleep(2 * SLOW); await shot("3b-main-later");
console.log("calls", await ev(`(window.__calls || []).join(",")`));
if (process.env.ONLY_MAIN) done(0);

// 2. This iPhone's page, paired: Checking…, then Check Connection and Forget Pairing under the HUD
await open(PAIRED, "iphone", "settings/installation/pair");
await sleep(1500); await shot("4-pair-checking");
await sleep(SLOW); await shot("5-pair-paired");
console.log("tap", await tapRow("Check Connection"));
await sleep(1000); await shot("6-check-hud");
await sleep(SLOW); await shot("7-check-answer");
await ev(`document.querySelector(".alert-button, .alert button")?.click()`);
await sleep(500);
console.log("tap", await tapRow("Forget Pairing"));
await sleep(1000); await shot("8-forget-hud");
await sleep(SLOW); await shot("9-forget-rechecks");
await sleep(SLOW + 500); await shot("10-vpn-wait");

// 3. Not paired, VPN on: pairing starts by itself: code spinner, then the waiting line
await open({ paired: null, pairOnPhone: true, localDevVPN: true, tailscale: { connect: "auto" } }, "server", "settings/installation/pair");
await sleep(SLOW + 1000); await shot("11-pair-getting-code");
await sleep(SLOW); await shot("12-pair-starting");
await sleep(SLOW); await shot("13-pair-waiting");
done(0);
