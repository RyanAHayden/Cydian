// B48: scrolling on an app page started an install. A click that ends a drag, a scroll or a cancelled touch never
// runs Install (nav/tapguard.js); a hold's menu can't be chosen by the touch that opened it, and a hold ends when
// the pane scrolls (nav/menu.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTapGuard, guarded, MOVE } from "./tapguard.js";

// An event target good enough for capture listeners on the document.
function fakeDoc() {
  const on = {};
  return {
    on,
    addEventListener(t, f) { (on[t] ??= new Set()).add(f); },
    removeEventListener(t, f) { on[t]?.delete(f); },
    fire(t, e = {}) {
      const ev = { type: t, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; }, ...e };
      for (const f of [...(on[t] ?? [])]) { f(ev); if (ev.stopped) break; }
      return ev;
    },
  };
}

function setup() {
  let t = 0;
  const doc = fakeDoc();
  const guard = createTapGuard(doc, { now: () => t });
  let installs = 0;
  const onClick = guarded(() => { installs++; }, guard);
  const click = (extra = {}) => { const ev = doc.fire("click", { detail: 1, ...extra }); onClick(ev); return ev; };
  return { doc, guard, click, installs: () => installs, tick: (ms) => { t += ms; } };
}

const down = (doc, x = 100, y = 300) => doc.fire("pointerdown", { pointerId: 1, isPrimary: true, clientX: x, clientY: y });
const move = (doc, x, y) => doc.fire("pointermove", { pointerId: 1, clientX: x, clientY: y });
const up = (doc, x, y) => doc.fire("pointerup", { pointerId: 1, clientX: x, clientY: y });

test("a tap that stays put installs", () => {
  const s = setup();
  down(s.doc); move(s.doc, 103, 304); up(s.doc, 103, 304);
  s.click();
  assert.equal(s.installs(), 1);
});

test("a drag that scrolled the pane never clicks Install, even when the finger came back", () => {
  const s = setup();
  down(s.doc); move(s.doc, 100, 296); s.doc.fire("scroll", {}); move(s.doc, 100, 300); up(s.doc, 100, 300);
  const ev = s.click();
  assert.equal(s.installs(), 0);
  assert.ok(ev.defaultPrevented);
});

test("a drag past MOVE px never clicks Install, scroll or not", () => {
  const s = setup();
  down(s.doc); move(s.doc, 100, 300 - MOVE - 2); up(s.doc, 100, 300 - MOVE - 2);
  s.click();
  assert.equal(s.installs(), 0);
});

test("touchmove counts once iOS stops sending pointermove (it pans)", () => {
  const s = setup();
  down(s.doc);
  s.doc.fire("touchmove", { touches: [{ clientX: 100, clientY: 260 }] });
  up(s.doc, 100, 300);
  s.click();
  assert.equal(s.installs(), 0);
});

test("a cancelled touch (iOS took it for a scroll) never clicks", () => {
  const s = setup();
  down(s.doc); s.doc.fire("pointercancel", { pointerId: 1 });
  s.click();
  assert.equal(s.installs(), 0);
});

test("the next clean tap installs again; a scroll with no finger down doesn't count", () => {
  const s = setup();
  down(s.doc); s.doc.fire("scroll", {}); up(s.doc, 100, 300);
  s.click();
  s.doc.fire("scroll", {}); // momentum after the lift
  down(s.doc); up(s.doc, 100, 300);
  s.click();
  assert.equal(s.installs(), 1);
});

test("keyboard, el.click() and direct calls always run; a stale gesture doesn't speak for a later click", () => {
  const s = setup();
  down(s.doc); move(s.doc, 100, 200); up(s.doc, 100, 200);
  s.click({ detail: 0 });
  s.tick(5000);
  s.click();
  assert.equal(s.installs(), 2);
  let ran = 0;
  guarded(() => { ran++; }, s.guard)();
  assert.equal(ran, 1);
});

test("without a document (node) guarded() just runs", () => {
  let ran = 0;
  guarded(() => { ran++; })({ detail: 1 });
  assert.equal(ran, 1);
});
