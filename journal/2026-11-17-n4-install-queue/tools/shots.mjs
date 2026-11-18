// N4 walk-through at 390x844 3x: the package page's Modify > Downgrade > a version, Confirm, Continue Queuing, the
// marks in the list, the Installed tab's Queue button, Confirm > the console mid-run and complete, Settings >
// Console Logs, then apt refusing (Cannot Comply with F18's sentence above apt's output).
// Needs serve.mjs on :8761 and chromium --remote-debugging-port=9361. Usage: node shots.mjs <out dir>
import { open, sleep, phone } from "../../2026-11-17-f9-altstore-sources/tools/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8761/index.html";
const t = process.env.THEME || "light";
const p = await open(9361);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 600));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errs.push(JSON.stringify(d.params.args).slice(0, 300));
});
const env = (e) => fetch("http://127.0.0.1:8761/env", { method: "POST", body: JSON.stringify(e) });
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}-${t}.png`, Buffer.from(data, "base64"));
};
const go = async (hash, ms = 1500) => { await p.evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
const text = (sel = ".tab-stack.is-active .page.is-top") => p.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
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
const H = encodeURIComponent("deb:https://havoc.app/:./");
const list = `#/sources/${H}/section%3A*`;
const pkg = `${list}/package%3Acom.example.tweak`;
await go(pkg, 2500); await shot("1-package");
await click(`[...document.querySelectorAll('.nav-stack[data-tab="sources"] > .nav-item')].at(-1).querySelector('.nav-right .bar-button')`);
await sleep(800); await shot("2-modify"); console.log("--- modify:", await text(".action-sheet"));
await click(byText(".action-button", "Downgrade")); await sleep(900); await shot("3-downgrade"); console.log("--- downgrade:", await text(".action-sheet"));
await click(byText(".action-button", "0.9")); await sleep(2000); await shot("4-confirm"); console.log("--- confirm:", await text(".confirm-sheet"));
await click(byText(".confirm-sheet .cell-label", "Continue Queuing")); await sleep(1200); await shot("5-package-queued"); console.log("--- page:", (await text()).slice(0, 400));
await go(list, 1500); await shot("6-list-marked"); console.log("--- list:", await text());
await go("#/installed", 1500); await shot("7-installed-queue"); console.log("--- installed:", await text(), "| badge:", await p.evaluate(`document.querySelector('.tab[data-tab="installed"] .badge').textContent`));
await env({ FAKE_SLOW: "4", FAKE_FINISH: "" });
await click(`document.querySelector('.queue-button')`); await sleep(1800); await shot("8-confirm-again");
await click(`document.querySelector('.confirm-sheet .sheet-right .bar-button')`); await sleep(2500); await shot("9-console-running"); console.log("--- running:", await text(".console"));
await sleep(4500); await shot("10-console-complete"); console.log("--- complete:", await text(".console"));
await click(`document.querySelector('.console .sheet-right .bar-button')`); await sleep(900);
await go(pkg, 2000); console.log("--- page after:", (await text()).slice(0, 300));
await go("#/settings/logs", 1500); await shot("11-logs"); console.log("--- logs:", await text());
await click(`document.querySelector('.tab-stack.is-active .page.is-top a.cell-inner')`); await sleep(1500); await shot("12-log"); console.log("--- log:", await text());
// apt refuses: Cannot Comply
await env({ FAKE_FAIL: "simulate", FAKE_MISSING: "mobilesubstrate" });
await go(`#/sources/${H}/section%3A*/package%3Acom.example.held`, 2500);
await click(`[...document.querySelectorAll('.nav-stack[data-tab="sources"] > .nav-item')].at(-1).querySelector('.nav-right .bar-button')`);
await sleep(800); console.log("--- held sheet:", await text(".action-sheet"));
await click(byText(".action-button", "Remove")); await sleep(2000); await shot("13-cannot-comply"); console.log("--- cannot:", await text(".confirm-sheet"));
await p.evaluate(`(() => { const s = document.querySelector('.confirm-sheet .sheet-scroll'); s.scrollTop = 9999; })()`); await sleep(300); await shot("14-cannot-comply-bottom");
await click(`document.querySelector('.confirm-sheet .sheet-left .bar-button')`); await sleep(800);
console.log("--- queue after Cancel:", await p.evaluate(`(async () => (await import("./queue.js")).installQueue.size)()`));
console.log("errors:", errs.length ? errs.join("\n") : "none");
await p.close();
process.exit(0);
