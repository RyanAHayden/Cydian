// Minimal CDP driver: node cdp.mjs <base> <outdir> <script.json>
// script: [{ "go": "#/sources" } | { "wait": ms } | { "shot": "name" } | { "eval": "js" } | { "click": "css selector" } | { "clicktext": "text" }]
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [base, outdir, scriptFile] = process.argv.slice(2);
const steps = JSON.parse(await readFile(scriptFile, "utf8"));
const prof = await mkdtemp(join(outdir, "prof-"));
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn("chromium", ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill()); process.on("uncaughtException", (e) => { console.error(e); chrome.kill(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {}
  await sleep(200);
}
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };

const H = Number(process.env.SHOT_H || 548);
await send("Emulation.setDeviceMetricsOverride", { width: Number(process.env.SHOT_W || 320), height: H, deviceScaleFactor: Number(process.env.SHOT_DPR || 2), mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: base });
await sleep(3000);
for (const s of steps) {
  if (s.go !== undefined) { await ev(`location.hash = ${JSON.stringify(s.go)}`); await sleep(s.ms ?? 1500); }
  else if (s.nav !== undefined) { await send("Page.navigate", { url: base + "?r=" + (++id) + s.nav }); await sleep(s.ms ?? 4000); }
  else if (s.wait) await sleep(s.wait);
  else if (s.tap) { // a real touch at the centre of the last visible match
    const xy = await ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(s.tap)})].filter(e=>e.offsetParent&&(!${JSON.stringify(s.text ?? "")}||e.textContent.includes(${JSON.stringify(s.text ?? "")}))).at(-1); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`);
    console.log("tap", s.tap, xy);
    if (xy) for (const type of ["touchStart", "touchEnd"]) await send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: xy[0], y: xy[1] }] });
    await sleep(s.ms ?? 2000);
  }
  else if (s.drag) { // F215: a touch drag from the centre of the first visible match, by dy px, in steps
    const xy = await ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(s.drag)})].find(e=>e.offsetParent); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`);
    console.log("drag", s.drag, xy, s.dy);
    if (xy) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: xy[0], y: xy[1] }] });
      for (let i = 1; i <= 10; i++) { await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: xy[0], y: xy[1] + (s.dy * i) / 10 }] }); await sleep(16); }
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await sleep(s.ms ?? 1000);
  }
  else if (s.eval) console.log("eval:", String(JSON.stringify(await ev(s.eval))).slice(0, 2000));
  else if (s.click) { console.log("click", s.click, await ev(`(()=>{const e=document.querySelector(${JSON.stringify(s.click)}); if(!e) return 'none'; e.click(); return 'ok'})()`)); await sleep(s.ms ?? 1500); }
  else if (s.clicktext) {
    console.log("clicktext", s.clicktext, await ev(`(()=>{const all=[...document.querySelectorAll('a,button,li,[role=button],.row,div,span')].filter(e=>e.offsetParent!==null&&e.textContent.trim()===${JSON.stringify(s.clicktext)}); const e=all.at(-1); if(!e) return 'none'; e.click(); return 'ok '+e.tagName+'.'+e.className})()`));
    await sleep(s.ms ?? 1500);
  }
  else if (s.shot) { const r = await send("Page.captureScreenshot", { format: "png" }); await writeFile(join(outdir, s.shot + ".png"), Buffer.from(r.result.data, "base64")); console.log("shot", s.shot); }
}
ws.close(); chrome.kill();
