const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
await q(`localStorage.setItem("cydian.appearance", "dark"); localStorage.setItem("cydian.iosVersion", "16.5")`); await p.send("Page.reload"); await sleep(1500);
await go("#/sources/*", 1500); await waitFor(top(".section-row"), 180000); await sleep(800);
await go("#/search", 800);
await q(`(() => { const i = ${top("input")}; i.value = "tweak"; i.dispatchEvent(new Event("input")); })()`); await sleep(2500);
await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .scope-segment')][1].click()`); await sleep(1500);
await shot("search-dark");
await q(`["iosVersion","appearance"].forEach(k => localStorage.removeItem("cydian." + k))`);
