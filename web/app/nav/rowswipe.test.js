// F193: swiping a package row left to queue it: when a move is a swipe, how far the row goes, when it is armed, and
// that only an armed lift runs the action (a right swipe, a scroll, a cancel or a recycled row never do).
import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeDecide, swipeOffset, swipeArmed, attachRowSwipe, EDGE, SLOP, ARM } from "./rowswipe.js";
import { fakeDocument } from "./fakedom.test-helper.js";

test("a move is a swipe only when clearly leftward; vertical is the list's, rightward the back swipe's", () => {
  assert.equal(swipeDecide(-5, 2), "wait");               // inside the slop
  assert.equal(swipeDecide(-SLOP - 1, 0), "swipe");
  assert.equal(swipeDecide(-30, 15), "swipe");
  assert.equal(swipeDecide(-30, 25), "wait");              // diagonal: not yet
  assert.equal(swipeDecide(-12, 14), "scroll");
  assert.equal(swipeDecide(3, -40), "scroll");
  assert.equal(swipeDecide(SLOP + 1, 0), "none");          // a right swipe does nothing
  assert.equal(swipeDecide(40, 20), "none");
});

test("the row follows the finger to ARM, then rubber-bands and never passes ARM + half the width", () => {
  const w = 375;
  assert.equal(swipeOffset(0, w), -0);
  assert.equal(swipeOffset(30, w), -0);                    // never right of rest
  assert.equal(swipeOffset(-50, w), -50);
  assert.equal(swipeOffset(-w * ARM, w), -w * ARM);
  const a = swipeOffset(-w * ARM - 50, w), b = swipeOffset(-w * ARM - 100, w);
  assert.ok(a < -w * ARM && a > -w * ARM - 50, "slower than the finger past ARM");
  assert.ok(b < a && (b - a) > -50, "still moves, less each step");
  assert.ok(swipeOffset(-10000, w) > -w * (ARM + 0.5));
  assert.equal(swipeArmed(-w * ARM + 1, w), false);
  assert.equal(swipeArmed(-w * ARM, w), true);
  assert.equal(swipeArmed(-200, 0), false);
});

// A list element and rows good enough for the gesture (no browser in node).
// The shared fake DOM's element, as wide as a phone; fire(t, e) runs the listeners with `e` as it is.
function fakeEl(cls = "") {
  const el = document.createElement("div");
  el.className = cls;
  el.clientWidth = 375;
  el.fire = (t, e) => { for (const f of el.listeners[t] ?? []) f(e); };
  return el;
}

function setup(action = { kind: "add" }) {
  globalThis.document = fakeDocument(); // haptic() draws a hidden switch
  globalThis.requestAnimationFrame = (f) => { queueMicrotask(f); return 1; }; // a frame later, as a browser
  globalThis.cancelAnimationFrame = () => {};
  const list = fakeEl("vlist");
  const row = fakeEl("pkg-row");
  const inner = fakeEl("cell-inner");
  row.append(inner);
  list.append(row);
  row._item = { id: "a" };
  const commits = [];
  const s = attachRowSwipe(list, { prepare: async () => action, commit: (r, a) => commits.push(a), kindOf: (a) => a.kind });
  const ev = (x, y = 300, extra = {}) => ({ pointerId: 1, clientX: x, clientY: y, isPrimary: true, button: 0, target: inner, ...extra });
  return { list, row, inner, commits, s, ev };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("let go past ARM: the action runs once and the row springs back; before ARM nothing runs", async () => {
  const t = setup();
  t.list.fire("pointerdown", t.ev(300));
  await tick();
  t.list.fire("pointermove", t.ev(285));                   // decided: a swipe, starts here
  t.list.fire("pointermove", t.ev(285 - 200));
  await tick();
  assert.ok(t.row.classList.contains("swiping"));
  assert.match(t.inner.style.transform, /translate3d\(-1/);
  assert.ok(t.row._swipeBack.classList.contains("armed"));
  assert.equal(t.row._swipeBack.dataset.kind, "add");
  t.list.fire("pointerup", t.ev(285 - 200));
  await tick();
  assert.equal(t.commits.length, 1);
  assert.equal(t.inner.style.transform, "translate3d(0,0,0)"); // springing back
  // The click the lift makes doesn't open the row.
  let opened = true;
  t.list.fire("click", { preventDefault() { opened = false; }, stopPropagation() {} });
  assert.equal(opened, false);

  const u = setup();
  u.list.fire("pointerdown", u.ev(300));
  await tick();
  u.list.fire("pointermove", u.ev(285));
  u.list.fire("pointermove", u.ev(285 - 60));
  await tick();
  assert.equal(u.row._swipeBack.classList.contains("armed"), false);
  u.list.fire("pointerup", u.ev(285 - 60));
  await tick();
  assert.equal(u.commits.length, 0);
});

test("a right swipe, a scroll, a touch at the left edge, a cancel or a recycled row run nothing", async () => {
  for (const moves of [[340, 400], [300, 300, 340], [300, 280]]) {
    const t = setup();
    t.list.fire("pointerdown", t.ev(300));
    await tick();
    for (const x of moves) t.list.fire("pointermove", t.ev(x, moves[1] === 280 ? 280 : 300));
    t.list.fire("pointerup", t.ev(moves.at(-1)));
    await tick();
    assert.equal(t.commits.length, 0);
    assert.equal(t.row.classList.contains("swiping"), false);
  }
  const edge = setup();
  edge.list.fire("pointerdown", edge.ev(EDGE - 1));
  edge.list.fire("pointermove", edge.ev(EDGE - 1 - 200));
  edge.list.fire("pointerup", edge.ev(EDGE - 1 - 200));
  await tick();
  assert.equal(edge.commits.length, 0);

  const c = setup();
  c.list.fire("pointerdown", c.ev(300));
  await tick();
  c.list.fire("pointermove", c.ev(285));
  c.list.fire("pointermove", c.ev(50));
  c.list.fire("pointercancel", c.ev(50));
  await tick();
  assert.equal(c.commits.length, 0);

  const r = setup();
  r.list.fire("pointerdown", r.ev(300));
  await tick();
  r.list.fire("pointermove", r.ev(285));
  r.list.fire("pointermove", r.ev(50));
  r.s.reset(r.row);                                        // vlist rebinds it to another package
  assert.equal(r.row.classList.contains("swiping"), false);
  assert.equal(r.inner.style.transform, "");
  r.list.fire("pointerup", r.ev(50));
  await tick();
  assert.equal(r.commits.length, 0);
});

test("a row with nothing to do doesn't move", async () => {
  const t = setup(null);
  t.list.fire("pointerdown", t.ev(300));
  await tick();
  t.list.fire("pointermove", t.ev(285));
  t.list.fire("pointermove", t.ev(50));
  assert.equal(t.row.classList.contains("swiping"), false);
  t.list.fire("pointerup", t.ev(50));
  await tick();
  assert.equal(t.commits.length, 0);
});
