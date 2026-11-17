import { open, sleep, phone } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8731/index.html";
const p = await open();
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300)); });
console.log("insets:", await phone(p));
const shots = [
  ["home", "#/home"], ["home-about", "#/home/about"], ["sources", "#/sources"],
  ["sources-detail", "#/sources/" + encodeURIComponent("https://repo.chariz.com/")],
  ["changes", "#/changes"], ["installed", "#/installed"], ["search", "#/search"],
];
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(800);
for (const [name, hash] of shots) {
  await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(600);
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
}
// HUD over Sources
await p.evaluate(`location.hash = "#/sources"`); await sleep(500);
await p.evaluate(`document.querySelector('.nav-stack.is-active .nav-item.is-top .nav-left .bar-button').click()`); await sleep(300);
let { data } = await p.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${out}/sources-hud.png`, Buffer.from(data, "base64"));
console.log("errors:", errs);
await p.close();
