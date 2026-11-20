// Put a local HTML page into an inspectable WebKit page on the phone (Safari tab) through
// `pymobiledevice3 webinspector cdp`, for when the phone can't reach this machine's ports (ufw).
//   node phone-load.mjs PORT PAGE_ID FILE.html
import { readFile } from "node:fs/promises";

const [port, pageId, file] = process.argv.slice(2);
const html = await readFile(file, "utf8");
const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pageId}`);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const ev = (expression) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); });
await ev("window.__h = []; 1");
const N = 400000;
for (let i = 0; i < html.length; i += N) {
  const r = await ev(`window.__h.push(${JSON.stringify(html.slice(i, i + N))}); window.__h.length`);
  process.stdout.write(`${r.result?.result?.value ?? JSON.stringify(r.result)} `);
}
const r = await ev(`(() => { const h = window.__h.join(""); document.open(); document.write(h); document.close(); return h.length; })()`);
console.log("\nwrote", JSON.stringify(r.result?.result?.value ?? r.result));
ws.close(); process.exit(0);
