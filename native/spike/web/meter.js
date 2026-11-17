// Frame meter on the page side: requestAnimationFrame intervals per phase, sent to Swift in batches.
// Swift's CADisplayLink meter (Meter.swift) records the app process at the same time; both land in the results.
import { call } from './bridge.js';

let phase = 'idle';
let last = 0;
let buf = [];
let raf = 0;

export const getPhase = () => phase;

export function setPhase(p) {
  if (p === phase) return;
  flush();
  phase = p;
  last = 0;
  call('meter.phase', { phase: p });
  if (p !== 'idle' && !raf) raf = requestAnimationFrame(tick);
}

function tick(t) {
  raf = 0;
  if (phase === 'idle') return;
  if (last) buf.push(Math.round((t - last) * 1000) / 1000);
  last = t;
  if (buf.length >= 240) flush();
  raf = requestAnimationFrame(tick);
}

function flush() {
  if (buf.length) call('meter.samples', { phase, source: 'js', ms: buf });
  buf = [];
}

// Marks 'scroll' while the target scrolls (finger or momentum), back to idle 200 ms after the last scroll event.
export function watchScroll(target) {
  let timer = 0;
  target.addEventListener('scroll', () => {
    if (phase !== 'idle' && phase !== 'scroll') return;
    setPhase('scroll');
    clearTimeout(timer);
    timer = setTimeout(() => phase === 'scroll' && setPhase('idle'), 200);
  }, { passive: true });
}

// JS-driven fast scroll for 3 s (about 10,000 pt/s at 120 Hz): the list re-render cost without a finger.
export function autoscroll(scroller, ms = 3000, step = 90) {
  return new Promise((done) => {
    setPhase('autoscroll');
    const end = performance.now() + ms;
    const frame = (t) => {
      scroller.scrollTop += step;
      if (t < end) requestAnimationFrame(frame);
      else { setPhase('idle'); scroller.scrollTop = 0; done(); }
    };
    requestAnimationFrame(frame);
  });
}
