import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuickTap, coasting, tapTarget, heldTap, initMomentumTap, TAP_MS, SLOP, MOMENTUM, DOUBLE } from "./momentum-tap.js";

test("tap vs drag: short and still is a tap; long or moved is not", () => {
  assert.equal(isQuickTap(80, 0, 0), true);
  assert.equal(isQuickTap(TAP_MS, 6, 8), true); // 10 px exactly, at the time limit
  assert.equal(isQuickTap(TAP_MS + 1, 0, 0), false); // a hold
  assert.equal(isQuickTap(80, 0, SLOP + 1), false); // a drag
  assert.equal(isQuickTap(80, 8, 8), false); // 11.3 px diagonal
});

test("coasting: a finger-free scroll within MOMENTUM ms before the touch", () => {
  assert.equal(coasting(1000, 1000 - MOMENTUM), true);
  assert.equal(coasting(1000, 1000 - MOMENTUM - 1), false);
  assert.equal(coasting(1000, -Infinity), false);
});

// A fake element tree: closest() over a list of selectors this element matches, walking up to its parent.
const el = (matches, parent = null, extra = {}) => ({
  parent, matches, clicks: [], disabled: false, ...extra,
  closest(sel) {
    for (let e = this; e; e = e.parent) if (sel.split(",").some((s) => e.matches.includes(s.trim()))) return e;
    return null;
  },
  contains(other) { for (let e = other; e; e = e.parent) if (e === this) return true; return false; },
  dispatchEvent(ev) { this.clicks.push(ev); return true; },
});

test("tapTarget: rows, links and buttons; never text fields or disabled buttons", () => {
  const row = el(["a[href]", ".cell-inner"]);
  const label = el([], row);
  assert.equal(tapTarget(label), row);
  assert.equal(tapTarget(el(["input"], row)), null);
  assert.equal(tapTarget(el(["button"], null, { disabled: true })), null);
  assert.equal(tapTarget(el(["div"])), null);
  assert.equal(tapTarget(null), null);
});

function harness() {
  const handlers = {};
  let t = 0;
  let under = null;
  const doc = {
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    elementFromPoint: () => under,
  };
  const timers = [];
  const win = {
    performance: { now: () => t },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    setTimeout: (fn) => timers.push(fn),
  };
  initMomentumTap(doc, win);
  const fire = (type, ev) => { for (const fn of [...(handlers[type] || [])]) fn(ev); return ev; };
  const touch = (x, y) => ({ identifier: 1, clientX: x, clientY: y, screenX: x, screenY: y });
  return {
    at: (ms) => { t = ms; },
    under: (e) => { under = e; },
    timers,
    scroll: () => fire("scroll", {}),
    down: (x, y) => fire("touchstart", { touches: [touch(x, y)], changedTouches: [touch(x, y)] }),
    move: (x, y) => fire("touchmove", { touches: [touch(x, y)], changedTouches: [touch(x, y)] }),
    up: (x, y, cancelable = true) => {
      const ev = { touches: [], changedTouches: [touch(x, y)], cancelable, prevented: false, preventDefault() { this.prevented = true; } };
      return fire("touchend", ev);
    },
    // WebKit's own click on `target`: returns whether a listener dropped it
    native: (target) => fire("click", { isTrusted: true, target, dropped: false, preventDefault() { this.dropped = true; }, stopImmediatePropagation() {} }).dropped,
  };
}

test("a quick tap during momentum clicks the row under the finger, and cancels the native click", () => {
  const h = harness();
  const row = el(["a[href]"]);
  h.under(row);
  h.at(1000); h.scroll(); // the list coasting, no finger down
  h.at(1050); h.down(100, 200);
  assert.equal(heldTap(), true); // the pressed look stays through the last scroll events
  h.at(1130);
  const end = h.up(102, 203);
  assert.equal(end.prevented, true);
  assert.equal(row.clicks.length, 1);
  assert.equal(row.clicks[0].clientX, 102);
  assert.equal(heldTap(), false);
});

test("no momentum: the browser's own click is left alone", () => {
  const h = harness();
  const row = el(["a[href]"]);
  h.under(row);
  h.at(1000); h.scroll();
  h.at(2000); h.down(100, 200);
  h.at(2080);
  assert.equal(h.up(100, 200).prevented, false);
  assert.equal(row.clicks.length, 0);
});

test("a drag during momentum only scrolls", () => {
  const h = harness();
  const row = el(["a[href]"]);
  h.under(row);
  h.at(1000); h.scroll();
  h.at(1050); h.down(100, 200);
  h.move(100, 230);
  assert.equal(heldTap(), false);
  h.at(1120);
  assert.equal(h.up(100, 200).prevented, false); // came back to the start, but it was a drag
  assert.equal(row.clicks.length, 0);
});

test("a hold during momentum only stops the scroll", () => {
  const h = harness();
  const row = el(["a[href]"]);
  h.under(row);
  h.at(1000); h.scroll();
  h.at(1050); h.down(100, 200);
  h.at(1050 + TAP_MS + 50);
  h.up(100, 200);
  assert.equal(row.clicks.length, 0);
});

test("scroll events while a finger drags are not momentum", () => {
  const h = harness();
  const row = el(["a[href]"]);
  h.under(row);
  h.at(1000); h.down(100, 400); h.move(100, 200); h.scroll(); // dragging the list
  h.at(1010); h.up(100, 200); // lifted with no fling
  h.at(1060); h.down(100, 200);
  h.at(1100); h.up(100, 200);
  assert.equal(row.clicks.length, 0);
});

test("an uncancelable touchend: our click, and WebKit's own after it is dropped", () => {
  const h = harness();
  const row = el(["a[href]"]);
  const label = el([], row);
  h.under(row);
  h.at(1000); h.scroll();
  h.at(1050); h.down(100, 200);
  h.at(1100); assert.equal(h.up(100, 200, false).prevented, false);
  assert.equal(row.clicks.length, 1);
  h.at(1120); assert.equal(h.native(label), true); // the same tap: dropped
  h.at(1100 + DOUBLE + 10); assert.equal(h.native(label), false); // a later tap is its own
});

test("the app's native call clicks the row under the point, once", () => {
  const h = harness();
  const row = el(["button", ".cell-inner"]);
  h.under(row);
  h.at(5000);
  assert.equal(globalThis.cydianMomentumTap(40, 300), true);
  assert.equal(row.clicks.length, 1);
  assert.equal(row.clicks[0].clientY, 300);
  // A native click that did come just before: ours is skipped.
  h.at(9000); h.native(row);
  h.at(9050); assert.equal(globalThis.cydianMomentumTap(40, 300), false);
  assert.equal(row.clicks.length, 1);
  // Nothing tappable there (a text field, a header): no click.
  h.under(el(["input"], row));
  h.at(12000); assert.equal(globalThis.cydianMomentumTap(40, 300), false);
});
