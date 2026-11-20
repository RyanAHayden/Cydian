// node shot.mjs <base url> <outdir> — B134: leaving This iPhone's page mid-step asks first (headless Chromium, fake
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


// ---- B134: leaving This iPhone's page while a step runs asks "Stop Setting Up?" (Cancel stays, Leave stops)
const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: true, tailscale: { connect: "auto", signedIn: false } };
const UNPAIRED = { paired: null, pairOnPhone: true, localDevVPN: true, tailscale: { connect: "auto" } };
const state = async (label) => {
  const s = await ev(`JSON.stringify({ hash: location.hash, alert: document.querySelector(".alert-title")?.textContent ?? null,
    msg: document.querySelector(".alert-message")?.textContent ?? null,
    cancels: (window.__calls || []).filter((c) => c === "idevice.pairCancel").length })`);
  console.log(label.padEnd(26), s);
  return JSON.parse(s);
};
const back = () => ev(`(() => { const b = document.querySelector(".nav-item.is-top .bar-button.back"); b?.click(); return Boolean(b); })()`);
const alertTap = (label) => ev(`(() => { const b = [...document.querySelectorAll(".alert-button")].find((n) => n.textContent === ${JSON.stringify(label)}); b?.click(); return Boolean(b); })()`);
const mouse = (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "mouse" });
const results = [];
const expect = (what, ok) => { results.push([what, ok]); console.log(ok ? "PASS" : "FAIL", what); };

await send("Page.navigate", { url: base });
await sleep(3000);

// 1. Back while pairing: the alert; Cancel stays (still pairing, nothing cancelled)
await open(UNPAIRED, "server", "settings/installation/pair");
await sleep(SLOW * 2 + 1500);
let s = await state("pairing");
expect("pairing page open", /installation\/pair$/.test(s.hash));
await back(); await sleep(600);
s = await state("back tapped"); await shot("1-back-alert");
expect("Back asks Stop Setting Up?", s.alert === "Stop Setting Up?" && /installation\/pair$/.test(s.hash));
await alertTap("Cancel"); await sleep(800);
s = await state("Cancel"); await shot("2-cancel-stays");
expect("Cancel stays, pairing not cancelled", !s.alert && /installation\/pair$/.test(s.hash) && s.cancels === 0);

// 2. Back again, Leave: the pairing is cancelled once and the page pops
await back(); await sleep(600);
await alertTap("Leave"); await sleep(1200);
s = await state("Leave"); await shot("3-leave-popped");
expect("Leave pops to Installation and cancels once", /installation$/.test(s.hash) && s.cancels === 1 && !s.alert);

// 3. A tab bar item while pairing
await open(UNPAIRED, "server", "settings/installation/pair");
await sleep(SLOW * 2 + 1500);
await ev(`document.querySelector('#tabbar a.tab[data-tab="sources"], #tabbar a.tab:not(.selected)')?.click()`); await sleep(600);
s = await state("tab tapped"); await shot("4-tab-alert");
expect("tab asks", s.alert === "Stop Setting Up?" && /installation\/pair$/.test(s.hash));
await alertTap("Leave"); await sleep(1200);
s = await state("tab Leave"); await shot("5-tab-left");
expect("tab Leave switches tab and cancels once", !/installation\/pair$/.test(s.hash) && s.cancels === 1);

// 4. The edge swipe while pairing: never drags, asks; Leave pops
await open(UNPAIRED, "server", "settings/installation/pair");
await sleep(SLOW * 2 + 1500);
await mouse("mousePressed", 4, 400);
for (const x of [10, 20, 40, 80, 140]) { await mouse("mouseMoved", x, 402); await sleep(30); }
await mouse("mouseReleased", 140, 402); await sleep(600);
s = await state("swiped"); await shot("6-swipe-alert");
expect("swipe asks", s.alert === "Stop Setting Up?" && /installation\/pair$/.test(s.hash));
await alertTap("Cancel"); await sleep(800);
s = await state("swipe Cancel"); await shot("7-swipe-cancel");
expect("swipe Cancel stays", !s.alert && /installation\/pair$/.test(s.hash) && s.cancels === 0);
await mouse("mousePressed", 4, 400);
for (const x of [10, 20, 40, 80, 140]) { await mouse("mouseMoved", x, 402); await sleep(30); }
await mouse("mouseReleased", 140, 402); await sleep(600);
await alertTap("Leave"); await sleep(1200);
s = await state("swipe Leave");
expect("swipe Leave pops and cancels once", /installation$/.test(s.hash) && s.cancels === 1);

// 5. The first check (paired, status slow): asks with the checking line; once paired, Back just goes
await open(PAIRED, "iphone", "settings/installation/pair");
await sleep(1200);
await back(); await sleep(600);
s = await state("checking back"); await shot("8-checking-alert");
expect("checking asks", s.alert === "Stop Setting Up?" && /checking/.test(s.msg || ""));
await alertTap("Cancel"); await sleep(SLOW + 500);
await back(); await sleep(1000);
s = await state("paired back");
expect("paired: Back goes without asking", !s.alert && /installation$/.test(s.hash));

console.log(results.every(([, ok]) => ok) ? "ALL PASS" : "SOME FAILED");
done(results.every(([, ok]) => ok) ? 0 : 1);
