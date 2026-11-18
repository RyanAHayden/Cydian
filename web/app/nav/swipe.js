// Interactive edge-swipe back: a touch that starts at the left edge and moves right drags the top screen with the
// finger, revealing the one below; letting go finishes or cancels the pop (swipeCommits). The caller does the
// drawing: begin() returns the width, move(dx) runs at most once per animation frame, end(dx, vx) on release.
// root is the edge strip (app.js), which has `touch-action: none`: the browser leaves every move to us. A move that
// is mostly vertical gives up, so nothing is dragged by accident. A touch iOS takes away without a pointerup or
// pointercancel (a notification coming down mid-swipe, user 2026-11-18) left the screen half dragged and every later
// swipe ignored: losing capture, the page losing focus or a new touch now cancel it.

const EDGE = 24;    // px from the left edge where a swipe may start (UIKit's is about 20pt)
const SLOP = 10;    // px before we decide between a swipe and a scroll

export function attachEdgeSwipe(root, { canStart, begin, move, end }, win = globalThis) {
  let t = null; // the tracked touch: { id, x0, y0, started, width, dx, samples, frame }
  const drop = () => { if (t) release({ pointerId: t.id, timeStamp: performance.now() }, true); }; // slides back

  root.addEventListener("pointerdown", (e) => {
    if (t && e.pointerId !== t.id) drop(); // the last touch never ended
    if (t || !e.isPrimary || e.button > 0 || e.clientX > EDGE || !canStart()) return;
    t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, dx: 0, samples: [], frame: 0 };
  });

  root.addEventListener("pointermove", (e) => {
    if (!t || e.pointerId !== t.id) return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    if (!t.started) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { t = null; return; } // a scroll
      if (dx <= SLOP || dx <= Math.abs(dy)) return;
      t.started = true;
      root.setPointerCapture(t.id);
      t.width = begin();
      t.x0 = e.clientX; // start from here, so the screen doesn't jump by the slop
    }
    t.dx = Math.max(0, e.clientX - t.x0);
    t.samples.push([e.timeStamp, e.clientX]);
    if (t.samples.length > 6) t.samples.shift();
    if (!t.frame) {
      const tt = t;
      t.frame = requestAnimationFrame(() => { tt.frame = 0; if (t === tt) move(tt.dx); });
    }
  });

  const release = (e, cancelled) => {
    if (!t || e.pointerId !== t.id) return;
    const tt = t;
    t = null;
    if (!tt.started) return;
    if (tt.frame) cancelAnimationFrame(tt.frame);
    end(tt.dx, cancelled ? -1 : velocity(tt.samples, e.timeStamp));
  };
  root.addEventListener("pointerup", (e) => release(e, false));
  root.addEventListener("pointercancel", (e) => release(e, true));
  root.addEventListener("lostpointercapture", (e) => release(e, true)); // after a pointerup there's nothing left to drop
  win.addEventListener?.("blur", drop);
  win.document?.addEventListener("visibilitychange", () => { if (win.document.visibilityState === "hidden") drop(); });
  return { drop };
}

// px/ms over the last ~80 ms of moves; 0 if the finger stopped before letting go.
function velocity(samples, now) {
  const recent = samples.filter(([ts]) => now - ts < 80);
  if (recent.length < 2) return 0;
  const [t0, x0] = recent[0];
  const [t1, x1] = recent[recent.length - 1];
  return t1 > t0 ? (x1 - x0) / (t1 - t0) : 0;
}
