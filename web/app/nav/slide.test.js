import { test } from "node:test";
import assert from "node:assert/strict";
import { ease, bezier, pairUp, plan, measure, isWatched, slideChange, DURATION, EASE } from "./slide.js";

// A measure tree from a compact description: [key, top, height, text?, kids?, el?]
function tree(spec) {
  const list = [];
  const build = (items, parent) => items.map(([key, top, height, text = "", kids = [], el = {}]) => {
    const box = { el, key, top, left: 0, width: 320, height, parent, kids: [], old: null, text: () => text };
    list.push(box);
    box.kids = build(kids, box);
    return box;
  });
  const kids = build(spec, null);
  return { kids, list, width: 320 };
}

test("the curve is .preview-slot's: .3s cubic-bezier(.25,.1,.25,1)", () => {
  assert.equal(DURATION, 300);
  assert.equal(EASE, "cubic-bezier(.25,.1,.25,1)");
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(Math.abs(ease(0.5) - 0.8024) < 0.002, String(ease(0.5))); // CSS `ease` at half time
  const linear = bezier(0, 0, 1, 1);
  for (const p of [0.1, 0.37, 0.9]) assert.ok(Math.abs(linear(p) - p) < 1e-4);
  let last = 0;
  for (let p = 0; p <= 1; p += 0.05) { const v = ease(p); assert.ok(v >= last - 1e-9); last = v; }
});

test("pairUp: a redrawn row is the same row even when its text changed; a new row pairs with nothing", () => {
  const old = tree([["LI.cell", 0, 44, "Checking…"], ["LI.cell", 44, 44, "This iPhone"]]);
  const now = tree([["LI.cell", 0, 44, "In Profile"], ["LI.cell", 44, 44, "New row"], ["LI.cell", 88, 44, "This iPhone"]]);
  pairUp(old.kids, now.kids);
  assert.equal(now.kids[0].old, old.kids[0]);   // same key, same place: text changed in place
  assert.equal(now.kids[2].old, old.kids[1]);   // same text wins
  assert.equal(now.kids[1].old, null);          // the new one fades in
});

test("pairUp keeps elements already paired as anchors and never crosses them", () => {
  const a = {}, b = {};
  const old = tree([["P.x", 0, 10, "1", [], a], ["DIV.g", 10, 10, "2"], ["P.x", 20, 10, "3", [], b]]);
  const now = tree([["P.x", 0, 10, "1", [], a], ["P.x", 10, 10, "3", [], b], ["DIV.g", 20, 10, "2"]]);
  now.kids[0].old = old.kids[0];
  now.kids[1].old = old.kids[2];
  pairUp(old.kids, now.kids);
  assert.equal(now.kids[2].old, null); // the DIV after b can't pair with the one before b
});

test("plan: a box that grows slides everything under it down from where it was", () => {
  const els = [{}, {}, {}];
  const old = tree([["DIV.card", 0, 100, "a", [], els[0]], ["DIV.group", 100, 50, "b", [], els[1]], ["P.foot", 150, 20, "c", [], els[2]]]);
  const now = tree([["DIV.card", 0, 160, "a", [], els[0]], ["DIV.group", 160, 50, "b", [], els[1]], ["P.foot", 210, 20, "c", [], els[2]]]);
  const { moves, enters, leaves } = plan(old, now);
  assert.deepEqual(moves.map((m) => m.from), [0, -60, -60]);
  assert.equal(enters.length, 0);
  assert.equal(leaves.length, 0);
});

test("plan: nested boxes move by the difference from their moving parent", () => {
  const g = {}, r1 = {}, r2 = {}, top = {};
  const old = tree([["DIV.group", 50, 88, "", [["LI.cell", 50, 44, "1", [], r1], ["LI.cell", 94, 44, "2", [], r2]], g]]);
  const now = tree([["P.note", 0, 30, "new", [], top],
    ["DIV.group", 80, 132, "", [["LI.cell", 80, 44, "1", [], r1], ["LI.cell", 124, 44, "x"], ["LI.cell", 168, 44, "2", [], r2]], g]]);
  const { moves, enters } = plan(old, now);
  const from = new Map(moves.map((m) => [m.box.el, m.from]));
  assert.equal(from.get(g), -30);  // the group starts 30 higher
  assert.equal(from.get(r1), 0);   // its first row rides along
  assert.equal(from.get(r2), -44); // the second starts on top of the new row, relative to the group
  assert.deepEqual(enters.map((b) => b.text()).sort(), ["new", "x"]);
});

test("plan: a box that went is faded where it showed, its running slide included", () => {
  const gone = {}, stay = {};
  const old = tree([["DIV.banner", 0, 40, "Failed", [], gone], ["DIV.list", 40, 400, "", [], stay]]);
  const now = tree([["DIV.list", 0, 400, "", [], stay]]);
  const own = (el) => (el === gone ? 10 : 0);
  const { moves, leaves } = plan(old, now, own);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].box.el, gone);
  assert.equal(leaves[0].top, 10);
  assert.equal(moves[0].from, 40);
});

test("plan: a page redrawn whole (replaceChildren) is matched by structure, not identity", () => {
  const old = tree([["DIV.walkthrough", 0, 300, "", [["P.group-footer", 0, 20, "Two steps"], ["OL.walk-steps", 20, 280, "",
    [["LI.walk-step", 20, 44, "Certificate"], ["LI.walk-step", 64, 236, "Server"]]]]]]);
  const now = tree([["DIV.walkthrough", 0, 340, "", [["P.group-footer", 0, 20, "Two steps"], ["P.group-footer", 20, 40, "The signer didn't answer"],
    ["OL.walk-steps", 60, 280, "", [["LI.walk-step", 60, 44, "Certificate"], ["LI.walk-step", 104, 236, "Server"]]]]]]);
  const { moves, enters, leaves } = plan(old, now);
  assert.equal(leaves.length, 0);
  assert.deepEqual(enters.map((b) => b.text()), ["The signer didn't answer"]);
  const ol = moves.find((m) => m.box.key === "OL.walk-steps");
  assert.equal(ol.from, -40);
  assert.ok(moves.filter((m) => m.box.key === "LI.walk-step").every((m) => m.from === 0)); // they ride with the list
});

// A tiny laid-out DOM for measure(): offsetTop chains, computed display/position.
function fakeEl(tag, cls, { top = 0, height = 10, display = "block", position = "static", kids = [] } = {}) {
  const el = {
    tagName: tag, offsetTop: top, offsetLeft: 0, offsetWidth: 320, offsetHeight: height, offsetParent: null, children: kids,
    textContent: cls, _display: display, _position: position,
    getAttribute: (k) => (k === "class" ? cls : null), matches: (sel) => sel.split(",").some((s) => s.trim() === `.${cls}`),
  };
  return el;
}

test("measure: block boxes only, nested, skipping virtual lists, inline and absolutely placed things", () => {
  const row = fakeEl("LI", "cell", { top: 0, height: 44, display: "list-item" });
  const ul = fakeEl("UL", "table", { top: 30, height: 44, kids: [row] });
  const span = fakeEl("SPAN", "badge", { display: "inline" });
  const abs = fakeEl("DIV", "pin", { position: "absolute" });
  const vl = fakeEl("DIV", "vlist", { top: 80 });
  const root = { children: [ul, span, abs, vl], clientWidth: 320, clientLeft: 0, clientTop: 0, offsetTop: 0, offsetLeft: 0, offsetParent: null };
  for (const k of [ul, span, abs, vl]) k.offsetParent = root;
  row.offsetParent = root;
  row.offsetTop = 30;
  const cs = (el) => ({ display: el._display, position: el._position });
  const m = measure(root, cs);
  assert.deepEqual(m.list.map((b) => b.key), ["UL.table", "LI.cell"]);
  assert.equal(m.list[1].top, 30);
  assert.equal(m.list[1].parent, m.list[0]);
});

test("without the watcher installed (node, a test DOM) nothing is watched and slideChange just runs the change", () => {
  assert.equal(isWatched({ nodeType: 1, closest: () => null }), false);
  let ran = false;
  slideChange({}, () => { ran = true; });
  assert.ok(ran);
});

// B213: a viewport resize (iPad rotation, Split View, a desktop window) reports boxes to the ResizeObserver, and the
// watcher measures again in that report. A box it finds then is observed on the next frame, never inside the report:
// observed there, its first report lands shallower in the same broadcast and Chromium raises "ResizeObserver loop
// completed with undelivered notifications". Runs last: it installs the watcher for the rest of this file.
test("a resize report observes the boxes it finds on the next frame, not in the report", async () => {
  const { installSlides } = await import("./slide.js");
  const observed = [];
  let roCallback = null, moCallback = null;
  const frames = [];
  const el = (cls, top, height, parent) => {
    const e = {
      tagName: "DIV", offsetTop: top, offsetLeft: 0, offsetWidth: 320, offsetHeight: height, offsetParent: parent,
      children: [], textContent: cls, isConnected: true, nodeType: 1, clientWidth: 320,
      getAttribute: (k) => (k === "class" ? cls : null),
      matches: (sel) => sel.split(",").some((s) => s.trim() === `.${cls}`),
      closest: (sel) => (sel.split(",").some((s) => s.trim() === `.${cls}`) ? e : parent?.closest?.(sel) ?? null),
      hasAttribute: () => false, getAnimations: () => [], animate: () => ({}),
    };
    return e;
  };
  const root = el("page-body", 0, 600, null);
  const a = el("home", 0, 100, root), b = el("cell", 100, 44, root);
  root.children = [a, b];
  Object.assign(globalThis, {
    document: { body: {} },
    Element: class { animate() {} },
    MutationObserver: class { constructor(f) { moCallback = f; } observe() {} },
    ResizeObserver: class { constructor(f) { roCallback = f; } observe(x) { observed.push(x); } unobserve() {} },
    requestAnimationFrame: (f) => frames.push(f),
    getComputedStyle: () => ({ display: "block", position: "static", transform: "none" }),
  });
  try {
    assert.equal(installSlides(), true);
    moCallback([{ type: "attributes", target: root, addedNodes: [], removedNodes: [] }]); // a `hidden` flip
    assert.deepEqual(observed, [a, b]); // outside a report: observed at once
    roCallback([{ target: a }, { target: b }]); // their first reports: skipped

    // The window narrows: the top box grows and a new box shows below.
    root.clientWidth = 280;
    a.offsetHeight = 140; b.offsetTop = 140;
    const c = el("home-version", 184, 20, root);
    root.children = [a, b, c];
    roCallback([{ target: a, borderBoxSize: [{ blockSize: 140 }] }]);
    assert.deepEqual(observed, [a, b], "nothing observed inside the report");
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(observed, [a, b, c], "observed on the next frame");

    // Its first report: skipped when it kept its size, a change when it grew in the frame it waited.
    let measured = 0;
    const kids = root.children;
    Object.defineProperty(root, "children", { get: () => { measured++; return kids; } });
    roCallback([{ target: c, borderBoxSize: [{ blockSize: 20 }] }]);
    assert.equal(measured, 0);
    roCallback([{ target: c, borderBoxSize: [{ blockSize: 40 }] }]);
    assert.equal(measured, 1);
  } finally {
    for (const k of ["document", "Element", "MutationObserver", "ResizeObserver", "requestAnimationFrame", "getComputedStyle"]) delete globalThis[k];
  }
});

test("B195 fadesOf: a skeleton leaves without a fading copy; a page in its push fades nothing", async () => {
  const { fadesOf } = await import("./slide.js");
  const box = (cls) => ({ el: { matches: (sel) => sel.split(/,\s*/).some((s) => s === `.${cls}`) } });
  const enters = [box("alt-app")];
  const leaves = [{ box: box("ph"), top: 0 }, { box: box("cell"), top: 40 }];
  const swap = fadesOf({ enters, leaves });
  assert.deepEqual(swap.enters, [], "content replacing a skeleton comes in at once (no blank blink)");
  assert.deepEqual(swap.leaves.map((l) => l.top), [40], "a row that went fades out, the skeleton doesn't");
  const plain = fadesOf({ enters, leaves: leaves.slice(1) });
  assert.deepEqual(plain.enters, enters, "with no skeleton, new content fades in at rest");
  assert.equal(plain.leaves.length, 1);
  assert.deepEqual(fadesOf({ enters, leaves }, true), { enters: [], leaves: [] }, "mid-push: content swaps at once");
});
