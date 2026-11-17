// Home in light and dark at the 4S's size (320x480 CSS px, 2x) and on a modern phone (390x844, 3x), plus its pages
// and a held tile. Needs a static server on :8746 serving web/app and chromium with --remote-debugging-port=9346.
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8746/index.html";
const p = await open(9346);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const size = async (w, h, s) => p.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: s, mobile: true });
for (const theme of ["light", "dark"]) {
  await size(320, 460, 2); // 4S: 480 less the 20pt status bar, which the shot's page doesn't draw
  await p.send("Page.navigate", { url: base + "#/home" }); await sleep(600);
  await p.evaluate(`localStorage.setItem("cydian.appearance", ${JSON.stringify(theme)})`);
  await p.send("Page.reload"); await sleep(1200);
  await shot(`${theme}-home-4s`);
  // held: press the Featured tile the way app.js does
  await p.evaluate(`document.querySelectorAll('.tab-stack.is-active .page.is-top .home-tile')[2].classList.add('is-pressed')`);
  await shot(`${theme}-home-4s-held`);
  await p.evaluate(`document.querySelector('.is-pressed')?.classList.remove('is-pressed')`);
  await size(390, 844, 3); await sleep(300);
  await shot(`${theme}-home`);
  for (const page of ["help", "featured", "sources", "about"]) {
    await p.evaluate(`location.hash = "#/home/${page}"`); await sleep(800);
    await shot(`${theme}-home-${page}`);
    await p.evaluate(`location.hash = "#/home"`); await sleep(600);
  }
  console.log(theme, await p.evaluate(`document.querySelector('.home-row.green a').textContent`));
}
console.log("errors:", errs);
await p.close();
