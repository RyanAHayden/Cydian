// Screenshots of every screen in light and dark, plus the Settings pages. Needs a static server on :8732 serving
// web/app and chromium with --remote-debugging-port=9334 (see notes.md).
import { open, sleep, phone } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8732/index.html";
const p = await open(9334);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300)); });
await phone(p);
const screens = [
  ["home", "#/home"], ["home-about", "#/home/about"], ["sources", "#/sources"],
  ["changes", "#/changes"], ["installed", "#/installed"], ["search", "#/search"],
  ["settings", "#/settings"], ["settings-arch", "#/settings/arch"],
];
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
for (const theme of ["light", "dark"]) {
  await p.send("Page.navigate", { url: base + "#/home" }); await sleep(600);
  await p.evaluate(`localStorage.setItem("cydian.appearance", ${JSON.stringify(theme)})`);
  await p.send("Page.reload"); await sleep(900);
  for (const [name, hash] of screens) {
    await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(700);
    await shot(`${theme}-${name}`);
  }
  console.log(theme, await p.evaluate(`[document.documentElement.dataset.theme, [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content).join(" ")]`));
}
// Automatic follows the system; and the toggle's switch on.
await p.evaluate(`location.hash = "#/settings"`); await sleep(400);
await p.evaluate(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .cell-inner')].find(c => c.textContent === "Automatic").click()`);
await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); await sleep(400);
console.log("auto+system dark:", await p.evaluate(`document.documentElement.dataset.theme`));
await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .switch').click()`); await sleep(400);
await shot("auto-dark-settings-switch-on");
await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }); await sleep(400);
console.log("auto+system light:", await p.evaluate(`document.documentElement.dataset.theme`));
await shot("auto-light-settings-switch-on");
console.log("stored:", await p.evaluate(`JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("cydian."))))`));
console.log("errors:", errs);
await p.close();
