// B210 in WebKit (Playwright's WebKit build, as Safari and the Claude app draw it): a concept page, Lite, dark;
// Home > Why, then the Home tab; log Home's rows and shoot each step. Needs playwright-core (not in the repo; a scratch
// `npm i playwright-core`) and a cached Playwright WebKit.
//   NODE_PATH=<scratch>/node_modules node probe-webkit.mjs PAGE.html <shot prefix> [webkit executable]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const require = createRequire(process.env.NODE_PATH + "/");
const { webkit } = require("playwright-core");
const [PAGE, shot, exe] = process.argv.slice(2);
const html = await readFile(PAGE);
const server = createServer((req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await webkit.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on("pageerror", (e) => logs.push("EXC " + e.message));
page.on("console", (m) => { if (m.type() === "error") logs.push("ERR " + m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await sleep(1000);
await page.evaluate((mode) => document.getElementById(`mode-${mode}`).click(), process.env.MODE ?? "sideload");
await page.evaluate(() => { const s = document.getElementById("theme"); s.value = "dark:gunmetal"; s.dispatchEvent(new Event("change")); });
await sleep(4000);
const frame = () => page.frames().find((f) => f !== page.mainFrame());
const tap = async (fn) => {
  const at = await page.evaluate((src) => { const f = document.getElementById("app"), d = f.contentDocument;
    const e = (0, eval)(src)(d); if (!e) return null;
    const fr = f.getBoundingClientRect(), r = e.getBoundingClientRect(), k = fr.width / f.offsetWidth;
    return { x: fr.left + (r.left + r.width / 2) * k, y: fr.top + (r.top + r.height / 2) * k, text: e.textContent.trim().slice(0, 30) }; }, fn);
  if (!at) return null;
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.up();
  return at.text;
};
const HOME_TAB = `(d) => [...d.querySelectorAll('#tabbar a, .tabbar a')].find((e) => /home/i.test(e.getAttribute('href') || e.textContent))`;
const snap = (label) => frame().evaluate((label) => { const hs = [...document.querySelectorAll('.home')];
  return label + ' hash=' + location.hash + ' ' + hs.map((h) => '[' + [...h.children].map((c) => (c.className || c.tagName).toString().slice(0, 22) + (c.hidden ? '(hidden)' : '') + ':' + Math.round(c.getBoundingClientRect().height) + '@' + Math.round(c.getBoundingClientRect().top)).join(', ') + '] page=' + h.closest('.page')?.className).join(' | '); }, label);
if (!(await frame().evaluate(() => location.hash.startsWith("#/home")))) { console.log("to home", await tap(HOME_TAB)); await sleep(1500); }
console.log(await snap("start"));
await page.screenshot({ path: `${shot}-1-home.png` });
console.log("tap why", await tap(`(d) => [...d.querySelectorAll('.why a')].find((e) => e.getClientRects().length)`));
await sleep(Number(process.env.WAIT ?? 1500));
console.log(await snap("on why"));
await page.screenshot({ path: `${shot}-2-why.png` });
console.log("tap tab", await tap(HOME_TAB));
await sleep(1500);
console.log(await snap("after tab"));
await page.screenshot({ path: `${shot}-3-after.png` });
for (const l of logs) console.log(l);
await browser.close(); server.close();
