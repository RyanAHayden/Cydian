// node shot.mjs <base url> <outdir> <width>  — renders Settings' root, Installation & Signing (Signing Server and
// This iPhone chosen) and This iPhone's page in headless Chromium at DPR 3 with a fake sideload ifizboxNative
// (from F268's journal script).
import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir, widthArg] = process.argv.slice(2);
const W = Number(widthArg || 402);
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const done = (c) => { try { chrome.kill(); } catch {} process.exit(c); };
setTimeout(() => { console.error("timeout"); done(2); }, 90000);
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

const BRIDGE = `(() => {
  const st = () => JSON.parse(localStorage.getItem("fake.status") || "{}");
  globalThis.ifizboxApp = true;
  globalThis.ifizboxNative = { mode: "sideload", call(method, params, onEvent) {
    if (method === "idevice.status") return Promise.resolve(st());
    if (method === "signing.status") return Promise.resolve({ identity: { name: "iPhone Distribution: Jane Appleseed", team: "Jane Appleseed",
      expires: "2027-08-01T00:00:00Z", profile: { name: "Wildcard", expires: "2027-08-01T00:00:00Z", devices: 3, appId: "ABCDE12345.*" } } });
    if (method === "idevice.pair") { setTimeout(() => onEvent?.([{ pin: "042917" }]), 50);
      setTimeout(() => onEvent?.([{ step: "advertised", text: "Waiting for the iPhone to connect." }]), 100); return new Promise(() => {}); }
    if (method === "idevice.pairState") return Promise.resolve({ active: true, pin: "042917", text: "Waiting for the iPhone to connect." });
    return Promise.resolve(null);
  } };
})();`;
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: 874, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });

// [name, idevice.status, path, full page, installRoute]
const scenes = [
  ["root", {}, ["settings"], false, "server"],
  ["server", {}, ["settings", "signing"], true, "server"],
  ["iphone", { paired: "rp", pairOnPhone: true, localDevVPN: true, tailscale: { connect: "auto", signedIn: false } }, ["settings", "installation"], true, "iphone"],
  ["pair", { paired: "rp", pairOnPhone: true, localDevVPN: true }, ["settings", "installation", "pair"], false, "iphone"],
];
await send("Page.navigate", { url: base });
await sleep(3000);
for (const [name, status, path, full, routeTo] of scenes) {
  await ev(`localStorage.setItem("fake.status", ${JSON.stringify(JSON.stringify(status))}); localStorage.setItem("ifizbox.installRoute", ${JSON.stringify(routeTo)})`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url: `${base}#/home/${path.join("/")}` });
  await sleep(3000);
  await ev(`document.querySelector(".alert, .alert-view, [role=alertdialog]") ? "alert" : "no alert"`).then((a) => console.log(name, a));
  await ev(`[...document.querySelectorAll(".page.is-top .nav-title, .navbar .title, .page.is-top .group-header, .page.is-top .cell-label")].map((e) => e.textContent.trim()).filter(Boolean).join(" | ")`).then((t) => console.log(" ", t));
  const h = full ? await ev(`Math.ceil(Math.max(...[...document.querySelectorAll(".page-body, .page, main, body")].map((e) => e.scrollHeight)))`) : 874;
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full, clip: { x: 0, y: 0, width: W, height: Math.min(h, 2400), scale: 1 } });
  await writeFile(join(outdir, `${name}-${W}.png`), Buffer.from(r.result.data, "base64"));
  if (full) { // the page scrolls inside its own box: a second shot further down
    await ev(`(() => { const b = [...document.querySelectorAll(".page.is-top *")].find((e) => e.scrollHeight > e.clientHeight + 50); if (b) b.scrollTop = 650; return Boolean(b); })()`);
    await sleep(400);
    const r2 = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: 874, scale: 1 } });
    await writeFile(join(outdir, `${name}-down-${W}.png`), Buffer.from(r2.result.data, "base64"));
  }
}
done(0);
