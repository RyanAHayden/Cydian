// F37 walk-through at 390x844 3x (iOS 16.5 UA): adds the fixture AltStore source and the fake APT repo, then shoots
// Home and Search ("example") as Not Jailbroken (the default), then as Jailbroken (Rootless), plus Settings, the
// Device page and Sources. Needs serve.py on :8757 and chromium --remote-debugging-port=9357.
// Usage: node shots.mjs <shots dir>
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8757/index.html";
const p = await open(9357);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const q = (e) => p.evaluate(e);
const go = async (hash, ms = 1500) => { await q(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
const text = () => q(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? ""`);
const rows = () => q(`JSON.stringify([...document.querySelectorAll('.tab-stack.is-active .page.is-top .pkg-row:not([hidden]) .pkg-name')].map(e => e.textContent))`);
const search = async (s) => {
  await go("#/search", 1000);
  await q(`(() => { const i = ${top("input")}; i.value = ${JSON.stringify(s)}; i.dispatchEvent(new Event("input")); })()`);
  await sleep(3000);
};
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(1500);
await q(`localStorage.clear(); localStorage.setItem("cydian.appearance", "light")`);
console.log("added alt", await q(`import("./backend.js").then((m) => m.getBackend().addSource("https://example.dev/apps.json")).then((s) => s.key, (e) => "ERR " + e.message)`));
console.log("added apt", await q(`import("./backend.js").then((m) => m.getBackend().addSource("https://repo.example/")).then((s) => s.key, (e) => "ERR " + e.message)`));
await p.send("Page.reload"); await sleep(2500);
await go("#/home", 1500);
console.log("device type:", await q(`localStorage.getItem("cydian.device")`), "hint:", await q(`${top(".home-hint")}?.textContent ?? null`));
await shot("1-home-not-jailbroken");
await search("example");
console.log("search, Not Jailbroken:", await rows()); await shot("2-search-not-jailbroken");
await go("#/sources", 2000); console.log("--- sources, Not Jailbroken\n", (await text()).slice(0, 500)); await shot("3-sources-not-jailbroken");
await go("#/sources/*", 2500); console.log("--- sections, Not Jailbroken\n", (await text()).slice(0, 400));
await go("#/settings", 1500); await shot("4-settings");
// the hint's tap goes to Settings > Device
await go("#/home", 1500); await q(`${top(".home-hint")}.click()`); await sleep(1500);
console.log("after hint tap:", await q("location.hash")); await shot("5-device-page");
// pick Jailbroken (Rootless) on the Device page
await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .cell-inner')].find(e => e.textContent.includes("Rootless")).click()`); await sleep(1500);
console.log("device now:", await q(`localStorage.getItem("cydian.device")`), "arch:", await q(`localStorage.getItem("cydian.arch")`));
await shot("6-device-page-rootless");
await go("#/home", 1500);
console.log("hint when jailbroken:", await q(`${top(".home-hint")}?.textContent ?? null`)); await shot("7-home-rootless");
await search("example");
console.log("search, Rootless:", await rows()); await shot("8-search-rootless");
await q(`localStorage.setItem("cydian.device", "iphoneos-arm"); localStorage.setItem("cydian.arch", "iphoneos-arm")`);
await p.send("Page.reload"); await sleep(2500);
await search("example");
console.log("search, Rootful:", await rows()); await shot("9-search-rootful");
await go("#/sources", 2000); console.log("--- sources, Rootful\n", (await text()).slice(0, 400));
// an app page as Not Jailbroken: the Get row for the chosen sideloader
await q(`localStorage.setItem("cydian.device", "none")`); await p.send("Page.reload"); await sleep(2500);
await go("#/search/" + encodeURIComponent("package:dev.example.emu"), 3000);
console.log("--- app page\n", (await text()).slice(0, 900)); await shot("10-app-page-get");
console.log("Get row's link:", await q(`(() => { let u = null; const real = Object.getOwnPropertyDescriptor(Location.prototype, "href"); return [...document.querySelectorAll('.tab-stack.is-active .page.is-top .cell-inner')].find(e => /^Get/.test(e.textContent))?.textContent ?? null; })()`));
console.log("errors:", errs);
await p.close();
