// iOS 6 scroll indicator (UIKit's UIScrollerIndicatorDefault: a 5pt black-at-50% pill with a 1pt 15% white ring),
// drawn by us because each screen scrolls in its own box and the native indicator doesn't look like iOS 6. One
// indicator follows whichever screen's .page-body is scrolling, between the nav bar and the tab bar. It shows
// while scrolling and fades after; while it shows, dragging it scrubs the list with momentum on release, and a
// haptic ticks (on touch-down in the app, on release in Safari, the earliest it allows). Moved by transform (the height changes only when the content does).
import { haptic } from "./haptic.js";

export function initScroller(screens) {
  const sb = document.createElement("div");
  sb.className = "scroll-indicator";
  sb.setAttribute("aria-hidden", "true");
  document.body.append(sb);
  let body = null;   // the .page-body being shown
  let hideTimer = 0;
  let grab = null;   // finger offset inside the indicator while held

  const navbar = document.getElementById("navbar");
  const tabbar = document.getElementById("tabbar");
  // Measured rarely, never per frame: the bars' edges only change on resize, the content's height only when it
  // resizes (a ResizeObserver tells us). Reading layout in a frame where a list has just moved its rows forced a full
  // layout every frame of a fling.
  let bars = null;     // { top, track }
  let sizes = null;    // { h, th } for the current body
  const measureBars = () => {
    const top0 = navbar ? navbar.getBoundingClientRect().bottom : screens.getBoundingClientRect().top;
    const bottom0 = tabbar ? tabbar.getBoundingClientRect().top : screens.getBoundingClientRect().bottom;
    bars = { top: top0 + 3, track: bottom0 - top0 - 6 };
  };
  const measureBody = () => {
    if (!bars) measureBars();
    const sh = body.scrollHeight, ch = body.clientHeight;
    sizes = { h: sh - ch, th: Math.max(36, bars.track * ch / sh) };
  };
  addEventListener("resize", () => { bars = null; sizes = null; });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { sizes = null; if (sb.classList.contains("on")) place(); }) : null;
  const watch = (b) => {
    ro?.disconnect();
    if (!b || !ro) return;
    ro.observe(b);
    for (const c of b.children) ro.observe(c); // lists grow inside the scroller (Search results, a source loading)
  };
  const geom = () => {
    if (!sizes) measureBody();
    return { top: bars.top, track: bars.track, h: sizes.h, th: sizes.th };
  };
  // Like UIScrollView: a page that fits on screen still shows a full-length indicator while it bounces, and pulling
  // past either end squashes the indicator against that end.
  const place = () => {
    if (!body || !body.isConnected) return false;
    const m = geom();
    const top = body.scrollTop;
    const over = top < 0 ? -top : top > m.h ? top - m.h : 0;
    const base = m.h <= 1 ? m.track : m.th;
    const th = Math.max(7, base - over);
    const y = m.h <= 1 ? (top > 0 ? 1 : 0) : Math.min(Math.max(top / m.h, 0), 1);
    sb.style.height = th + "px";
    sb.style.transform = `translateY(${m.top + (m.track - th) * y}px)`;
    return true;
  };
  const draw = () => {
    if (!place()) return;
    sb.classList.add("on");
    clearTimeout(hideTimer);
    if (grab === null) hideTimer = setTimeout(() => sb.classList.remove("on"), 600);
  };

  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("page-body")) return;
    if (body !== t) { body = t; sizes = null; watch(t); }
    draw();
  }, { capture: true, passive: true });

  // Momentum after letting go, like a native fling: the scrub's last ~80 ms give a velocity in scroll px/ms that
  // decays each frame. Any touch on the page stops it.
  let samples = [];
  let glide = 0;
  const stopGlide = () => { cancelAnimationFrame(glide); glide = 0; };
  document.addEventListener("pointerdown", (e) => { if (e.target !== sb) stopGlide(); }, { capture: true, passive: true });
  function fling(v) {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last); last = now;
      v *= Math.pow(0.95, dt / 16.67);
      const max = body.scrollHeight - body.clientHeight;
      const next = Math.max(0, Math.min(max, body.scrollTop + v * dt));
      body.scrollTop = next;
      if (Math.abs(v) < 0.02 || next <= 0 || next >= max) { glide = 0; return; }
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  sb.addEventListener("pointerdown", (e) => {
    if (!sb.classList.contains("on") || !body) return;
    e.preventDefault();
    stopGlide();
    grab = e.clientY - sb.getBoundingClientRect().top;
    samples = [];
    sb.setPointerCapture?.(e.pointerId);
    sb.classList.add("grab");
    clearTimeout(hideTimer);
    if (globalThis.cydianApp) haptic(); // the app's bridge can tick on touch-down; Safari only allows it on lift
  });
  sb.addEventListener("pointermove", (e) => {
    if (grab === null || !body) return;
    const m = geom();
    if (m.h <= 1) return; // nothing to scrub on a page that fits
    body.scrollTop = (e.clientY - grab - m.top) / (m.track - m.th) * m.h;
    const now = performance.now();
    samples.push([now, body.scrollTop]);
    while (samples.length > 2 && now - samples[0][0] > 80) samples.shift();
  });
  const end = (e) => {
    if (grab === null) return;
    grab = null;
    sb.classList.remove("grab");
    // Safari plays its switch haptic only inside a finished touch (pointerup counts, pointerdown doesn't).
    if (e?.type === "pointerup" && !globalThis.cydianApp) haptic();
    const [a, z] = [samples[0], samples.at(-1)];
    if (e?.type === "pointerup" && a && z && z[0] - a[0] > 10) {
      const v = (z[1] - a[1]) / (z[0] - a[0]);
      if (Math.abs(v) > 0.3) fling(v);
    }
    draw();
  };
  sb.addEventListener("pointerup", end);
  sb.addEventListener("pointercancel", end);
  return sb;
}
