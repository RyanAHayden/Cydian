// F208: My IPAs' list manages its rows: a left swipe shows the red Delete, Edit brings the red minus and ticks rows
// for Delete (n), a hold opens the row's sheet, and Delete asks first ('Delete n IPAs' / Cancel), then deletes the
// records and stored files and draws the footer's new total.
import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryGroup, deleteMany } from "./myipas.js";
import { listState, memoryIpaStore, siteEntries, libraryFooter } from "../core/myipas.js";

// A fake DOM good enough for nav/ui.js grouped() and the rows' decoration: class selectors only (installed.test.js's).
function fakeDom() {
  const matches = (n, sel) => sel.split(".").filter(Boolean).every((c) => n._cls?.has(c));
  const walk = (n, out = []) => { for (const c of n.children) { out.push(c); walk(c, out); } return out; };
  const make = (tag, frag = false) => {
    const e = {
      tagName: String(tag).toUpperCase(), isFragment: frag, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
      parentNode: null, _text: "", _cls: new Set(),
      get className() { return [...e._cls].join(" "); },
      set className(v) { e._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      classList: {
        add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
        contains: (c) => e._cls.has(c), toggle: (c, on = !e._cls.has(c)) => { if (on) e._cls.add(c); else e._cls.delete(c); return on; },
      },
      get textContent() { return e._text + e.children.map((c) => c.textContent).join(""); },
      set textContent(v) { e._text = String(v); e.children = []; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: (k) => e.attrs[k] ?? null,
      append(...c) {
        for (const x of c) {
          if (typeof x === "string") { e._text += x; continue; }
          if (x.isFragment) { x.children.splice(0).forEach((k) => e.append(k)); continue; }
          x.parentNode = e;
          e.children.push(x);
        }
      },
      remove() { if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); },
      contains: (x) => { for (let n = x; n; n = n.parentNode) if (n === e) return true; return false; },
      closest(sel) { for (const s of sel.split(",").map((x) => x.trim())) for (let n = e; n; n = n.parentNode) if (matches(n, s)) return n; return null; },
      querySelectorAll(sel) {
        if (sel.startsWith(":scope > ")) return e.children.filter((c) => matches(c, sel.slice(9)));
        return walk(e).filter((c) => matches(c, sel));
      },
      querySelector: (sel) => e.querySelectorAll(sel)[0] ?? null,
      addEventListener(t, f) { (e.listeners[t] ??= []).push(f); },
      fire(t, ev) { for (const f of e.listeners[t] ?? []) f(ev); },
      click() { e.fire("click", { target: e, preventDefault() {}, stopPropagation() {} }); },
    };
    return e;
  };
  return { createElement: (t) => make(t), createDocumentFragment: () => make("#fragment", true), body: make("body") };
}

function withDom(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = fakeDom();
  const done = () => { if (had) Object.defineProperty(globalThis, "document", had); else delete globalThis.document; };
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  return Promise.resolve(out).finally(done);
}

const MB = 1048576;
const LIST = [
  { file: "Delta.ipa", name: "Delta", version: "1.5", size: 10 * MB, signed: null },
  { file: "Alpha.ipa", name: "Alpha", version: "2.0", size: 20 * MB, signed: { at: "2026-11-18T00:00:00Z" } },
  { file: "Broken.ipa", name: "Broken", size: 1 * MB, error: "not a zip" },
];

// A tap as the list sees it: the capture listener first (the list's), then whether the link would open.
function tap(ul, target) {
  let stopped = false;
  ul.fire("click", { target, preventDefault() { stopped = true; }, stopPropagation() {} });
  return !stopped; // true: the row's link opens
}
const swipe = (ul, li, dx) => {
  const target = li.querySelector(".cell-label");
  ul.fire("pointerdown", { target, clientX: 200, clientY: 10 });
  ul.fire("pointermove", { target, clientX: 200 + dx, clientY: 12 });
};

test("F208: rows A to Z wear the delete controls; the footer says how many and their total size", () => withDom(() => {
  const g = libraryGroup(LIST, { site: false });
  const cells = g.ul.querySelectorAll(":scope > .cell");
  assert.deepEqual(cells.map((li) => li.dataset.file), ["Alpha.ipa", "Broken.ipa", "Delta.ipa"]);
  for (const li of cells) {
    assert.ok(li.classList.contains("source-row") && li.classList.contains("myipa-row"));
    assert.ok(li.querySelector(".del-toggle"), "the red minus");
    assert.equal(li.querySelector(".del-confirm").textContent, "Delete");
  }
  const holder = document.createElement("div");
  holder.append(g.el);
  assert.equal(holder.querySelector(".group-footer").textContent, "3 IPAs · 31.0 MB");
  // empty: the hint instead
  const empty = libraryGroup([], { site: true });
  const h2 = document.createElement("div");
  h2.append(empty.el);
  assert.match(h2.querySelector(".group-footer").textContent, /^No IPAs yet/);
}));

test("F208: a left swipe shows Delete on one row; a tap or right swipe puts it away without opening the row", () => withDom(() => {
  const changes = [];
  const g = libraryGroup(LIST, { site: false, on: { change: (s) => changes.push(s) } });
  const [a, b] = g.ul.querySelectorAll(":scope > .cell");
  assert.ok(tap(g.ul, a.querySelector(".cell-label")), "a plain tap opens the IPA's page");
  swipe(g.ul, a, -60);
  assert.ok(a.classList.contains("armed"));
  assert.ok(!tap(g.ul, a.querySelector(".cell-label")), "the lift that ends the swipe isn't a tap");
  swipe(g.ul, b, -60);
  assert.ok(b.classList.contains("armed") && !a.classList.contains("armed"), "one Delete at a time");
  swipe(g.ul, b, 60);
  assert.ok(!b.classList.contains("armed"));
  swipe(g.ul, a, -60);
  tap(g.ul, a.querySelector(".cell-label")); // eaten: ended the swipe
  assert.ok(!tap(g.ul, b.querySelector(".cell-label")), "with a Delete showing, a tap only puts it away");
  assert.ok(!a.classList.contains("armed"));
  assert.ok(changes.length >= 4);
}));

test("F208: Edit: the minus turns into Delete, taps tick rows, nothing opens; Delete hands the row over", () => withDom(() => {
  const asked = [];
  const g = libraryGroup(LIST, { site: false, on: { delete: (es) => asked.push(es.map((e) => e.file)) } });
  const [a, b, c] = g.ul.querySelectorAll(":scope > .cell");
  g.step({ type: "edit" });
  assert.ok(g.ul.classList.contains("editing"));
  swipe(g.ul, a, -60);
  assert.ok(!a.classList.contains("armed"), "no swipe in edit mode");
  a.querySelector(".del-toggle").click();
  assert.ok(a.classList.contains("armed"), "the minus shows Delete");
  a.querySelector(".del-confirm").click();
  assert.deepEqual(asked, [["Alpha.ipa"]]);
  assert.ok(!tap(g.ul, c.querySelector(".cell-label")));
  assert.ok(!a.classList.contains("armed") && !c.classList.contains("picked"), "the first tap only put Delete away");
  assert.ok(!tap(g.ul, c.querySelector(".cell-label")));
  assert.ok(!tap(g.ul, b.querySelector(".cell-label")));
  assert.ok(c.classList.contains("picked") && b.classList.contains("picked"));
  assert.deepEqual(g.state.selected, ["Delta.ipa", "Broken.ipa"]);
  g.step({ type: "selectAll", files: g.rows.map((r) => r.file) });
  assert.ok([a, b, c].every((li) => li.classList.contains("picked")));
  g.step({ type: "done" });
  assert.ok(!g.ul.classList.contains("editing"));
  assert.ok([a, b, c].every((li) => !li.classList.contains("picked")));
  assert.ok(tap(g.ul, a.querySelector(".cell-label")), "out of edit mode a tap opens again");
}));

test("F208: a hold opens the row's sheet, not while editing or while a Delete shows", (t) => withDom(() => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const held = [];
  const g = libraryGroup(LIST, { site: false, on: { hold: (e) => held.push(e.file) } });
  const [a] = g.ul.querySelectorAll(":scope > .cell");
  const hold = () => {
    const target = a.querySelector(".cell-label");
    g.ul.fire("pointerdown", { target, clientX: 100, clientY: 10 });
    t.mock.timers.tick(600);
    g.ul.fire("pointerup", { target });
  };
  hold();
  assert.deepEqual(held, ["Alpha.ipa"]);
  g.step({ type: "edit" });
  hold();
  g.step({ type: "done" });
  g.step({ type: "swipe", file: "Alpha.ipa", dir: "left" });
  hold();
  assert.deepEqual(held, ["Alpha.ipa"]);
}));

test("F208: Delete asks 'Delete n IPAs' first; Cancel keeps everything, confirming frees records and files", async () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
  const kept = [{ file: "A.ipa", stored: true, name: "A", size: 10 * MB }, { file: "B.ipa", stored: true, name: "B", size: 20 * MB },
    { file: "C.ipa", stored: true, name: "C", size: 30 * MB }];
  storage.setItem("ifizbox.myIpas", JSON.stringify(kept));
  const store = memoryIpaStore();
  for (const e of kept) await store.put(e.file, new Blob([e.file]));
  const sheets = [];
  const cancel = await deleteMany(kept.slice(0, 2), { isSite: true, storage, store, sheet: async (s) => { sheets.push(s); return -1; } });
  assert.equal(cancel, null);
  assert.deepEqual(sheets[0], { title: "2 IPAs are deleted from this browser.", buttons: ["Delete 2 IPAs"], destructive: 0 });
  assert.equal(siteEntries(storage).length, 3);
  const r = await deleteMany(kept.slice(0, 2), { isSite: true, storage, store, sheet: async () => 0 });
  assert.deepEqual(r.deleted, ["A.ipa", "B.ipa"]);
  assert.deepEqual(siteEntries(storage).map((e) => e.file), ["C.ipa"]);
  assert.deepEqual([...store.files.keys()], ["C.ipa"]);
  assert.equal(libraryFooter(r.ipas), "1 IPA · 30.0 MB");
});

test("F208: in the app a failed delete says which and why; the others still go", async () => {
  const alerts = [];
  const call = async (_m, { file }) => { if (file === "B.ipa") throw new Error("The file is in use."); return { ipas: [{ file: "B.ipa" }] }; };
  const r = await deleteMany([{ file: "A.ipa", title: "A" }, { file: "B.ipa", title: "Bee" }], { isSite: false, call,
    sheet: async (s) => { assert.equal(s.buttons[0], "Delete 2 IPAs"); assert.match(s.title, /signed copies/); return 0; },
    alert: async (a) => { alerts.push(a); return { index: 0 }; } });
  assert.deepEqual(r.deleted, ["A.ipa"]);
  assert.equal(alerts[0].title, "Couldn't Delete");
  assert.match(alerts[0].message, /^Bee: /);
});

test("F208: listState starts out of edit mode", () => {
  assert.deepEqual(listState(), { editing: false, armed: null, selected: [] });
});
