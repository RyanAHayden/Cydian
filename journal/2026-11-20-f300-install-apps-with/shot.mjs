// node shot.mjs <base url> <outdir> — F300: Installation & Signing's main page and Install Apps With's page in headless
// Chromium (402x874 @3x) with a fake sideload ifizboxNative whose replies are slowed (SLOW ms). Shoots the main
// page, Install Apps With with the Signing Server chosen, a tap on This iPhone while idevice.status reads (the
// checkmark moved, the spinner), the page once it answered, and a Connect With tap to Tailscale mid-call.
// Serve web/app first: python3 -m http.server <port> -d web/app --bind 127.0.0.1
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const W = 402, SLOW = 2000;
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = (c) => { try { chrome.kill(); } catch {} process.exit(c); };
setTimeout(() => { console.error("timeout"); done(2); }, 180000);
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

const BRIDGE = `(() => {
  const SLOW = ${SLOW};
  const st = () => JSON.parse(localStorage.getItem("fake.status") || "{}");
  const later = (v) => new Promise((r) => setTimeout(() => r(typeof v === "function" ? v() : v), SLOW));
  const expires = new Date(Date.now() + 289.5 * 86400000).toISOString();
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params, onEvent) {
    window.__calls = (window.__calls || []).concat(method);
    if (method === "idevice.status") return later(st);
    if (method === "tailscale.setConnect") return later(() => { const s = st(); s.tailscale = { ...s.tailscale, connect: params.value }; localStorage.setItem("fake.status", JSON.stringify(s)); return null; });
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

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
  await writeFile(join(outdir, `${name}.png`), Buffer.from(r.result.data, "base64"));
};
const page = () => ev(`(document.querySelector(".nav-item.is-top .nav-title")?.textContent || "?") + " :: " + [...document.querySelectorAll(".page.is-top .group-header, .page.is-top .cell-inner")].map((n) => n.classList.contains("group-header") ? "[" + n.textContent + "]" : (n.querySelector(".cell-label")?.textContent || "") + (n.querySelector(".cell-detail")?.textContent ? "=" + n.querySelector(".cell-detail").textContent : "") + (n.querySelector(".loading-spinner") ? "(spin)" : "") + (n.closest(".cell")?.classList.contains("checked") || n.querySelector(".checkmark, .cell-check") ? "(✓)" : "")).join(" / ")`);
const tapText = (t) => ev(`(() => { const c = [...document.querySelectorAll(".page.is-top .cell-inner")].find((n) => n.querySelector(".cell-label")?.textContent === ${JSON.stringify(t)}); if (!c) return "no " + ${JSON.stringify(t)}; c.click(); return "tapped"; })()`);
const open = async (status, route, sub) => {
  await ev(`localStorage.setItem("fake.status", ${JSON.stringify(JSON.stringify(status))}); localStorage.setItem("ifizbox.installRoute", ${JSON.stringify(route)})`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#/home/settings/${sub}` });
};

const PAIRED = { paired: "rp", pairOnPhone: true, localDevVPN: true, otherVPN: false, tailscale: { connect: "auto", signedIn: false, address: null, use: false } };
await send("Page.navigate", { url: base });
await sleep(3000);
await open(PAIRED, "iphone", "installation");
await sleep(SLOW + 1500);
await shot("1-main");
console.log("main      ", await page());
await open(PAIRED, "server", "installation/with");
await sleep(SLOW + 1500);
await shot("2-with-server");
console.log("server    ", await page());
console.log("tap       ", await tapText("This iPhone"));
await sleep(200);
await shot("3-with-iphone-picking");
console.log("picking   ", await page());
await sleep(SLOW + 800);
await shot("4-with-iphone");
console.log("answered  ", await page());
console.log("tap       ", await tapText("Tailscale"));
await sleep(200);
await shot("5-connect-tailscale-picking");
console.log("connecting", await page());
await sleep(2 * SLOW + 800);
await shot("6-connect-tailscale");
console.log("connected ", await page());
console.log("calls", await ev(`(window.__calls || []).join(",")`));
done(0);
