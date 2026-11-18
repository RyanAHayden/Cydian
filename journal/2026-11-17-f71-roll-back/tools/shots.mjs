// F71 walk-through at 390x844 3x: an installed package's page with its Roll Back group (0.9, 0.8, and a 0.7 whose
// control says 0.6), the confirm sheet, the console mid-run and complete, the page after (Installed Package 0.9),
// Settings > Console Logs' title, and the refused 0.7 in the console.
// Needs serve.mjs on :8771 and chromium --remote-debugging-port=9371. Usage: node shots.mjs <out dir>
// SPDX-License-Identifier: GPL-3.0-or-later
import { open, sleep, phone } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8771/index.html";
const t = process.env.THEME || "light";
const p = await open(9371);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const env = (e) => fetch("http://127.0.0.1:8771/env", { method: "POST", body: JSON.stringify(e) });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}-${t}.png`, Buffer.from(data, "base64"));
};
const go = async (hash, ms = 1500) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = (sel = ".tab-stack.is-active .page.is-top") => p.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
const click = (js) => p.evaluate(`(() => { const e = ${js}; if (!e) return false; e.click(); return true; })()`);
const byText = (sel, txt) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim() === ${JSON.stringify(txt)})`;
const toRollback = `(() => { const s = document.querySelector('.tab-stack.is-active .page.is-top .package-rollback-slot'); if (s) s.scrollIntoView({ block: "center" }); return Boolean(s); })()`;
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
const H = encodeURIComponent("deb:https://havoc.app/:./");
const pkg = `#/sources/${H}/section%3A*/package%3Acom.example.tweak`;
await go(pkg, 3000);
console.log("--- slot:", await p.evaluate(toRollback)); await sleep(400);
await shot("1-package-roll-back"); console.log("--- page:", await text());
await click(byText(".tab-stack.is-active .page.is-top .package-rollback-slot .cell-label", "0.9")); await sleep(900);
await shot("2-confirm"); console.log("--- sheet:", await text(".action-sheet"));
await env({ FAKE_SLOW: "3", FAKE_FINISH: "restart" });
await click(byText(".action-button", "Roll Back to 0.9")); await sleep(1800);
await shot("3-console-running"); console.log("--- running:", await text(".console"));
await sleep(3500); await shot("4-console-complete"); console.log("--- complete:", await text(".console"));
await click(`document.querySelector('.console .sheet-right .bar-button')`); await sleep(900);
await env({});
await go("#/sources", 800); await go(pkg, 3000);
await p.evaluate(toRollback); await sleep(400);
await shot("5-package-after"); console.log("--- page after:", await text());
await go("#/settings/logs", 1500); await shot("6-logs"); console.log("--- logs:", await text());
// the 0.7 copy's control says 0.6: the helper refuses, the console says so
await go(pkg, 2500); await p.evaluate(toRollback); await sleep(300);
await click(byText(".tab-stack.is-active .page.is-top .package-rollback-slot .cell-label", "0.7")); await sleep(900);
await click(byText(".action-button", "Roll Back to 0.7")); await sleep(2500);
await shot("7-refused"); console.log("--- refused:", await text(".console"));
await click(`document.querySelector('.console .sheet-right .bar-button')`); await sleep(900);
console.log("--- queue size (untouched):", await p.evaluate(`(async () => (await import("./queue.js")).installQueue.size)()`));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
process.exit(0);
