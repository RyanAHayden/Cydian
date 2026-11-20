#!/usr/bin/env node
// Opens a built concept page (tools/concept/build.py --standalone) in headless Chromium under a CSP like the
// Artifact viewer's (no host, nothing fetched, inline scripts and data: images only) and checks it at each
// device x theme x mode asked for: the app came up in the phone (a page drawn, the Loading screen gone), a tap on
// the tab bar navigates, and nothing logged an error (exceptions, console.error, CSP refusals, any request at all
// besides the page). Not in tools/check.sh: it needs Chromium.
//
//   node tools/concept/check.mjs PAGE.html [--devices iphone-se,iphone-17-pro-max] [--themes light:classic,dark:gunmetal]
//                                [--modes jailbreak,sideload,site] [--version after|before] [--shots DIR]
//                                [--viewport 1280x900] [--tap '.tabbar a:nth-child(2)'] [--route '#/sources'] [--probe 'return …']
//
// Exit 0: every run clean; 1: an error or a failed check (listed); 2: Chromium didn't start.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const DEVICES = opt("--devices", "iphone-se,iphone-17-pro-max").split(",");
const THEMES = opt("--themes", "light:classic,dark:gunmetal").split(",");
const MODES = opt("--modes", "jailbreak").split(",");
const VERSION = opt("--version", "after");
const SHOTS = opt("--shots", null);
const ROUTE = opt("--route", null);
const PROBE = opt("--probe", null); // JS run in the app's frame (d: document, w: window) after each run; its value printed
const TAP = opt("--tap", "#tabbar a, #tabbar button, .tabbar a, .tabbar button");
const [VW, VH] = opt("--viewport", "1280x900").split("x").map(Number);
const PAGE = args[0];
if (!PAGE) { console.error("usage: node tools/concept/check.mjs PAGE.html [options]"); process.exit(2); }
const CHROME = process.env.CHROMIUM ?? "chromium";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Artifact viewer's CSP, as its rules describe it: scripts from a few CDNs and inline, styles inline and from
// Google Fonts, images and media as data:/blob:, no fetch/XHR anywhere.
const CSP = ["default-src 'none'", "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com data:", "img-src data: blob:", "media-src data: blob:",
  "connect-src 'none'", "frame-src 'self' blob: data:", "worker-src blob:"].join("; ");
const page = await readFile(PAGE);
const stray = [];
const server = createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/?")) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP }).end(page); return; }
  stray.push(req.url);
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const prof = await mkdtemp(join(tmpdir(), "ifizbox-concept-"));
const port = 9300 + Math.floor(Math.random() * 600);
const chrome = spawn(CHROME, ["--headless", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const cleanup = async () => { try { chrome.kill(); } catch {} server.close(); await sleep(300); await rm(prof, { recursive: true, force: true }).catch(() => {}); };
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
  if (!ws) await sleep(200);
}
if (!ws) { console.error("concept check: Chromium didn't start"); await cleanup(); process.exit(2); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); let errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "assert"))
    errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text + (m.params.entry.url ? " " + m.params.entry.url : ""));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const inApp = (body) => ev(`(() => { const d = document.getElementById("app").contentDocument; const w = document.getElementById("app").contentWindow; ${body} })()`);
const until = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await inApp(expr)) return true; } catch {} await sleep(150); } return false; };

await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: base });
await sleep(800);

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return ok; };
// A real tap (the app's tap guard ignores el.click()): CDP mouse events at the element's centre on screen, through
// the iframe's offset and the phone's scale.
async function tap(css) {
  const at = await ev(`(() => {
    const f = document.getElementById("app"), d = f.contentDocument;
    const e = [...d.querySelectorAll(${JSON.stringify(css)})].filter((x) => x.getClientRects().length)[0];
    if (!e) return null;
    const fr = f.getBoundingClientRect(), r = e.getBoundingClientRect(), k = fr.width / f.offsetWidth;
    return { x: fr.left + (r.left + r.width / 2) * k, y: fr.top + (r.top + r.height / 2) * k, text: e.textContent.trim().slice(0, 30) };
  })()`);
  if (!at) return null;
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  return at.text;
}
async function set(control, value) {
  await ev(`(() => { const s = document.getElementById(${JSON.stringify(control)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); })()`);
}

const top = await ev(`({ title: document.title, theme: document.getElementById("theme").value, hasDevice: !!document.getElementById("device").options.length,
  modes: [...document.querySelectorAll("#mode button")].map((b) => b.textContent) })`);
check(top.theme.startsWith("light:"), `the page opens light (${top.theme})`);
check(top.hasDevice && top.modes.length === 3, `device and mode controls (${top.modes.join(", ")})`);
if (VERSION === "before") await ev(`document.getElementById("version-before")?.click()`);

for (const mode of MODES) {
  await ev(`document.getElementById("mode-${mode}").click()`);
  for (const device of DEVICES) {
    for (const theme of THEMES) {
      errors = [];
      stray.length = 0;
      await set("device", device);
      await set("theme", theme); // reloads the app
      await ev(`document.getElementById("startpage").click()`); // from the concept's start page
      await sleep(300);
      const name = `${mode}-${device}-${theme.replace(":", "-")}${VERSION === "before" ? "-before" : ""}`;
      const up = await until(`return d.querySelector(".page") && !d.getElementById("boot")`, 15000);
      check(up, `${name}: the app came up`);
      const t = await inApp(`return d.documentElement.getAttribute("data-theme") + ":" + d.documentElement.getAttribute("data-palette")`);
      check(t === theme, `${name}: the app's theme is ${t}`);
      await sleep(1200);
      if (ROUTE) {
        await inApp(`w.location.hash = ${JSON.stringify(ROUTE)}`);
        await sleep(1500);
      } else {
        const before = await inApp("return w.location.hash");
        const tabs = await inApp(`return [...d.querySelectorAll(${JSON.stringify(TAP)})].length`);
        const which = await tap(`${TAP.split(",").map((s) => s.trim() + ":nth-last-child(2)").join(",")}`);
        await sleep(1500);
        const after = await inApp("return w.location.hash");
        check(tabs > 0 && which && after !== before, `${name}: tapping "${which}" in the tab bar went ${before} -> ${after}`);
      }
      if (PROBE) console.log(`     probe: ${JSON.stringify(await inApp(PROBE))}`);
      if (SHOTS) {
        await mkdir(SHOTS, { recursive: true });
        const r = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
      }
      const own = await ev(`document.getElementById("errors").textContent`);
      if (own) errors.push("shell: " + own);
      check(!errors.length, `${name}: no errors` + (errors.length ? "\n      " + [...new Set(errors)].slice(0, 8).join("\n      ") : ""));
      check(!stray.length, `${name}: no requests besides the page` + (stray.length ? ": " + stray.slice(0, 5).join(" ") : ""));
    }
  }
}
await cleanup();
console.log(failures.length ? `concept check: ${failures.length} failed` : "concept check: all clean");
process.exit(failures.length ? 1 : 0);
