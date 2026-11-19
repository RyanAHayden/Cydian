// B57: a tap on the current tab (or the status bar) slides the list to the top in ~300 ms, ease-out, frame by frame,
// instead of one jump; an instant jump only with reduced motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollToTop, TOP_MS, easeOut, isSliding, tapTab } from "./tabbar.js";

// A scroller that records every scrollTop write, and a window whose frames we step by hand.
function rig(top, { reduce = false } = {}) {
  const writes = [], overflow = [], listeners = {};
  let st = top;
  const body = {
    get scrollTop() { return st; },
    set scrollTop(v) { st = v; writes.push(v); },
    style: { set overflowY(v) { overflow.push(v); }, get overflowY() { return overflow.at(-1) ?? ""; } },
    get offsetHeight() { return 100; },
    scrollTo() { throw new Error("native scrollTo used"); },
    addEventListener(t, f) { listeners[t] = f; },
    removeEventListener(t, f) { if (listeners[t] === f) delete listeners[t]; },
  };
  let queue = [], next = 1, now = 1000;
  const win = {
    matchMedia: () => ({ matches: reduce }),
    performance: { now: () => now },
    requestAnimationFrame(f) { const id = next++; queue.push([id, f]); return id; },
    cancelAnimationFrame(id) { queue = queue.filter(([i]) => i !== id); },
  };
  const step = (ms = 1000 / 60) => { now += ms; const q = queue; queue = []; for (const [, f] of q) f(now); return q.length; };
  return { body, win, writes, overflow, listeners, step, pending: () => queue.length };
}

test("it slides: many frames, always going up, ease-out, and lands exactly on 0 after TOP_MS", () => {
  const r = rig(3000);
  assert.equal(scrollToTop(r.body, r.win), true);
  assert.deepEqual(r.overflow, ["hidden", ""], "momentum stopped first");
  let frames = 0;
  while (r.pending() && frames < 100) { r.step(); frames++; }
  assert.equal(r.body.scrollTop, 0);
  assert.equal(r.writes.at(-1), 0);
  const moved = r.writes.filter((v) => v > 0 && v < 3000);
  assert.ok(moved.length >= 10, `in-between positions drawn: ${moved.length}`); // not one assignment
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i] <= r.writes[i - 1], "never moves back down");
  assert.ok(frames * 1000 / 60 >= TOP_MS - 17 && frames * 1000 / 60 <= TOP_MS + 34, `~${TOP_MS} ms: ${frames} frames`);
  // ease-out: the first half of the time covers well over half the way
  const mid = r.writes[Math.floor(r.writes.length / 2)];
  assert.ok(mid < 3000 * 0.25, `mid-way at ${mid}`);
  assert.equal(Object.keys(r.listeners).length, 0, "touch listener removed when done");
});

test("easeOut runs 0 -> 1, fast first", () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.8);
});

test("reduced motion: one jump to 0, no frames", () => {
  const r = rig(800, { reduce: true });
  assert.equal(scrollToTop(r.body, r.win), true);
  assert.deepEqual(r.writes, [0]);
  assert.equal(r.pending(), 0);
});

test("a touch on the list stops the slide where it is", () => {
  const r = rig(2000);
  scrollToTop(r.body, r.win);
  r.step(); r.step();
  const at = r.body.scrollTop;
  assert.ok(at > 0 && at < 2000);
  r.listeners.touchstart();
  assert.equal(r.pending(), 0);
  r.step();
  assert.equal(r.body.scrollTop, at);
});

test("B60: a second call mid-slide is ignored: the running slide goes on untouched and lands on 0", () => {
  const r = rig(2000);
  scrollToTop(r.body, r.win);
  r.step(); r.step();
  const writes = r.writes.length, overflow = r.overflow.length;
  assert.equal(isSliding(r.body), true);
  assert.equal(scrollToTop(r.body, r.win), true);
  assert.equal(r.writes.length, writes, "no restart step");
  assert.equal(r.overflow.length, overflow, "no second momentum stop");
  assert.equal(r.pending(), 1);
  for (let i = 0; i < 100 && r.pending(); i++) r.step();
  assert.equal(r.body.scrollTop, 0);
  assert.equal(isSliding(r.body), false);
});

test("B60: 5 quick reselects make one slide that ends at 0, with reselect() run once", () => {
  const r = rig(3000);
  let reselects = 0;
  const results = [];
  const opts = { selectTab: () => assert.fail("no tab switch"), reselect: () => { reselects++; },
    scrollTop: () => scrollToTop(r.body, r.win), sliding: () => isSliding(r.body) };
  for (let i = 0; i < 5; i++) {
    results.push(tapTab("search", { tab: "search", path: [] }, opts));
    r.step(40); // taps ~40 ms apart, well inside TOP_MS
  }
  assert.deepEqual(results, ["reselect", "busy", "busy", "busy", "busy"]);
  assert.equal(reselects, 1);
  assert.deepEqual(r.overflow, ["hidden", ""], "one momentum stop: one slide");
  for (let i = 0; i < 100 && r.pending(); i++) r.step();
  assert.equal(r.body.scrollTop, 0);
  for (let i = 1; i < r.writes.length; i++) assert.ok(r.writes[i] <= r.writes[i - 1], "never moves back down");
  // at the top, a further tap does nothing to the scroller, as before (reselect still runs, e.g. Search focuses)
  const n = r.writes.length;
  assert.equal(tapTab("search", { tab: "search", path: [] }, opts), "reselect");
  assert.equal(r.writes.length, n);
  assert.equal(r.pending(), 0);
});

test("B60: after a touch stops the slide, the next tap slides again", () => {
  const r = rig(2000);
  scrollToTop(r.body, r.win);
  r.step();
  r.listeners.touchstart();
  assert.equal(isSliding(r.body), false);
  assert.equal(scrollToTop(r.body, r.win), true);
  for (let i = 0; i < 100 && r.pending(); i++) r.step();
  assert.equal(r.body.scrollTop, 0);
});

test("a frame stamped before the tap does not push the list down", () => {
  const r = rig(500);
  scrollToTop(r.body, r.win);
  r.step(-5);
  assert.ok(r.writes.every((v) => v <= 500));
});
