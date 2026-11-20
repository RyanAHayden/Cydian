// Push/pop slides with the iOS curve and parallax, for the navigation stack. Everything moves by transform and
// opacity only, so the compositor runs it at the display's rate (120 Hz on ProMotion, docs/native.md "Feel"):
// nothing here reads layout or changes a size.
//
// A transition is described by one number, p: 0 shows only the screen below, 1 shows the top screen in place.
// A push runs p 0 -> 1, a pop 1 -> 0, and the edge swipe sets p from the finger, then animates to 0 or back to 1.

import { selectionOpacity } from "./selection.js";
import { SHEET_IN } from "./motion.js";

export const DURATION = SHEET_IN; // ms, UINavigationController's push (350, as long as a sheet rising)
export const EASE = "cubic-bezier(.36,.66,.04,1)"; // the iOS navigation curve: quick start, long soft landing
export const EASE_OUT = "cubic-bezier(.2,.8,.4,1)"; // finishing a swipe: the finger already gave the start
const PARALLAX = 0.3; // the screen below moves a third as far
const SHADE = 0.1;    // and darkens this much under the incoming one

// pair: { top: { page, shade, item }, below: { page, shade, item, select? } }: page and nav-bar item elements.
// below.select (F163, nav/selection.js): the blue copy of the row that opened the top page, faded with the pop.
function frames(p, pair) {
  const list = [
    ["top", "page", { transform: `translate3d(${(1 - p) * 100}%,0,0)` }],
    ["below", "page", { transform: `translate3d(${-PARALLAX * p * 100}%,0,0)` }],
    ["below", "shade", { opacity: String(SHADE * p) }],
    ["top", "item", { transform: `translate3d(${(1 - p) * 50}%,0,0)`, opacity: String(p) }],
    ["below", "item", { transform: `translate3d(${-p * 50}%,0,0)`, opacity: String(1 - p) }],
  ];
  if (pair?.below.select) list.push(["below", "select", { opacity: String(selectionOpacity(p)) }]);
  return list;
}

// Pin the pair at p (the edge swipe calls this from the finger, once per animation frame).
export function setProgress(pair, p) {
  for (const [who, part, style] of frames(p, pair)) Object.assign(pair[who][part].style, style);
}

// Drop the inline styles once the pair is at rest, so the stylesheet decides again.
export function clear(pair) {
  for (const [who, part] of frames(0, pair)) {
    const s = pair[who][part].style;
    s.transform = "";
    s.opacity = "";
  }
}

// Animate the pair from p0 to p1, then call onEnd(). Returns { finish() }: finish() jumps to the end at once (a
// new navigation while one is still running) and runs onEnd before it returns, so the caller can go on at rest.
export function animate(pair, p0, p1, { duration = DURATION * Math.abs(p1 - p0), easing = EASE, onEnd } = {}) {
  const a = frames(p0, pair);
  const b = frames(p1, pair);
  const anims = a.map(([who, part, from], i) =>
    pair[who][part].animate([from, b[i][2]], { duration: Math.max(0, duration), easing, fill: "forwards" }));
  let settled = false;
  const end = () => {
    if (settled) return;
    settled = true;
    setProgress(pair, p1); // hand the end state to inline styles, then drop the animations' fill
    for (const anim of anims) anim.cancel();
    if (onEnd) onEnd();
  };
  // Every animation has the same timing, so the first one finishing means they all have. A cancelled animation
  // (iOS can cancel them, e.g. when the app goes to the background) must end the slide too, or the tap block that
  // covers the nav bar and screens during a slide never lifts. The timer is the last resort if neither fires.
  anims[0].finished.then(end, end);
  setTimeout(end, Math.max(0, duration) + 300);
  return { finish: end };
}
