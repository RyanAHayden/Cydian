const top = (sel) => `document.querySelector('.tab-stack.is-active .page.is-top ${sel}')`;
await q(`localStorage.setItem("cydian.arch", "iphoneos-arm64")`);
await p.send("Page.reload"); await sleep(1500);
await go("#/changes", 500);
await waitFor(`${top(".empty")} && !${top(".empty")}.textContent.startsWith("Loading")`, 90000);
console.log("first load:", await q(`${top(".page-body")}.textContent`));
console.log("sources:", await q(`(async () => (await (await import("/backend.js")).getBackend().sources()).length)()`));
await shot("changes-empty");
// Simulate history: everything first seen two days ago; a handful one day ago; one package's current
// version unseen (an older version seen two days ago), so the next load files it as Updated now.
const info = await q(`new Promise((res) => { const r = indexedDB.open("cydian-changes", 1); r.onsuccess = () => {
  const db = r.result; const tx = db.transaction("seen", "readwrite"); const s = tx.objectStore("seen");
  const g = s.getAll(); g.onsuccess = () => {
    const now = Date.now(), recs = g.result; let i = 0; const bumped = recs[5], fresh = recs[recs.length - 3];
    for (const x of recs) { x.first = now - 2 * 86400000 + (i++ % 9 === 0 && x !== bumped ? 86400000 : 0); s.put(x); }
    s.delete(bumped.k); s.put({ ...bumped, k: bumped.k + "old", version: "0.0.1~old", first: now - 2 * 86400000 });
    s.delete(fresh.k);
    tx.oncomplete = () => res(JSON.stringify({ total: recs.length, bumped: bumped.id, fresh: fresh.id }));
  }; }; })`);
console.log("simulated:", info);
await p.send("Page.reload"); await sleep(1500);
await go("#/changes", 500);
await waitFor(top(".pkg-row"), 90000); await sleep(1500);
console.log("headers:", await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .vlist-header')].map(e => e.textContent).join(" | ")`));
console.log("first rows:", await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .pkg-row')].slice(0,4).map(e => e.dataset.change + ":" + e.querySelector(".pkg-name").textContent + " " + e.querySelector(".pkg-version").textContent).join(" | ")`));
await shot("changes-groups");
const n = await q(`new Promise((res) => { const r = indexedDB.open("cydian-changes", 1); r.onsuccess = () => { const c = r.result.transaction("seen").objectStore("seen").count(); c.onsuccess = () => res(c.result); }; })`);
console.log("records after:", n);
await p.send("Page.reload"); await sleep(1500); await go("#/changes", 500); await waitFor(top(".pkg-row"), 90000); await sleep(1000);
const n2 = await q(`new Promise((res) => { const r = indexedDB.open("cydian-changes", 1); r.onsuccess = () => { const c = r.result.transaction("seen").objectStore("seen").count(); c.onsuccess = () => res(c.result); }; })`);
console.log("records after a repeat load:", n2);
console.log("headers again:", await q(`[...document.querySelectorAll('.tab-stack.is-active .page.is-top .vlist-header')].map(e => e.textContent).join(" | ")`));
await q(`document.querySelector('.tab-stack.is-active .page.is-top .pkg-row a').click()`); await sleep(2500);
console.log("tapped to:", await q(`location.hash`));
await shot("changes-package");
