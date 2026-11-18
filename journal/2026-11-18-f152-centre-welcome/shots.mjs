// F152: 3x renders of Home's head and an empty-state page at 375/390/430, with the gaps measured.
// node shots.mjs <app url> <out dir>   (chromium on PATH; serve web/app first, e.g. python3 -m http.server)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, out] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 400);
const prof = mkdtempSync(join(tmpdir(), "f152-"));
const chrome = spawn("chromium", ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try { const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = t.find((x) => x.type === "page")?.webSocketDebuggerUrl; } catch {}
}
const sock = new WebSocket(ws); await new Promise((r) => sock.addEventListener("open", r));
let id = 0; const wait = new Map();
sock.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (wait.has(m.id)) { wait.get(m.id)(m.result); wait.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); sock.send(JSON.stringify({ id, method, params })); });
const q = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
const shot = async (name) => writeFileSync(join(out, name + ".png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
for (const w of [375, 390, 430]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 667, deviceScaleFactor: 3, mobile: true });
  await send("Page.navigate", { url: url + "#/home" }); await sleep(2500);
  console.log(w, "home", await q(`(() => { const h = ${top(".home-head")}, i = h.querySelector(".home-icon"), ws = h.querySelector(".home-words");
    const r = (e) => e.getBoundingClientRect(); const hr = r(h), ir = r(i);
    const kids = [...ws.children].map(r); const L = Math.min(...kids.map(k => k.left)), R = Math.max(...kids.map(k => k.left + k.width));
    const T = kids[0].top, B = kids.at(-1).bottom;
    return JSON.stringify({ leftGap: +(L - ir.right).toFixed(1), rightGap: +(hr.right - R).toFixed(1),
      iconMid: +((ir.top + ir.bottom) / 2).toFixed(1), textMid: +((T + B) / 2).toFixed(1) }); })()`));
  await shot(`home-${w}`);
  await send("Page.navigate", { url: url + "#/installed/wishlist" }); await sleep(2500);
  console.log(w, "wishlist", await q(`(() => { const b = ${top(".page-body")}, e = b && b.querySelector(".empty"); if (!e) return "no .empty";
    const cs = getComputedStyle(b), br = b.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(e); const er = rg.getBoundingClientRect();
    const t = br.top + parseFloat(cs.paddingTop), bo = br.bottom - parseFloat(cs.paddingBottom);
    return JSON.stringify({ above: Math.round(er.top - t), below: Math.round(bo - er.bottom), text: e.textContent.slice(0, 40) }); })()`));
  await shot(`wishlist-${w}`);
}
sock.close(); chrome.kill();
