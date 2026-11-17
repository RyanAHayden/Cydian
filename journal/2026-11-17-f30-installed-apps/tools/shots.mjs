// F30 walk-through at 390x844 3x on the site: add the fixture AltStore source, tap Download IPA on Emu's page,
// then the Installed tab (the record), an older record (Upgrade badge), Edit, and Delete.
// Needs serve.py on :8761 and chromium --remote-debugging-port=9361.
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8761/index.html";
const p = await open(9361);
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
const go = async (hash, ms = 1500) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = () => p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? document.body.innerText`);
const click = (sel, txt) => p.evaluate(`(() => { const e = [...document.querySelectorAll('.tab-stack.is-active .page.is-top ${sel}, .tab-stack.is-active .nav-item:last-child ${sel}')].find((x) => x.textContent.trim() === ${JSON.stringify(txt)}); if (!e) return "missing"; e.click(); return "ok"; })()`);
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/installed" }); await sleep(1500);
await shot("1-empty"); console.log("--- empty\n", await text());
console.log("added", await p.evaluate(`import("./backend.js").then((m) => m.getBackend().addSource("https://example.dev/apps.json")).then((s) => s.key)`));
await p.send("Page.reload"); await sleep(2000);
await p.evaluate(`window.open = (u) => { window.__opened = u; }`);
const key = encodeURIComponent("alt:https://example.dev/apps.json");
await go(`#/sources/${key}/package%3Adev.example.emu`, 2000);
console.log("tap", await click(".cell-label", "Download IPA"), await p.evaluate("window.__opened")); await sleep(500);
await go("#/installed", 2500); await shot("2-recorded"); console.log("--- recorded\n", await text());
// An older record of another app the source carries: the Upgrade badge.
await p.evaluate(`import("./core/installed.js").then(async (m) => m.recordInstall(await m.apps(), { id: "dev.example.legacy", name: "Legacy", version: "1.0", source: "https://example.dev/apps.json", sourceName: "Example" }, Date.now() - 86400000 * 3))`);
await sleep(2500); await shot("3-upgrade"); console.log("--- upgrade\n", await text());
console.log("edit", await p.evaluate(`(() => { const b = document.querySelector(".nav-stack.is-active .nav-item:last-child .nav-right .bar-button"); if (!b) return "missing"; b.click(); return b.textContent; })()`)); await sleep(500); await shot("4-edit");
await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .installed-app .del-toggle').click()`); await sleep(500); await shot("5-armed");
await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .installed-app.armed .del-confirm').click()`); await sleep(1500);
await shot("6-deleted"); console.log("--- deleted\n", await text());
console.log("left in db", await p.evaluate(`import("./core/installed.js").then(async (m) => JSON.stringify((await (await m.apps()).all()).map((r) => [r.id, r.version])))`));
await go("#/installed/dpkg", 1500); await shot("7-dpkg"); console.log("--- dpkg\n", await text());
console.log("errors:", errs);
await p.close();
