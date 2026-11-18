// F166: iOS 6's UIActivityIndicatorView, redrawn from the 4S's UIKit frames (ref/4s/artwork/Shared@2x/
// UIActivityIndicatorViewStyle{White,Gray,WhiteLarge}.N.png, measured in journal/2026-11-18-f166-spinners/).
// 12 rounded spokes in one flat colour; frame 0 has its brightest spoke at 9 o'clock and five dimmer ones behind it
// (8 o'clock round to 4), the other six at the floor alpha. Every next frame is frame 0 turned 30 degrees clockwise,
// so one image turned a spoke at a time (ios6.css @keyframes hud-spin) is the whole animation.
// ios6.css holds these images as data URLs (--spinner-white, --spinner-gray, --spinner-large); spinner.test.js checks
// that they are the same as spinnerURL() here, so change both together.

// Alphas (of 255) by spoke, spoke k pointing k * 30 degrees clockwise from 12 o'clock, as sampled from frame 0.
const WHITE_ALPHA = [69, 69, 69, 69, 94, 118, 143, 168, 192, 217, 69, 69];
const GRAY_ALPHA = [31, 31, 31, 31, 42, 53, 64, 75, 86, 98, 31, 31];

// size: the view box in points; r1-r2: where the spoke's centre line runs (the round caps add width/2 each end).
export const SPINNERS = {
  white: { size: 20, color: "#fff", width: 2, r1: 6, r2: 9, alpha: WHITE_ALPHA }, // UIActivityIndicatorViewStyleWhite
  gray: { size: 20, color: "#000", width: 2, r1: 6, r2: 9, alpha: GRAY_ALPHA }, // UIActivityIndicatorViewStyleGray
  large: { size: 37, color: "#fff", width: 3, r1: 10, r2: 16, alpha: WHITE_ALPHA }, // ...StyleWhiteLarge
};

const num = (n) => String(Math.round(n * 1000) / 1000);

// The spinner as a standalone SVG document.
export function spinnerSVG(kind) {
  const s = SPINNERS[kind];
  if (!s) throw new Error(`no spinner style ${kind}`);
  const c = num(s.size / 2);
  const spokes = s.alpha.map((a, k) =>
    `<line x1='${c}' y1='${num(s.size / 2 - s.r2)}' x2='${c}' y2='${num(s.size / 2 - s.r1)}'`
    + (k ? ` transform='rotate(${k * 30} ${c} ${c})'` : "") + ` opacity='${num(a / 255)}'/>`).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${s.size} ${s.size}'>`
    + `<g stroke='${s.color}' stroke-width='${num(s.width)}' stroke-linecap='round'>${spokes}</g></svg>`;
}

// The same as a CSS url() value.
export function spinnerURL(kind) {
  return `url("data:image/svg+xml,${spinnerSVG(kind).replace(/[<>#"]/g, encodeURIComponent)}")`;
}
