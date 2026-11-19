// B48: a click that ends a drag or a scroll is not a tap. iOS can still send click after a short drag (the tap
// recogniser allows more movement than the pan's start), or after the pane scrolled under a resting finger, and a
// scroll that started on Install then installed the app (user 2026-11-18). This follows each touch from its
// pointerdown: how far it moved, whether anything scrolled while it was down, whether iOS cancelled it. Install and
// destructive actions wrap their handler in guarded(), which drops a click that ends such a gesture.
//
//   row.onClick = guarded(() => install())   // ignores the click when the touch moved > MOVE px, scrolled or was cancelled
//   tapGuard().endsDrag(clickEvent)          // the same test, for a handler of your own
//
// A click with no touch behind it (keyboard, el.click(): detail 0, or a call with no event) always runs.

export const MOVE = 10;     // px a tap may wander, as longPress's
const STALE = 1000;         // ms after the lift that the gesture still speaks for a click

export function createTapGuard(doc, { now = () => (globalThis.performance ?? Date).now() } = {}) {
  let g = null; // { id, x, y, moved, scrolled, cancelled, down, upAt }
  const opts = { capture: true, passive: true };
  const moveTo = (x, y) => { if (g && Number.isFinite(x) && Number.isFinite(y)) g.moved = Math.max(g.moved, Math.hypot(x - g.x, y - g.y)); };
  const on = {
    pointerdown(e) {
      if (e.isPrimary === false) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, scrolled: false, cancelled: false, down: true, upAt: 0 };
    },
    pointermove(e) { if (g?.down && e.pointerId === g.id) moveTo(e.clientX, e.clientY); },
    // iOS stops pointermove once it pans; the touch's own moves still come.
    touchmove(e) { const t = e.touches?.[0]; if (g?.down && t) moveTo(t.clientX, t.clientY); },
    pointerup(e) { if (g?.down && e.pointerId === g.id) { moveTo(e.clientX, e.clientY); g.down = false; g.upAt = now(); } },
    pointercancel(e) { if (g?.down && e.pointerId === g.id) { g.cancelled = true; g.down = false; g.upAt = now(); } },
    // Any pane: the page body, a data-scroller, the screenshot strip. Only while the finger is down.
    scroll() { if (g?.down) g.scrolled = true; },
  };
  for (const [t, f] of Object.entries(on)) doc.addEventListener(t, f, opts);
  return {
    endsDrag(e) {
      if (!e || e.detail === 0 || !g) return false;
      if (!g.down && now() - g.upAt > STALE) return false;
      return g.cancelled || g.scrolled || g.moved > MOVE;
    },
    destroy() { for (const [t, f] of Object.entries(on)) doc.removeEventListener(t, f, opts); },
  };
}

let shared = null;
export function tapGuard(doc = globalThis.document) {
  if (!shared && doc?.addEventListener) shared = createTapGuard(doc);
  return shared;
}

// `fn` as a click handler that ignores a click ending a drag or scroll. The guard starts listening now (when the row
// is built), so it has seen the touch by the time the click comes.
export function guarded(fn, guard = tapGuard()) {
  return function (e, ...rest) {
    if (guard?.endsDrag(e)) { e.preventDefault?.(); e.stopPropagation?.(); return undefined; }
    return fn.call(this, e, ...rest);
  };
}
