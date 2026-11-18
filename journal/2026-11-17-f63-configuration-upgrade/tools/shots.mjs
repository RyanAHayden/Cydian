// F63 walk-through at 390x844 3x: a Downgrade of Example Tweak whose /etc/example.conf both sides changed
// (FAKE_CONFFILE): Confirm, the console with the Configuration Upgrade alert, Accept The New Copy, the console
// complete; then the same run answered Keep My Old Copy.
// Needs serve.mjs on :8781 and chromium --remote-debugging-port=9381. Usage: node shots.mjs <out dir>
// SPDX-License-Identifier: GPL-3.0-or-later
import { open, sleep, phone } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8781/index.html";
const t = process.env.THEME || "light";
const p = await open(9381);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const env = (e) => fetch("http://127.0.0.1:8781/env", { method: "POST", body: JSON.stringify(e) });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}-${t}.png`, Buffer.from(data, "base64"));
};
const text = (sel) => p.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
const click = (js) => p.evaluate(`(() => { const e = ${js}; if (!e) return false; e.click(); return true; })()`);
const byText = (sel, txt) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(txt)})`;
await phone(p);
await env({});
await p.send("Page.navigate", { url: base + "#/sources" }); await sleep(1500);
console.log(await p.evaluate(`(async () => {
  localStorage.setItem("cydian.appearance", ${JSON.stringify(t)});
  localStorage.removeItem("cydian.consoleLogs");
  const b = (await import("./backend.js")).getBackend();
  const r = await b.refreshSources();
  return r.map((s) => s.key + " " + s.count).join(", ");
})()`));
await p.send("Page.reload"); await sleep(2500);
for (const [n, button] of [["a", "Accept The New Copy"], ["b", "Keep My Old Copy"]]) {
  await env({ FAKE_CONFFILE: "/var/jb/etc/example.conf", FAKE_SLOW: "1" });
  await p.evaluate(`(async () => (await import("./backend.js")).getBackend().queue({ op: "install", id: "com.example.tweak", version: n === "a" ? "0.9" : null, installed: null }))()`.replace('n === "a"', JSON.stringify(n === "a")));
  await sleep(2000); await shot(`${n}1-confirm`); console.log(`--- ${n} confirm:`, await text(".confirm-sheet"));
  await click(`document.querySelector('.confirm-sheet .sheet-right .bar-button')`); await sleep(3500);
  await shot(`${n}2-alert`); console.log(`--- ${n} alert:`, await text(".alert"), "| console:", await text(".console"));
  await click(byText(".alert-button", button)); await sleep(2500);
  await shot(`${n}3-complete`); console.log(`--- ${n} complete:`, await text(".console"));
  await click(`document.querySelector('.console .sheet-right .bar-button')`); await sleep(900);
}
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
process.exit(0);
