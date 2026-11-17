// F28: Sources with the 13 default AltStore sources, on the real Flask app (web/app.py, live proxy) at :8758,
// headless Chromium on --remote-debugging-port=9358, 390 wide @3x, iOS 16.5 UA, fresh profile (so the defaults seed).
// Shoots Sources before and after Refresh as Not Jailbroken (AltStore only) and as Jailbroken Rootless (all 18),
// tall enough to show every row; then removes crystall1ne and adds it back as the bare host.
// Usage: node shots.mjs <shots dir>
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8758/index.html";
const p = await open(9358);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const q = (e) => p.evaluate(e);
const size = (h) => p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 3, mobile: true });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const go = async (hash, ms = 1500) => { await q(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = () => q(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? ""`);
const backend = (expr) => q(`import("./backend.js").then((m) => (${expr})(m.getBackend())).then((v) => JSON.stringify(v), (e) => "ERR " + e.message)`);
await size(844);
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(2000);
await q(`localStorage.setItem("cydian.appearance", "light")`);
console.log("seeded:", await backend(`async (b) => (await b.sources()).filter((s) => s.kind === "altstore").length`));
await size(1500);
await go("#/sources", 2500); await shot("1-sources-seeded-not-jailbroken");
console.log("refresh:", await backend(`async (b) => (await b.refreshSources()).filter((s) => s.kind === "altstore").map((s) => [s.name, s.count, s.error])`));
await p.send("Page.reload"); await sleep(3000);
await go("#/sources", 2500);
console.log("--- Sources, Not Jailbroken\n" + await text());
await shot("2-sources-refreshed-not-jailbroken");
await q(`localStorage.setItem("cydian.device", "iphoneos-arm64"); localStorage.setItem("cydian.arch", "iphoneos-arm64")`);
await p.send("Page.reload"); await sleep(3000);
await size(1500);
await go("#/sources", 3000);
console.log("--- Sources, Rootless\n" + await text());
await shot("3-sources-rootless-all");
// crystall1ne serves its JSON at every path: added as a bare host it must come back as AltStore, not APT.
console.log("remove:", await backend(`(b) => b.removeSource("alt:https://alt.crystall1ne.dev/")`));
console.log("re-add:", await backend(`(b) => b.addSource("alt.crystall1ne.dev").then((s) => [s.key, s.kind, s.name, s.count])`));
console.log("AppTesters page:", await backend(`(b) => b.addSource("https://repository.apptesters.org").then((s) => [s.key, s.kind, s.name, s.count])`));
await size(844);
await q(`localStorage.setItem("cydian.device", "none")`); await p.send("Page.reload"); await sleep(3000);
await go("#/sources/" + encodeURIComponent("alt:https://alt.crystall1ne.dev/"), 5000);
console.log("--- crystall1ne page\n" + (await text()).slice(0, 500));
await shot("4-crystall1ne-source-page");
console.log("errors:", errs);
await p.close();
