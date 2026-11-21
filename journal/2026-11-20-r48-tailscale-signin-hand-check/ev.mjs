// usage: node ev.mjs <file-with-js-expression>
import { readFileSync } from "node:fs";
const expr = readFileSync(process.argv[2], "utf8");
const list = await (await fetch("http://127.0.0.1:9341/json")).json();
const page = list.find((p) => p.url.startsWith("ifizbox://"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
const t = setTimeout(() => { console.log("timeout"); process.exit(2); }, 15000);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id === 1) { clearTimeout(t); console.log(JSON.stringify(d.result?.result?.value ?? d.result ?? d, null, 1)); ws.close(); process.exit(0); }
};
