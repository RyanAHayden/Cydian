// Push/pop slides with the iOS curve and parallax, for the navigation stack. Everything moves by transform and
// opacity only, so the compositor runs it at the display's rate (120 Hz on ProMotion, docs/native.md "Feel"):
// nothing here reads layout or changes a size.
//
// A transition is described by one number, p: 0 shows only the screen below, 1 shows the top screen in place.
// A push runs p 0 -> 1, a pop 1 -> 0, and the edge swipe sets p from the finger, then animates to 0 or back to 1.

export const DURATION = 350; // ms, UINavigationController's push
export const EASE = "cubic-bezier(.36,.66,.04,1)"; // the iOS navigation curve: quick start, long soft landing
export const EASE_OUT = "cubic-bezier(.2,.8,.4,1)"; // finishing a swipe: the finger already gave the start
const PARALLAX = 0.3; // the screen below moves a third as far
const SHADE = 0.1;    // and darkens this much under the incoming one

// pair: { top: { page, shade, item }, below: { page, shade, item } }: page and nav-bar item elements.
function frames(p) {
  return [
    ["top", "page", { transform: `translate3d(${(1 - p) * 100}%,0,0)` }],
    ["below", "page", { transform: `translate3d(${-PARALLAX * p * 100}%,0,0)` }],
    ["below", "shade", { opacity: String(SHADE * p) }],
    ["top", "item", { transform: `translate3d(${(1 - p) * 50}%,0,0)`, opacity: String(p) }],
    ["below", "item", { transform: `translate3d(${-p * 50}%,0,0)`, opacity: String(1 - p) }],
  ];
}

// Pin the pair at p (the edge swipe calls this from the finger, once per animation frame).
export function setProgress(pair, p) {
  for (const [who, part, style] of frames(p)) Object.assign(pair[who][part].style, style);
}

// Drop the inline styles once the pair is at rest, so the stylesheet decides again.
export function clear(pair) {
  for (const [who, part] of frames(0)) {
    const s = pair[who][part].style;
    s.transform = "";
    s.opacity = "";
  }
}

// Animate the pair from p0 to p1, then call onEnd(). Returns { finish() }: finish() jumps to the end at once (a
// new navigation while one is still running) and runs onEnd before it returns, so the caller can go on at rest.
export function animate(pair, p0, p1, { duration = DURATION * Math.abs(p1 - p0), easing = EASE, onEnd } = {}) {
  const a = frames(p0);
  const b = frames(p1);
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
  // Every animation has the same timing, so the first one finishing means they all have.
  anims[0].finished.then(end, () => {});
  return { finish: end };
}
