// I5 walk-through at 390x844 3x (iOS 17.2 UA, Not Jailbroken): Settings with no certificate, the Signing page,
// the files loaded (as the file pickers would: saveIdentity with the bytes), a wrong password, the right one, the
// root row, then an AltStore app's nav-bar Install: HUD "Signing", POST /sign, HUD "Installing", itms-services.
// Needs serve.py on :8749 and chromium --remote-debugging-port=9349. Usage: node shots.mjs <out dir>
import { open, sleep } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8749/index.html";
const t = process.env.THEME || "light";
const p = await open(9349);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [], navs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 500));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
  if (d.method === "Page.frameRequestedNavigation" || d.method === "Page.frameStartedNavigating") navs.push(d.params.url);
});
const shot = async (name) => { const { data } = await p.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${name}-${t}.png`, Buffer.from(data, "base64")); };
const go = async (hash, ms = 1500) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = () => p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top')?.innerText ?? document.body.innerText`);
const scroll = (y) => p.evaluate(`(() => { const t = document.querySelector('.tab-stack.is-active .page.is-top'); const s = [t, ...t.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 5 && getComputedStyle(e).overflowY !== 'visible'); if (s) s.scrollTop = ${y}; return !!s; })()`);
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" });
await p.send("Page.navigate", { url: base + "#/settings" }); await sleep(1500);
console.log(await p.evaluate(`(async () => {
  localStorage.setItem("cydian.device", "none");
  localStorage.setItem("cydian.appearance", ${JSON.stringify(t)});
  localStorage.setItem("cydian.signingServer", location.origin);
  (await import("./signing-client.js")).clearIdentity();
  const b = (await import("./backend.js")).getBackend();
  for (const s of await b.sources()) await b.removeSource(s.key);
  return (await b.addSource("https://alt.example/apps.json")).key;
})()`));
await p.send("Page.reload"); await sleep(2500);
await go("#/settings", 1200); await scroll(2000); await sleep(300); await shot("1-settings-none");
await go("#/settings/signing", 1500); await shot("2-signing-empty"); console.log("--- signing (empty)\n", await text());
// What the pickers do: the files' bytes into IndexedDB. A wrong password first.
await p.evaluate(`(async () => {
  const c = await import("./signing-client.js");
  const bytes = async (n) => new Uint8Array(await (await fetch("/fx/" + n)).arrayBuffer());
  await c.saveIdentity({ p12: await bytes("test.p12"), p12Name: "Test Person.p12", password: "nope",
    profile: await bytes("test.mobileprovision"), profileName: "Walkthrough.mobileprovision" });
  const s = await import("./core/signing.js");
  await c.saveIdentity({ passwordOk: await s.checkP12Password((await c.loadIdentity()).p12, "nope") });
})()`);
await go("#/settings", 800); await go("#/settings/signing", 1500); await shot("3-signing-wrong-password"); console.log("--- wrong password\n", await text());
// The password row opens the alert; type the right one.
await p.evaluate(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .cell-inner')].find((b) => b.innerText.startsWith('Password')).click()`);
await sleep(700); await shot("4-password-alert");
await p.evaluate(`(() => { const f = document.querySelector('.alert-field'); f.value = 'hunter2'; [...document.querySelectorAll('.alert-button')].at(-1).click(); })()`);
await sleep(1500); await shot("5-signing-set"); console.log("--- set\n", await text());
await scroll(2000); await sleep(300); await shot("6-signing-set-bottom");
await go("#/settings", 1500); await scroll(2000); await sleep(300); await shot("7-settings-cert"); console.log("--- settings\n", await text());
const alt = encodeURIComponent("alt:https://alt.example/apps.json");
const app = `#/sources/${alt}/section%3A*/package%3Adev.example.fixture`;
await go(app, 2500); await shot("8-app"); console.log("--- app\n", await text());
await p.evaluate(`[...document.querySelectorAll('.nav-stack[data-tab="sources"] > .nav-item')].at(-1).querySelector('.nav-right .bar-button').click()`);
await sleep(120); await shot("9-hud-signing");
for (let i = 0; i < 40 && !navs.some((u) => u.startsWith("itms-services:")); i++) await sleep(250);
await shot("10-hud-installing");
console.log("navigations:", navs.filter((u) => !u.startsWith("http")).join("\n") || "none");
console.log("hud:", await p.evaluate(`document.querySelector('.hud-label')?.textContent ?? "none"`));
await sleep(3000);
// A wrong password now: the server's clear error in an alert.
await p.evaluate(`(async () => { const c = await import("./signing-client.js"); await c.saveIdentity({ password: "nope" }); })()`);
await p.evaluate(`[...document.querySelectorAll('.nav-stack[data-tab="sources"] > .nav-item')].at(-1).querySelector('.nav-right .bar-button').click()`);
await sleep(2000); await shot("11-error-alert"); console.log("alert:", await p.evaluate(`document.querySelector('.alert')?.innerText ?? "none"`));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
