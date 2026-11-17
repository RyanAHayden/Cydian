// Drives the app in headless Chromium over CDP: node drive.mjs <port> <base> <script.js>; the script is evaluated
// with `p` (cdp page), `sleep`, `shot(name)`, `go(hash)`, `q(expr)` in scope. Prints console errors at the end.
import { open, sleep, phone } from "./cdp.mjs";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
const [port, base, script, out = "."] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const p = await open(Number(port));
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) errs.push(JSON.stringify(d.params.args).slice(0, 400));
});
await phone(p);
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const q = (e) => p.evaluate(e);
const go = async (hash, ms = 800) => { await q(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const waitFor = async (expr, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await q(expr)) return true; await sleep(250); }
  throw new Error("timed out waiting for " + expr);
};
await p.send("Page.navigate", { url: base }); await sleep(1200);
const AsyncFunction = (async () => {}).constructor;
try {
  await new AsyncFunction("p", "sleep", "shot", "go", "q", "waitFor", readFileSync(script, "utf8"))(p, sleep, shot, go, q, waitFor);
} catch (e) { console.log("script error:", e.message); }
console.log("errors:", errs);
await p.close();
