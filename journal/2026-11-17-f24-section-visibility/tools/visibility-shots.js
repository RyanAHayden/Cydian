// F24 Section Visibility, live: run with F5's drive.mjs (journal/2026-11-17-f5-packages/tools/drive.mjs).
const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
const topAll = (sel) => `[...document.querySelectorAll('.tab-stack.is-active .page.is-top ${sel}')]`;
const navTop = `document.querySelector('.nav-stack[data-tab="sources"] > .nav-item.is-top')`;
await q(`localStorage.setItem("cydian.arch", "iphoneos-arm64"); localStorage.removeItem("cydian.hiddenSections")`);
await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 500);
await waitFor(`${top(".section-row")}`, 120000); await sleep(500);
const names = () => q(`${topAll(".section-row .cell-label")}.map(e => e.textContent).join(" | ")`);
const before = await names();
console.log("sections:", before);
const total = () => q(`${top(".section-row .folder-count")}.textContent`);
console.log("All Packages:", await total());
// Edit
await q(`${navTop}.querySelector('.nav-right .bar-button').click()`); await sleep(1200);
console.log("title:", await q(`${navTop}.querySelector('.nav-title').textContent`), "button:", await q(`${navTop}.querySelector('.nav-right .bar-button').textContent`));
console.log("switch rows:", await q(`${topAll(".section-row .switch")}.length`), "rows:", await q(`${topAll(".section-row")}.length`));

// hide the first two sections
const hide = await q(`(() => { const rows = ${topAll(".section-row")}.slice(0, 2); rows.forEach(r => r.querySelector('.switch').click()); return rows.map(r => r.querySelector('.cell-label').textContent).join(","); })()`);
console.log("hid:", hide, "stored:", await q(`localStorage.getItem("cydian.hiddenSections")`));
await sleep(300);
await shot("edit-mode-two-off");
await q(`${navTop}.querySelector('.nav-right .bar-button').click()`); await sleep(1500);
console.log("title after Done:", await q(`${navTop}.querySelector('.nav-title').textContent`));
console.log("sections after:", await names());
console.log("All Packages after:", await total());
await shot("sections-after");
// Search for a package in a hidden section
const hiddenFirst = hide.split(",")[0];
const sample = await q(`(async () => { const c = (await import("/catalog.js")).catalog; c.setHidden([]); const r = await c.list("*", ${JSON.stringify(hiddenFirst)}); c.setHidden(JSON.parse(localStorage.getItem("cydian.hiddenSections"))); return r[0]?.name; })()`);
console.log("a package in", hiddenFirst, ":", sample);
const hits = await q(`(async () => (await (await import("/catalog.js")).catalog.search(${JSON.stringify(sample ?? "zzz")})).map(r => r.name + "/" + r.section).slice(0, 5).join(" | "))()`);
console.log("search for it now:", hits);
// Reload: the hidden set survives
await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 500);
await waitFor(`${top(".section-row")}`, 120000); await sleep(500);
console.log("after reload:", await names());
// Show them again
await q(`${navTop}.querySelector('.nav-right .bar-button').click()`); await sleep(1200);
await q(`${topAll(".section-row .switch[aria-checked=false]")}.forEach(s => s.click())`);
await q(`${navTop}.querySelector('.nav-right .bar-button').click()`); await sleep(1500);
console.log("restored equal:", (await names()) === before, "stored:", await q(`localStorage.getItem("cydian.hiddenSections")`));
await q(`document.documentElement.dataset.theme = "dark"`);
await q(`${navTop}.querySelector('.nav-right .bar-button').click()`); await sleep(1200);
await shot("edit-mode-dark");
