// B54: open the harness in headless Chromium over CDP, take frames at set times, then read the trace.
// node cdp.mjs <port> <url> <outdir> <prefix>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [port, url, outdir, prefix] = process.argv.slice(2);
const chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
  `--user-data-dir=${outdir}/prof-${prefix}`, "--window-size=390,844", "about:blank"], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) {
    await wait(200);
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.enable");
  const t0 = Date.now();
  await send("Page.navigate", { url });
  for (const at of [300, 1000, 1400, 1700, 2600]) {
    await wait(Math.max(0, at - (Date.now() - t0)));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${outdir}/${prefix}-${at}ms.png`, Buffer.from(shot.data, "base64"));
  }
  for (let i = 0; i < 40; i++) {
    const r = await send("Runtime.evaluate", { expression: "document.getElementById('out').textContent", returnByValue: true });
    if (r.result.value) { console.log(r.result.value); break; }
    await wait(250);
  }
  ws.close();
} finally {
  chrome.kill();
}
