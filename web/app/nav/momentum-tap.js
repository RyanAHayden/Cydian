// F153: a quick tap while a list is still coasting opens the row, not only stops the scroll (user 2026-11-18). iOS
// spends a touch that lands during momentum on stopping it, and the row gets no click. Two ways in:
// - The app: UIKit swallows that touch whole (WebKit sees no touchstart, no pointerdown: checked on the iPhone 7),
//   so native/Sources/MomentumTap.swift spots the tap on the decelerating scroll view and calls
//   ifizboxMomentumTap(x, y) here.
// - Touch events that do reach the page (a browser that sends them, or our own JS fling in nav/scroller.js): a
//   touch that starts while a scroller is coasting (a scroll event with no finger down in the last MOMENTUM ms) and
//   ends as a quick tap (at most TAP_MS long, at most SLOP px off where it began) gets its click from us.
// Either way the click goes to what is under the finger, and only once: a native click on top of ours is cancelled
// (touchend's preventDefault, or dropped within DOUBLE ms), and ours is skipped if a native one just came. A drag
// (more movement, or longer) still only scrolls.
// The website (iOS Safari) has no fix, by choice (R17, journal/2026-11-18-r17-safari-momentum-tap): touch-action
// and document scrolling don't help. Only a JS-driven coast (kill UIKit's momentum at touchend, drive scrollTop by
// rAF) lets the tap reach this file's touch path, and that runs every fling at Safari's 60 fps rAF instead of 120 Hz,
// with a hitch at release.

export const TAP_MS = 300;   // longer than this is a hold, not a tap
export const SLOP = 10;      // px; UIKit's tap allowance is about 10 pt
export const MOMENTUM = 120; // ms since the last finger-free scroll event that still counts as coasting
export const DOUBLE = 350;   // ms: a native click this close to ours is the same tap

// The tap-vs-drag rule: a touch of `ms` milliseconds that ended (dx, dy) px from where it started.
export function isQuickTap(ms, dx, dy) {
  return ms >= 0 && ms <= TAP_MS && Math.hypot(dx, dy) <= SLOP;
}

// Was a scroller coasting when the touch came down? `lastFreeScroll` is the time of the last scroll event while no
// finger was on the screen (momentum, or our own fling), or -Infinity.
export function coasting(touchAt, lastFreeScroll) {
  return touchAt - lastFreeScroll <= MOMENTUM;
}

// What a tap on `el` would activate: a link, a button or one of the app's pressable rows. Text fields are left to
// the browser (focus and the keyboard come only from a real touch).
const TAPPABLE = "a[href], button, label, summary, [role=button], .bar-button, .cell-inner, .alert-button, .del-confirm";
export function tapTarget(el) {
  if (!el || typeof el.closest !== "function") return null;
  if (el.closest("input, textarea, select, [contenteditable]")) return null;
  const t = el.closest(TAPPABLE);
  return t && !t.disabled ? t : null;
}

let current = null; // { x, y, at, momentum, moved } the touch in progress

// While a touch that began during momentum is still a tap: the pressed-row look should stay on through the
// coasting list's last scroll events (app.js's scroll handler asks).
export function heldTap() {
  return !!(current && current.momentum && !current.moved);
}

export function initMomentumTap(doc = document, win = window) {
  let fingers = 0;
  let lastFreeScroll = -Infinity;
  let lastNative = -Infinity;
  let ours = null; // { at, target } our last click
  const now = () => win.performance.now();

  // Click what is under (x, y), unless the browser just clicked there itself.
  const clickAt = (x, y, screenX = x, screenY = y) => {
    if (now() - lastNative < DOUBLE) return false;
    // What's under the finger now: the list may have moved a hair, or re-rendered its rows (vlist), since touch-down.
    const target = tapTarget(doc.elementFromPoint(x, y));
    if (!target) return false;
    ours = { at: now(), target };
    // Run inside the touch (or the native call, which WebKit runs as a user gesture): window.open, haptics and file
    // pickers still work.
    target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win, detail: 1, clientX: x, clientY: y, screenX, screenY }));
    return true;
  };
  globalThis.ifizboxMomentumTap = (x, y) => clickAt(x, y);

  doc.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    if (ours && now() - ours.at < DOUBLE && (ours.target === e.target || ours.target.contains?.(e.target))) {
      e.preventDefault(); e.stopImmediatePropagation(); // the same tap, already clicked
      return;
    }
    lastNative = now();
  }, { capture: true });
  doc.addEventListener("scroll", () => { if (fingers === 0) lastFreeScroll = now(); }, { capture: true, passive: true });
  doc.addEventListener("touchstart", (e) => {
    fingers = e.touches.length;
    const t = e.changedTouches[0];
    current = fingers === 1 && t ? { id: t.identifier, x: t.clientX, y: t.clientY, at: now(), momentum: coasting(now(), lastFreeScroll), moved: false } : null;
  }, { capture: true, passive: true });
  doc.addEventListener("touchmove", (e) => {
    if (!current) return;
    const t = [...e.changedTouches].find((x) => x.identifier === current.id);
    if (t && Math.hypot(t.clientX - current.x, t.clientY - current.y) > SLOP) current.moved = true;
  }, { capture: true, passive: true });
  doc.addEventListener("touchcancel", (e) => { fingers = e.touches.length; current = null; }, { capture: true, passive: true });
  doc.addEventListener("touchend", (e) => {
    fingers = e.touches.length;
    const c = current;
    current = null;
    if (!c || !c.momentum || c.moved) return;
    const t = [...e.changedTouches].find((x) => x.identifier === c.id);
    if (!t || !isQuickTap(now() - c.at, t.clientX - c.x, t.clientY - c.y)) return;
    if (clickAt(t.clientX, t.clientY, t.screenX, t.screenY) && e.cancelable) e.preventDefault(); // no native click too
  }, { capture: true, passive: false });
}
