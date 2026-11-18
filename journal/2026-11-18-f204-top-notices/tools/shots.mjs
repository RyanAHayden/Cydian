// F204 check at 390x844 3x with a notch's safe areas (47/34): Changes, then Changes with a banner (Upgrade) and the
// reload bar; a package page (Back) the same; and a sheet with a banner. Prints the nav bar's, the first row's and
// Back's boxes before and after: they must not move. Needs serve.py on :8764 and chromium --remote-debugging-port=9364.
// Usage: node shots.mjs <shots dir>
import { open, sleep, phone } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8764/index.html";
const p = await open(9364);
await p.send("Page.enable"); await p.send("Runtime.enable");
const errs = [];
p.on((d) => {
  if (d.method === "Runtime.exceptionThrown") errs.push(JSON.stringify(d.params.exceptionDetails).slice(0, 400));
});
const shot = async (name) => {
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
};
const q = (e) => p.evaluate(e);
const go = async (hash, ms = 1500) => { await q(`location.hash = ${JSON.stringify(hash)}`); await sleep(ms); };
console.log("insets:", await phone(p));
await p.send("Page.navigate", { url: base + "#/home" }); await sleep(1500);
await q(`localStorage.clear(); localStorage.setItem("ifizbox.appearance", "light"); localStorage.setItem("ifizbox.device", "rootless")`);
console.log("added apt", await q(`import("./backend.js").then((m) => m.getBackend().addSource("https://repo.example/")).then((s) => s.key, (e) => "ERR " + e.message)`));
await p.send("Page.reload"); await sleep(2500);

const boxes = () => q(`JSON.stringify((() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(","); };
  const page = document.querySelector('.tab-stack.is-active .page.is-top');
  const sheet = [...document.querySelectorAll('.sheet')].at(-1);
  const row = (sheet ?? page)?.querySelector('.cell, .pkg-row');
  return { navbar: r(sheet ? sheet.querySelector('.sheet-bar') : document.getElementById('navbar')),
    row: r(row), back: r(document.querySelector('.nav-stack.is-active .nav-item.is-top .bar-button.back')),
    scrollTop: (sheet ? sheet.querySelector('.sheet-scroll, .page-body') : page?.querySelector('.page-body'))?.scrollTop,
    scrollHeight: (sheet ? sheet.querySelector('.sheet-scroll, .page-body') : page?.querySelector('.page-body'))?.scrollHeight,
    banner: r(document.querySelector('.banner')), reload: r(document.querySelector('.reload-bar')),
    tabbar: r(document.getElementById('tabbar')) };
})())`);
const notices = async (action = true) => {
  await q(`import("./nav/banner.js").then((m) => { m.showBanner({ message: "A new version is out.", ${action ? 'action: { label: "Upgrade", onClick() {} }' : ""} }); })`);
  await q(`import("./nav/reloadbar.js").then((m) => { window.__rb = m.showReloadBar("Updating Sources"); })`);
  await sleep(700);
};
const clear = async () => { await q(`document.querySelector('.banner')?.click(); window.__rb?.dismiss()`); await sleep(600); };

await go("#/changes", 2500);
const a = await boxes(); await shot("1-changes");
await notices();
const b = await boxes(); await shot("2-changes-banner-reload");
await sleep(3000); await shot("3-changes-banner-timer-later");
await clear();
console.log("changes before", a); console.log("changes after ", b);

// a pushed page with Back and a list: on the website Changes is empty (no source data) and the other list tabs are
// locked, so Settings' first row that opens a page
await go("#/settings", 1500);
await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .cell-inner')].find((e) => e.closest('.cell')?.querySelector('.chevron, .cell-chevron') || e.matches('a, [href]') || e.closest('a'))?.click()`);
await sleep(1500);
console.log("pushed to", await q("location.hash"));
const c = await boxes(); await shot("4-pushed");
await notices();
const d = await boxes(); await shot("5-pushed-banner-reload");
await clear();
console.log("pushed before", c); console.log("pushed after ", d);

// a sheet: the banner goes under its nav bar, the reload bar to its bottom
await q(`import("./nav/sheet.js").then((m) => { const b = document.createElement("div"); b.className = "sheet-scroll page-body grouped"; b.innerHTML = '<div class="group"><div class="cell"><div class="cell-inner">Row one</div></div></div>'; window.__close = m.showSheet({ title: "Sheet", body: b }); })`);
await sleep(800);
const e = await boxes(); await shot("6-sheet");
await notices(false);
const f = await boxes(); await shot("7-sheet-banner-reload");
await sleep(150);
console.log("sheet before", e); console.log("sheet after ", f);
console.log("banner parent in sheet:", await q(`!!document.querySelector('.sheet .banner')`));
console.log("errors:", errs.length ? errs : "none");
await p.close();
process.exit(0);
