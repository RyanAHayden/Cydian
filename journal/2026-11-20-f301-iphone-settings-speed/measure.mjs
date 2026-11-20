// F301's before/after timings for This iPhone's settings page (installation/iphone), in Node with a fake DOM and a
// fake bridge whose calls take as long as the native code makes them take (README.md here says where each number
// comes from). Usage: node measure.mjs <path to screens/installroute.js> <before|after>
// Prints one JSON line per scenario: ms until every row is answered, ms until the rows first show real values, how
// many times the page's box was rebuilt (replaceChildren on the box) and how many row elements were made.
const [modPath, which] = process.argv.slice(2);
let made = 0;
function make(tag, frag = false) {
  if (tag === "li") made++;
  const e = {
    tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, _text: "", _cls: new Set(), rebuilt: 0,
    get className() { return [...e._cls].join(" "); },
    set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: { add: (...c) => c.forEach((x) => e._cls.add(x)), contains: (c) => e._cls.has(c) },
    get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
    set textContent(v) { e._text = String(v); e.children = []; },
    get firstChild() { return e.children[0] ?? null; },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    append(...c) { for (const x of c) { if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; } x.parent = e; e.children.push(x); } },
    querySelector(sel) { const c = sel.replace(/^\./, ""); const walk = (n) => n.children.find((k) => k._cls.has(c)) ?? n.children.map(walk).find(Boolean); return walk(e) ?? null; },
    querySelectorAll(sel) { const c = sel.replace(/^\./, ""); const out = []; const walk = (n) => n.children.forEach((k) => { if (k._cls.has(c)) out.push(k); walk(k); }); walk(e); return out; },
    replaceChildren(...c) { e.rebuilt++; e.children = []; e.append(...c); },
    addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
  };
  return e;
}
globalThis.document = { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true) };
const mod = await import(modPath);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TS = { connect: "auto", signedIn: true, name: "iFizBox on iPhone", address: null, use: false };
const ST = (over) => ({ paired: "rp", pairOnPhone: true, localDevVPN: false, otherVPN: false, tunnels: [], tailscale: TS, ...over });
// idevice.status's time on the phone, per scenario (README.md: VPNCheck before/after)
const SCENARIOS = {
  "LocalDevVPN on": { st: ST({ localDevVPN: true, tunnels: ["utun4"] }), before: 15, after: 15 },
  "no VPN on": { st: ST({}), before: 3000, after: 5 },
  "another VPN on": { st: ST({ otherVPN: true, tunnels: ["utun4"] }), before: 3000, after: 750 },
};
const all = (e) => [e, ...e.children.flatMap(all)];
const pending = (box) => all(box).some((n) => n._cls.has("loading-spinner") || n._text === "Checking…");
const valued = (box) => all(box).some((n) => n._cls.has("cell-detail") && /^(Paired|Not Paired)$/.test(n._text));

for (const [name, s] of Object.entries(SCENARIOS)) {
  for (const visit of [1, 2]) { // 2: the page opened again (Back and in again), the case the cache is for
    const ms = s[which];
    const native = { call: async (m) => {
      if (m === "idevice.status") { await sleep(ms); return s.st; }
      if (m === "tailscale.status") { await sleep(5); return TS; }
      throw new Error("not here");
    } };
    if (visit === 1) mod.forgetStatus?.(); // a cold first visit (the cache is the app's, not the scenario's)
    const box = make("div");
    made = 0;
    const store = { get: () => "iphone", set: () => {} };
    const t0 = Date.now();
    let firstValue = null;
    // the group and row elements that were ever on the page: the first draw's, plus each one an answer put in
    const groups = new Set(), rows = new Set();
    const seen = () => { for (const g of box.children) groups.add(g); for (const n of all(box)) if (n.tagName === "LI") rows.add(n); };
    const watch = setInterval(() => { seen(); if (firstValue == null && valued(box)) firstValue = Date.now() - t0; }, 1);
    const draw = mod.drawInstallation(box, "iphone", { store, native });
    seen();
    const firstRows = rows.size;
    if (firstValue == null && valued(box)) firstValue = 0;
    await draw;
    while (pending(box) && Date.now() - t0 < 10000) await sleep(1);
    clearInterval(watch);
    seen();
    console.log(JSON.stringify({ which, scenario: name, visit, answeredMs: Date.now() - t0, firstValueMs: firstValue ?? Date.now() - t0,
      firstDrawRows: firstRows, rowsSwappedIn: rows.size - firstRows, groupsEver: groups.size, groupsNow: box.children.length }));
  }
}
