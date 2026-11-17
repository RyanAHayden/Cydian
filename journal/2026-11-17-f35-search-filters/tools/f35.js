// node journal/2026-11-17-f5-packages/tools/drive.mjs <port> <base> this.js <shots dir>
const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
const type = async (text) => { await q(`(() => { const i = ${top("input")}; i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })()`); await sleep(2500); };
const rows = () => q(`JSON.stringify([...document.querySelectorAll('.tab-stack.is-active .page.is-top .pkg-row:not([hidden])')].slice(0,8).map(e => [e.querySelector('.pkg-name').textContent, e.querySelector('.compat-mark').dataset.mark || '-', e.querySelector('.pkg-name').classList.contains('incompatible') ? 'RED' : '', e.querySelector('.pkg-desc').textContent]))`);
await q(`localStorage.setItem("cydian.iosVersion", "16.5"); localStorage.removeItem("cydian.worksOnMyPhone"); localStorage.setItem("cydian.appearance", "light")`);
await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 1500); await waitFor(top(".section-row"), 180000); await sleep(800);
await go("#/search", 800);
await type("flex");
console.log("flex, default:", await rows());
await shot("search-light");
// Themes segment
await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .scope-segment')][2].click()`); await sleep(1500);
console.log("flex, Themes:", await rows(), await q(`${top(".search-note")}.textContent`));
await type("theme"); console.log("theme, Themes:", await rows()); await shot("themes-segment-light"); await type("flex");
await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .scope-segment')][0].click()`); await sleep(800);
// an exact match that can't work: 5Row Pro needs iOS 15+, so at iOS 13.0 its exact name stays, in red
await q(`localStorage.setItem("cydian.iosVersion", "13.0")`); await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 1500); await waitFor(top(".section-row"), 180000); await sleep(800);
await go("#/search", 800);
await type("5row pro");
console.log("5row pro at 13.0:", await rows());
await shot("exact-incompatible-light");
await type("5row");
console.log("5row at 13.0 (not exact):", await rows());
await type("5row pro");
// the Filter sheet
await q(`${top(".scope-filter")}.click()`); await sleep(1500);
await shot("filter-sheet-light");
console.log("sheet groups:", await q(`JSON.stringify([...document.querySelectorAll('.sheet .group-header')].map(e => e.textContent))`));
await q(`[...document.querySelectorAll('.sheet .cell-inner')][0].querySelector('.switch').click()`); await sleep(1500);
await q(`document.querySelector('.sheet .bar-button.done').click()`); await sleep(800);
console.log("5row after Show Incompatible:", await rows(), await q(`localStorage.getItem("cydian.worksOnMyPhone")`));
await type("5row");
console.log("5row with Show Incompatible:", await rows());
await go("#/search/" + encodeURIComponent("package:com.pitroytech.5rowpro"), 300); await waitFor(top(".pkg-head"), 60000); await sleep(1500);
await shot("package-light");
// dark
await q(`localStorage.setItem("cydian.appearance", "dark"); localStorage.removeItem("cydian.worksOnMyPhone")`); await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 1500); await waitFor(top(".section-row"), 180000); await sleep(800);
await go("#/search", 800);
await type("5row pro"); await shot("exact-incompatible-dark");
await type("tweak"); await shot("search-dark");
await q(`${top(".scope-filter")}.click()`); await sleep(1500); await shot("filter-sheet-dark");
await q(`document.querySelector('.sheet .bar-button.done').click()`); await sleep(800);
await go("#/search/" + encodeURIComponent("package:com.pitroytech.5rowpro"), 300); await waitFor(top(".pkg-head"), 60000); await sleep(1500);
await shot("package-dark");
// marks off
await go("#/settings", 1000); await shot("settings-dark");
await q(`localStorage.setItem("cydian.compatMarks", "false")`); await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 1500); await waitFor(top(".section-row"), 180000);
await go("#/search", 800); await type("tweak");
console.log("marks shown with the setting off:", await q(`[...document.querySelectorAll('.compat-mark')].filter(e => e.offsetWidth).length`));
await q(`["iosVersion","worksOnMyPhone","compatMarks","appearance"].forEach(k => localStorage.removeItem("cydian." + k))`);
