// F29 walk-through at 390x844 3x (iOS 17.2 user agent, Jailbroken Rootless): the fixture repos A and B and the
// AltStore fixture are added; Flip is marked installed at 1.0.16 through the site's status upload. Then the
// package page (light and dark), its Modify sheet, Version History, an app page and its Version History.
// Needs serve.py on :8748 and chromium --remote-debugging-port=9348. Usage: node shots.mjs <out dir>
import { open, sleep } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8748/index.html";
const p = await open(9348);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 500));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const go = async (hash, ms = 1500) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = () => p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? document.body.innerText`);
const scroll = (y) => p.evaluate(`(() => { const t = document.querySelector('.tab-stack.is-active .page.is-top'); const s = [t, ...t.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible'); if (s) s.scrollTop = ${y}; return !!s; })()`);
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/sources" }); await sleep(1500);
console.log(await p.evaluate(`(async () => {
  localStorage.setItem("cydian.device", "iphoneos-arm64"); localStorage.setItem("cydian.arch", "iphoneos-arm64");
  localStorage.setItem("cydian.appearance", ${JSON.stringify(process.env.THEME || "light")});
  const b = (await import("./backend.js")).getBackend();
  for (const s of await b.sources()) await b.removeSource(s.key);
  const r = [];
  for (const u of ["https://a.example/", "https://b.example/", "https://alt.example/apps.json"]) {
    try { r.push((await b.addSource(u)).key); } catch (e) { r.push("ERR " + u + " " + e.message); }
  }
  const { catalog } = await import("./catalog.js");
  await catalog.setStatus("Package: com.example.flip\\nStatus: install ok installed\\nVersion: 1.0.16\\nName: Flip\\nArchitecture: iphoneos-arm64\\nSection: System\\n");
  return JSON.stringify(r);
})()`));
await p.send("Page.reload"); await sleep(2500);
const A = encodeURIComponent("deb:https://a.example/:./");
const alt = encodeURIComponent("alt:https://alt.example/apps.json");
const t = process.env.THEME || "light";
const pkg = `#/sources/${A}/section%3A*/package%3Acom.example.flip`;
await go(pkg, 2500); await shot(`1-package-${t}`); console.log("--- package\n", await text());
await scroll(500); await sleep(300); await shot(`2-package-scrolled-${t}`);
await scroll(2000); await sleep(300); await shot(`3-package-bottom-${t}`);
await p.evaluate(`[...document.querySelectorAll('.nav-stack[data-tab="sources"] > .nav-item')].at(-1).querySelector('.nav-right .bar-button').click()`);
await sleep(800); await shot(`4-modify-sheet-${t}`); console.log("--- sheet\n", await p.evaluate(`document.querySelector('.action-sheet')?.innerText`));
await p.evaluate(`document.querySelector('.action-button.cancel')?.click()`); await sleep(600);
await go(pkg + "/versions%3Acom.example.flip", 2000); await shot(`5-versions-${t}`); console.log("--- versions\n", await text());
await p.evaluate(`document.querySelector('.version-row button.cell-inner')?.click()`); await sleep(800); await shot(`6-version-sheet-${t}`);
await p.evaluate(`document.querySelector('.action-button.cancel')?.click()`); await sleep(600);
const app = `#/sources/${alt}/section%3A*/package%3Adev.example.tracker`;
await go(app, 2500); await shot(`7-app-${t}`); console.log("--- app\n", await text());
await scroll(3000); await sleep(300); await shot(`8-app-bottom-${t}`);
await go(app + "/versions%3Adev.example.tracker", 2000); await shot(`9-app-versions-${t}`); console.log("--- app versions\n", await text());
await p.evaluate(`[...document.querySelectorAll('.version-row button.cell-inner')][0]?.click()`); await sleep(800); await shot(`10-app-version-sheet-${t}`);
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
