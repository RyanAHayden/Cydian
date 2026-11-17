// F9 walk-through at 390x844 3x: add the fixture AltStore source, then Sources, the source page, All Apps, an app
// page, Changes after a bump, and Search. Needs serve.py on :8747 and chromium --remote-debugging-port=9347.
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const here = new URL(".", import.meta.url).pathname;
rmSync(here + "bump", { force: true });
const base = "http://127.0.0.1:8747/index.html";
const p = await open(9347);
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
const go = async (hash, ms = 1200) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = () => p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? document.body.innerText`);
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
// iOS 16.5: Emu 2.0 (iOS 17+) is hidden, 1.5 shows.
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/sources" }); await sleep(1500);
const added = await p.evaluate(`import("./backend.js").then((m) => m.getBackend().addSource("https://example.dev/apps.json")).then((s) => JSON.stringify(s))`);
console.log("added", added);
await p.send("Page.reload"); await sleep(2000);
await shot("1-sources"); console.log("--- sources\n", (await text()).slice(0, 600));
const key = encodeURIComponent("alt:https://example.dev/apps.json");
await go(`#/sources/${key}`, 2500); await shot("2-source-page"); console.log("--- source page\n", await text());
await go(`#/sources/${key}/section%3A*`, 1500); await shot("3-all-apps"); console.log("--- all apps\n", await text());
await go(`#/sources/${key}/section%3A*/package%3Adev.example.emu`, 1500); await shot("4-app"); console.log("--- app\n", await text());
await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .page-body, .tab-stack.is-active .page.is-top')?.scrollBy?.(0, 900)`); await sleep(300); await shot("4b-app-scrolled");
await go(`#/sources/${key}/section%3A*/package%3Adev.example.signed`, 1500); await shot("5-signed"); console.log("--- signed\n", await text());
// Changes: a refresh with Legacy bumped files it under a new group.
writeFileSync(here + "bump", "");
await go("#/changes", 1500);
await p.evaluate(`import("./backend.js").then((m) => m.getBackend().refreshSources())`); await sleep(500);
await p.send("Page.reload"); await sleep(2500);
await shot("6-changes"); console.log("--- changes\n", await text());
rmSync(here + "bump", { force: true });
console.log("errors:", errs);
await p.close();
