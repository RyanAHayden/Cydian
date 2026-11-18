import { open, sleep } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const base = "http://127.0.0.1:8767/index.html";
const p = await open(9367);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600)); });
const shot = async (name) => { const { data } = await p.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(1500);
await p.evaluate(`localStorage.setItem("cydian.device", "iphoneos-arm64"); localStorage.setItem("cydian.arch", "iphoneos-arm64")`);
await p.send("Page.reload"); await sleep(2000);
await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .page-body, .page.is-top')?.scrollBy?.(0, 300)`);
await shot("home");
await p.evaluate(`location.hash = "#/sources"`); await sleep(6000);
for (const r of ["browse", "browse/new", "browse/free-tweaks", "browse/popular", "browse/free-apps", "browse/featured"]) {
  await p.evaluate(`location.hash = "#/home/${r}"`); await sleep(2500);
  await shot(r.replace("/", "-"));
  if (r === "browse/free-tweaks") { await p.evaluate(`(() => { const i = document.querySelector(".page.is-top .list-search input") ?? [...document.querySelectorAll(".list-search input")].pop(); i.value = "ess"; i.dispatchEvent(new Event("input")); })()`); await sleep(800); await shot("free-tweaks-searched"); }
}
console.log("errors:", errs);
await p.close();
