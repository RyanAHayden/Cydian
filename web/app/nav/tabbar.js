// The tab bar: one item per tab, icon drawn in CSS (ios6.css masks a gradient with an SVG glyph per tab), and a
// red count badge per item. setBadge(tab, n) shows n (a number or short text), "spinner" a spinner (Cydia's
// Sources tab while refreshing); 0, "" or null hides it.

export function createTabbar(el, tabs, titleOf) {
  const items = {};
  for (const tab of tabs) {
    const a = document.createElement("a");
    a.className = "tab";
    a.dataset.tab = tab;
    a.innerHTML = '<span class="tab-icon" aria-hidden="true"></span><span class="tab-label"></span><span class="badge" hidden></span>';
    a.querySelector(".tab-label").textContent = titleOf(tab);
    el.append(a);
    items[tab] = a;
  }
  return {
    items,
    select(tab) {
      for (const [t, a] of Object.entries(items)) {
        a.classList.toggle("active", t === tab);
        if (t === tab) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
    },
    setBadge(tab, n) {
      const badge = items[tab] && items[tab].querySelector(".badge");
      if (!badge) return;
      const show = n !== 0 && n != null && n !== "";
      const spin = n === "spinner"; // Cydia's Sources badge while sources refresh: white spokes, no number
      badge.hidden = !show;
      badge.classList.toggle("spinning", spin);
      badge.textContent = show && !spin ? String(n) : "";
      items[tab].setAttribute("aria-label", titleOf(tab) + (show ? `, ${n} new` : ""));
    },
  };
}

// A tap on tab `tab` while `current` is the route on screen. As on iOS: another tab -> switch to it (selectTab
// keeps its place); the current tab below its root -> back to the root (selectTab again); the current tab at its
// root -> scrollTop() (the screen's scroller back to the top, like UIKit's status-bar tap, F148) and then the
// screen's reselect(), e.g. Search focuses its field (F36). Everything runs synchronously inside the tap's click
// handler, so iOS counts a focus() there as user-initiated and shows the keyboard.
export function tapTab(tab, current, { selectTab, reselect, scrollTop }) {
  if (current && current.tab === tab && current.path.length === 0) {
    if (scrollTop) scrollTop();
    if (reselect) reselect();
    return "reselect";
  }
  selectTab(tab);
  return "select";
}

// Scroll a page's scroller (.page-body) back to the top, like UIKit's status-bar tap: a quick slide (TOP_MS,
// ease-out), or an instant jump when the user asked for less motion. A fling still coasting would win over the
// scroll on iOS WebKit, so it is stopped first (overflow off for one layout), as UIKit stops the deceleration.
// B57: scrollTo({behavior: "smooth"}) jumped straight to the top on the iPhone 7 (iOS 15.8 WebKit, app and Safari;
// journal/2026-11-18-b57-*), so the slide is our own: scrollTop set on each animation frame. A touch on the list
// ends it where it is, and a new call replaces a running one. Only without requestAnimationFrame does it fall back
// to scrollTo. Virtualised lists (nav/vlist.js) re-bind their rows from the scroll events this sends, so the top
// rows are drawn when it lands.
export const TOP_MS = 300;
const slides = new WeakMap(); // body -> stop() of its running slide

// Ease-out cubic: fast at first, settling into the top.
export const easeOut = (p) => 1 - (1 - p) ** 3;

export function scrollToTop(body, win = globalThis) {
  if (!body) return false;
  if (body.scrollTop <= 0) return false;
  slides.get(body)?.();
  body.style.overflowY = "hidden";
  void body.offsetHeight;
  body.style.overflowY = "";
  const reduce = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const raf = win.requestAnimationFrame;
  if (!raf) {
    body.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    return true;
  }
  if (reduce) {
    body.scrollTop = 0;
    return true;
  }
  const from = body.scrollTop;
  let t0 = null, id = 0, done = false;
  const stop = () => {
    if (done) return;
    done = true;
    if (id && win.cancelAnimationFrame) win.cancelAnimationFrame.call(win, id);
    if (body.removeEventListener) body.removeEventListener("touchstart", stop);
    if (slides.get(body) === stop) slides.delete(body);
  };
  const frame = (now) => {
    if (done) return;
    if (t0 === null) t0 = now;
    const p = Math.min(1, Math.max(0, (now - t0) / TOP_MS)); // a frame's time can predate the tap

    body.scrollTop = p >= 1 ? 0 : Math.round(from * (1 - easeOut(p)));
    if (p >= 1) stop();
    else id = raf.call(win, frame);
  };
  slides.set(body, stop);
  if (body.addEventListener) body.addEventListener("touchstart", stop, { passive: true });
  // The first step runs now, inside the tap, so the list moves on the very next frame.
  frame(win.performance?.now?.() ?? Date.now());
  return true;
}
