// B157: the tab bar gloss split in headless Chromium at 390x844, DPR 3, safe areas 47 top / 34 bottom (from B132's shots.mjs).
//   node shots.mjs <base url> <outdir>
// The app (data-shell="app", what native/Sources/App.swift puts on <html>) in Classic, Gunmetal and Linen: a full
// shot plus 3x crops of the top 100 and bottom 100 CSS px.
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const [base, outdir] = process.argv.slice(2);
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
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
await send("Page.enable"); await send("Runtime.enable");
const W = 390, H = 844;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true });
const sa = await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
if (sa.error) console.log("safe area override:", sa.error.message);
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.navigate", { url: base }); // localStorage needs the page's origin
await sleep(1500);
// WKWebView's atDocumentStart script finds <html> already made; Chromium's new-document script can run before it.
const APP = `(() => { const set = () => document.documentElement?.setAttribute("data-shell", "app");
  if (document.documentElement) set(); else new MutationObserver((_, o) => { if (document.documentElement) { set(); o.disconnect(); } }).observe(document, { childList: true }); })()`;
let shell = null;
const themes = { classic: ["light", null, null], gunmetal: ["dark", "gunmetal", null], linen: ["dark", "linen", null] };
for (const s of ["app"]) {
  const tag = await send("Page.addScriptToEvaluateOnNewDocument", { source: s === "app" ? APP : "" });
  shell = tag.result?.identifier;
  for (const [name, [a, d]] of Object.entries(themes)) {
    await send("Runtime.evaluate", { expression: `localStorage.setItem("ifizbox.appearance", ${JSON.stringify(a)}); ${d ? `localStorage.setItem("ifizbox.darkTheme", ${JSON.stringify(d)})` : ""}` });
    await send("Page.navigate", { url: base + "?r=" + (++id) });
    await sleep(3500);
    const shot = async (file, clip) => {
      const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      await writeFile(join(outdir, file), Buffer.from(r.result.data, "base64"));
    };
    await shot(`${s}-${name}.png`);
    await shot(`${s}-${name}-top.png`, { x: 0, y: 0, width: 130, height: 100 });
    await shot(`${s}-${name}-bottom.png`, { x: 0, y: H - 100, width: 130, height: 100 });
    console.log("shot", s, name);
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: shell });
}
ws.close(); chrome.kill();
await sleep(500);
await rm(prof, { recursive: true, force: true });
process.exit(0);
