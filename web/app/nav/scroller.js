// iOS 6 scroll indicator (UIKit's UIScrollerIndicatorDefault: a 5pt black-at-50% pill with a 1pt 15% white ring),
// drawn by us because each screen scrolls in its own box and the native indicator doesn't look like iOS 6. One
// indicator follows whichever screen's .page-body is scrolling, between the nav bar and the tab bar. It shows
// while scrolling and fades after; while it shows, holding it gives a haptic tick and dragging it scrubs the list,
// like native. Moved by transform (the height changes only when the content does).
import { haptic } from "./haptic.js";

export function initScroller(screens) {
  const sb = document.createElement("div");
  sb.className = "scroll-indicator";
  sb.setAttribute("aria-hidden", "true");
  document.body.append(sb);
  let body = null;   // the .page-body being shown
  let hideTimer = 0;
  let grab = null;   // finger offset inside the indicator while held

  const geom = () => {
    const r = screens.getBoundingClientRect();
    const track = r.height - 6;
    const h = body.scrollHeight - body.clientHeight;
    const th = Math.max(36, track * body.clientHeight / body.scrollHeight);
    return { top: r.top + 3, track, h, th };
  };
  const draw = () => {
    if (!body || !body.isConnected) return;
    const m = geom();
    if (m.h <= 1) return;
    const y = Math.min(Math.max(body.scrollTop / m.h, 0), 1);
    sb.style.height = m.th + "px";
    sb.style.transform = `translateY(${m.top + (m.track - m.th) * y}px)`;
    sb.classList.add("on");
    clearTimeout(hideTimer);
    if (grab === null) hideTimer = setTimeout(() => sb.classList.remove("on"), 600);
  };

  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("page-body")) return;
    body = t;
    draw();
  }, { capture: true, passive: true });

  sb.addEventListener("pointerdown", (e) => {
    if (!sb.classList.contains("on") || !body) return;
    e.preventDefault();
    grab = e.clientY - sb.getBoundingClientRect().top;
    sb.setPointerCapture?.(e.pointerId);
    sb.classList.add("grab");
    clearTimeout(hideTimer);
    haptic();
  });
  sb.addEventListener("pointermove", (e) => {
    if (grab === null || !body) return;
    const m = geom();
    body.scrollTop = (e.clientY - grab - m.top) / (m.track - m.th) * m.h;
  });
  const end = () => {
    if (grab === null) return;
    grab = null;
    sb.classList.remove("grab");
    draw();
  };
  sb.addEventListener("pointerup", end);
  sb.addEventListener("pointercancel", end);
  return sb;
}
