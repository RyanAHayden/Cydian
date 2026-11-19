// B48: a hold's menu (nav/menu.js longPress + showMenu) can't be chosen by the touch that opened it, only by a new
// tap; a hold ends when the pane scrolls or iOS cancels the touch, and it takes HOLD_MS (not 500 ms).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

function fakeTarget(extra = {}) {
  const on = {};
  return {
    on,
    addEventListener(t, f, o) { const c = o === true || o?.capture ? "c" : "b"; (on[t + c] ??= new Set()).add(f); },
    removeEventListener(t, f, o) { const c = o === true || o?.capture ? "c" : "b"; on[t + c]?.delete(f); },
    ...extra,
  };
}

function fakeEl(tag = "div") {
  const el = fakeTarget({
    tagName: tag.toUpperCase(), children: [], parent: null, style: {}, textContent: "", offsetWidth: 120, offsetHeight: 40,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); },
      toggle(c, v) { (v ?? !this.set.has(c)) ? this.set.add(c) : this.set.delete(c); } },
    setAttribute() {}, click() {}, remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); },
    append(...k) { for (const c of k) { c.parent = el; el.children.push(c); } },
    contains(x) { for (let n = x; n; n = n.parent) if (n === el) return true; return false; },
    closest(sel) { for (let n = el; n; n = n.parent) if (n.classList.contains(sel.slice(1))) return n; return null; },
    getBoundingClientRect: () => ({ left: 0, top: 300, width: 320, height: 44, bottom: 344 }),
    animate: () => ({ finished: Promise.resolve() }),
  });
  return el;
}

// Dispatch as a browser would: capture on the document, then the target and its ancestors (capture, then bubble).
function dispatch(doc, target, type, e = {}) {
  const ev = { type, target, detail: 1, pointerId: 1, isPrimary: true, clientX: 100, clientY: 320, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...e };
  const path = [];
  for (let n = target; n; n = n.parent) path.push(n);
  const run = (node, phase) => { for (const f of [...(node.on[type + phase] ?? [])]) f(ev); };
  run(doc, "c");
  for (const n of [...path].reverse()) { if (ev.stopped) return ev; run(n, "c"); }
  for (const n of path) { if (ev.stopped) return ev; run(n, "b"); }
  return ev;
}

function setup() {
  const body = fakeEl("body");
  const doc = fakeTarget({ body, createElement: (t) => fakeEl(t) });
  globalThis.document = doc;
  globalThis.innerWidth = 320;
  const list = fakeEl("ul");
  const row = fakeEl("li");
  row.classList.add("pkg-row");
  list.append(row);
  return { doc, body, list, row };
}

test("a hold then lift on its menu doesn't choose the item; a new tap does", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { showMenu, longPress, HOLD_MS } = await import("./menu.js");
  const { doc, body, list, row } = setup();
  let installs = 0;
  longPress(list, ".pkg-row", (r) => showMenu(r, [{ label: "Install", onClick: () => { installs++; } }]), { doc });
  dispatch(doc, row, "pointerdown");
  t.mock.timers.tick(HOLD_MS);
  const menu = body.children.find((c) => c.className === "menu");
  assert.ok(menu, "the hold opened the menu");
  const item = menu.children[0].children[0];
  t.mock.timers.tick(1); // the menu's outside/scroll listeners go on

  // The same finger drifts onto the item and lifts: its pointerup and click land there.
  dispatch(doc, item, "pointermove", { clientY: 280 });
  dispatch(doc, item, "pointerup", { clientY: 280 });
  const ev = dispatch(doc, item, "click");
  assert.equal(installs, 0);
  assert.ok(ev.defaultPrevented);
  // Even if the document-wide swallow were gone, the item itself wants a touch that began on the menu.
  dispatch(doc, item, "click");
  assert.equal(installs, 0);

  // A new tap on the item chooses it.
  dispatch(doc, item, "pointerdown", { pointerId: 2, clientY: 280 });
  dispatch(doc, item, "pointerup", { pointerId: 2, clientY: 280 });
  dispatch(doc, item, "click", { pointerId: 2 });
  assert.equal(installs, 1);
});

test("a hold is cancelled by a scroll of the pane, by pointercancel and by moving; it waits HOLD_MS", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { longPress, HOLD_MS } = await import("./menu.js");
  assert.ok(HOLD_MS >= 550);
  const { doc, list, row } = setup();
  let holds = 0;
  longPress(list, ".pkg-row", () => { holds++; }, { doc });

  dispatch(doc, row, "pointerdown");
  t.mock.timers.tick(200);
  dispatch(doc, doc.body, "scroll"); // the page body scrolled under the resting finger (no pointermove from iOS)
  t.mock.timers.tick(HOLD_MS);
  assert.equal(holds, 0, "scroll");
  assert.equal(doc.on.scrollc?.size ?? 0, 0, "the scroll listener goes with the hold");

  dispatch(doc, row, "pointerdown");
  dispatch(doc, row, "pointercancel");
  t.mock.timers.tick(HOLD_MS);
  assert.equal(holds, 0, "pointercancel");

  dispatch(doc, row, "pointerdown");
  dispatch(doc, row, "pointermove", { clientY: 320 - 11 });
  t.mock.timers.tick(HOLD_MS);
  assert.equal(holds, 0, "moved");

  dispatch(doc, row, "pointerdown");
  t.mock.timers.tick(500);
  assert.equal(holds, 0, "not at 500 ms");
  t.mock.timers.tick(HOLD_MS - 500);
  assert.equal(holds, 1);
});

test("the click ending a hold is eaten wherever it lands (a sheet under the finger), the next tap's isn't", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { longPress, HOLD_MS } = await import("./menu.js");
  const { doc, body, list, row } = setup();
  const sheetButton = fakeEl("button");
  body.append(sheetButton);
  let taps = 0;
  sheetButton.addEventListener("click", () => { taps++; });
  longPress(list, ".pkg-row", () => {}, { doc });
  dispatch(doc, row, "pointerdown");
  t.mock.timers.tick(HOLD_MS);
  dispatch(doc, sheetButton, "pointerup");
  dispatch(doc, sheetButton, "click");
  assert.equal(taps, 0);
  dispatch(doc, sheetButton, "pointerdown", { pointerId: 2 });
  dispatch(doc, sheetButton, "click", { pointerId: 2 });
  assert.equal(taps, 1);
});
