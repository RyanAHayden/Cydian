// node shot.mjs <base url> <outdir> — F284: Installation & Signing's main page in headless Chromium (402x874 @3x) with
// a fake sideload ifizboxNative whose every reply is slowed (SLOW ms). For each state it shoots the page while it
// loads and once every answer is in, and prints each row's top edge in both, so they can be compared.
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
setTimeout(() => { console.error("timeout"); done(2); }, 240000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("page:", m.params.args.map((a) => a.value ?? a.description).join(" ")); else if (m.method === "Runtime.exceptionThrown") console.error("page exception:", m.params.exceptionDetails?.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

// Every call answers after SLOW ms; fake.status in localStorage. A certificate that expires in 289 days, 4 signed apps.
const BRIDGE = `(() => {
  const SLOW = ${SLOW};
  const st = () => JSON.parse(localStorage.getItem("fake.status") || "{}");
  const later = (v) => new Promise((r) => setTimeout(() => r(typeof v === "function" ? v() : v), SLOW));
  const expires = new Date(Date.now() + 289.5 * 86400000).toISOString();
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params, onEvent) {
    window.__calls = (window.__calls || []).concat(method);
    if (method === "idevice.status") return later(st);
    if (method === "idevice.vpnApps") return later({ localdevvpn: true, tailscale: true });
    if (method === "idevice.developerMode") return later({ on: true });
    if (method === "signing.status") return later({ identity: { name: "Apple Distribution: Example", team: "ABCDE12345", expires, profile: { name: "Example", expires, devices: 3, appId: "*" } } });
    if (method === "signing.installed") return later({ apps: [1, 2, 3, 4].map((i) => ({ bundleId: "com.example.app" + i, name: "App " + i, expires })) });
    if (method === "idevice.pairState") return Promise.resolve({ active: false });
    return later(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

const rows = () => ev(`[...document.querySelectorAll(".page.is-top .install-main .cell")].map((c) => Math.round(c.getBoundingClientRect().top) + ":" + Math.round(c.getBoundingClientRect().height)).join(" ")`);
const text = () => ev(`[...document.querySelectorAll(".page.is-top .install-main .cell-inner")].map((c) => [...c.querySelectorAll(".slot-value, .cell-label:not(.value-slot)")].map((n) => n.textContent).filter(Boolean).join(" ") + (c.querySelector(".is-loading") ? " [loading]" : "")).join(" | ")`);
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const open = async (status, route) => {
  await ev(`localStorage.setItem("fake.status", ${JSON.stringify(JSON.stringify(status))}); localStorage.setItem("ifizbox.installRoute", ${JSON.stringify(route)})`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#/home/settings/installation` });
};

const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false, address: null, use: false } };
const STATES = {
  "ready-localdevvpn": PAIRED,
  "ready-tailscale": { ...PAIRED, localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: true, name: "iFizBox on iPhone", address: "100.84.12.7", use: true } },
  "other-vpn-nothing-chosen": { ...PAIRED, localDevVPN: false, otherVPN: true },
  "other-vpn-set-up-localdevvpn": { ...PAIRED, localDevVPN: false, otherVPN: true, tailscale: { connect: "localdevvpn", signedIn: true, address: null, use: false } },
  "other-vpn-set-up-tailscale": { ...PAIRED, localDevVPN: false, otherVPN: true, tailscale: { connect: "tailscale", signedIn: true, address: null, use: false } },
  "tailscale-vpn-not-signed-in": { ...PAIRED, localDevVPN: false, otherVPN: true, tailscale: { connect: "auto", signedIn: false, address: "100.84.12.7", use: false } },
  "not-paired": { ...PAIRED, paired: null },
};
await send("Page.navigate", { url: base });
await sleep(3000);
let same = true;
for (const [name, status] of Object.entries(STATES)) {
  await open(status, "iphone");
  await sleep(900);
  const r0 = await rows();
  const t0 = await text();
  if (name === "ready-localdevvpn") await shot("0-loading");
  await sleep(SLOW + 1500);
  const r1 = await rows();
  await shot(name);
  console.log(name.padEnd(30), await text());
  console.log("  loading:".padEnd(30), t0);
  console.log("  rows loading".padEnd(30), r0);
  console.log("  rows ready".padEnd(30), r1, r0 === r1 ? "SAME" : "DIFFERENT");
  if (r0 !== r1 || !r0) same = false;
}
// a repaint (a setting changed) keeps every value: no row goes back to its spinner
await ev(`localStorage.setItem("ifizbox.showExpiry", "false")`);
await ev(`(async () => { const m = await import("./screens/settings.js"); m.settings.set("showExpiry", !m.settings.get("showExpiry")); })()`);
await sleep(300);
console.log("after a setting change".padEnd(30), await text());
await shot("9-after-setting-change");
console.log("calls", await ev(`(window.__calls || []).join(",")`));
// each sub-page: its title and row labels once loaded
for (const sub of ["installation/with", "installation/iphone", "installation/pair", "signing/certificate", "signing/server", "signing/apps", "signing/help"]) {
  await open(PAIRED, "iphone");
  await sleep(500);
  await send("Page.navigate", { url: `${base}#/home/settings/${sub}` });
  await sleep(2 * SLOW + 1500);
  await shot("sub-" + sub.replace("/", "-"));
  console.log(sub.padEnd(22), await ev(`(document.querySelector(".nav-item.is-top .nav-title")?.textContent || "?") + " :: " + [...document.querySelectorAll(".page.is-top .group-header, .page.is-top .cell-label")].map((n) => n.textContent).join(" / ")`));
}
console.log(same ? "row positions identical in every state" : "ROW POSITIONS DIFFER");
done(same ? 0 : 1);
