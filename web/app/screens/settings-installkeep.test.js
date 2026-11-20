// Installation & Signing keeps its Installation block across the page's own repaints, so This iPhone's rows don't go
// back to Checking… each time another slow bridge call answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepInstallBox, returnWatcher, INSTALL_KEEP_MS } from "./settings.js";

test("the kept block is reused while the choice holds, it is fresh, and the app didn't leave", () => {
  const kept = { box: {}, choice: "iphone", at: 1000 };
  assert.equal(keepInstallBox(kept, { choice: "iphone", now: 3500 }), true); // a repaint 2.5 s later
  assert.equal(keepInstallBox(kept, { choice: "server", now: 3500 }), false); // Install Apps With changed
  assert.equal(keepInstallBox(kept, { choice: "iphone", now: 3500, stale: true }), false); // back from the background
  assert.equal(keepInstallBox(kept, { choice: "iphone", now: 1000 + INSTALL_KEEP_MS }), false); // too old
  assert.equal(keepInstallBox(undefined, { choice: "iphone", now: 0 }), false); // first draw
});

test("only a back-from-background redraw marks the block stale, not the status check", async () => {
  const on = {};
  const target = () => ({ addEventListener: (t, fn) => { on[t] = fn; } });
  const doc = Object.assign(target(), { visibilityState: "visible", querySelector: () => ({}) });
  let backs = 0, redraws = 0, ready = false;
  const check = returnWatcher({ doc, win: target(), redraw: () => { redraws++; }, interval: () => {},
    status: async () => (ready ? { identity: { profile: {} } } : { identity: null }), back: () => { backs++; } });
  await check();
  ready = true;
  await on.focus(); // the status changed: a redraw that keeps the block
  assert.deepEqual([redraws, backs], [1, 0]);
  on.visibilitychange();
  on.pageshow();
  assert.deepEqual([redraws, backs], [3, 2]);
  doc.visibilityState = "hidden";
  on.visibilitychange();
  assert.deepEqual([redraws, backs], [3, 2]);
});
