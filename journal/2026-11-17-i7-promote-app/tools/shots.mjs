// I7: Home's Install Cydian App tile (Not Jailbroken with and without a certificate, jailbroken) and Settings >
// Signing's green row, at 390x844 3x. Needs a static server on :8747 serving web/app and chromium with
// --remote-debugging-port=9347.
import { open, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8747/index.html";
const p = await open(9347);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => { if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400)); });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(1500);
const tile = `[...document.querySelectorAll('.home-tile')].find((a) => a.textContent === "Install Cydian App")`;
console.log("no cert: tile shown", await p.evaluate(`!${tile}.closest('.home-row').hidden`));
await shot("home-nocert");
await p.evaluate(`import("./signing-client.js").then((m) => m.saveIdentity({ p12: new Uint8Array([0x30]), p12Name: "me.p12", profile: new Uint8Array([1]), profileName: "me.mobileprovision", password: "x", passwordOk: true }))`);
await sleep(300);
await p.evaluate(`location.hash = "#/settings/signing"`); await sleep(1200);
console.log("signing row:", await p.evaluate(`document.querySelector('.tab-stack.is-active .page.is-top .app-offer')?.textContent ?? null`));
await shot("signing-row");
for (const theme of ["dark"]) {
  await p.evaluate(`localStorage.setItem("cydian.appearance", "dark")`);
  await p.send("Page.reload"); await sleep(1500);
  await shot("signing-row-dark");
  await p.evaluate(`localStorage.setItem("cydian.appearance", "light")`);
}
await p.evaluate(`location.hash = "#/home"`); await p.send("Page.reload"); await sleep(1500);
await shot("home-cert");
// jailbroken: Settings > Device rootless
await p.evaluate(`localStorage.setItem("cydian.device", "iphoneos-arm64")`);
await p.send("Page.reload"); await sleep(1500);
console.log("jailbroken: tile shown", await p.evaluate(`!${tile}.closest('.home-row').hidden`));
await shot("home-jailbroken");
console.log("errors:", errs);
await p.close();
