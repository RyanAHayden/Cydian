// F68 shots at 390x844 3x: the look-first sheet (top, then scrolled to the extensions and Sign & Install) and
// Settings > Signing's Certificate Status and Signed Apps. Needs serve.mjs on :8782 and chromium
// --remote-debugging-port=9382. Usage: node shots.mjs <out dir> [suffix]   SPDX-License-Identifier: GPL-3.0-or-later
import { open, sleep, phone } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const suffix = process.argv[3] || "light";
const base = "http://127.0.0.1:8782/index.html";
const p = await open(9382);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}-${suffix}.png`, Buffer.from(data, "base64"));
};
await phone(p);
await p.send("Page.navigate", { url: base + "#/settings" }); await sleep(800);
await p.evaluate(`localStorage.setItem("cydian.appearance", ${JSON.stringify(process.env.THEME || "light")})`);
await p.send("Page.reload"); await sleep(2000);
await shot("1-settings-root");
console.log("root:", await p.evaluate(`[...document.querySelectorAll(".group-header")].map((e) => e.textContent).join(" | ")`));
// the sheet
await p.evaluate(`import("./signing-sheet.js").then((m) => { window.__done = m.inspectAndInstall({ url: "https://example.com/Delta.ipa", name: "Delta" }); })`);
await sleep(1200);
await shot("2-sheet-top");
console.log("sheet:", await p.evaluate(`document.querySelector(".sign-sheet")?.innerText.replace(/\\n+/g, " / ").slice(0, 900)`));
await p.evaluate(`(() => { const s = document.querySelector(".sign-sheet"); s.scrollTop = 520; })()`); await sleep(300);
await shot("3-sheet-middle");
await p.evaluate(`(() => { const s = document.querySelector(".sign-sheet"); s.scrollTop = s.scrollHeight; })()`); await sleep(300);
await shot("4-sheet-bottom");
// edit name, turn the widget off, Sign & Install
await p.evaluate(`(() => { const i = document.querySelector(".ss-field input"); i.value = "Delta 2"; i.dispatchEvent(new Event("input")); document.querySelector(".ss-ext .switch").click(); document.querySelector(".ss-sign").click(); })()`);
await sleep(1200);
console.log("calls:", JSON.stringify(await p.evaluate(`__calls.filter((c) => c.method.startsWith("signing.")).map((c) => [c.method, c.params])`)));
await sleep(1500);
// Settings > Signing
await p.send("Page.navigate", { url: base + "#/settings/signing" }); await sleep(2000);
await p.evaluate(`(() => { const s = document.querySelector(".signed-apps"); s?.scrollIntoView({ block: "end" }); })()`); await sleep(400);
await shot("5-signing-status");
console.log("signing:", await p.evaluate(`document.querySelector(".signed-apps")?.innerText.replace(/\\n+/g, " / ")`));
// arm a row's Delete as a left swipe would
await p.evaluate(`document.querySelector(".signed-row").classList.add("armed")`); await sleep(400);
await shot("6-signed-swipe");
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
process.exit(0);
