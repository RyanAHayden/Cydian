// The nav bar seen from a screen: the nav item that goes with a page body, and a small icon button put beside the
// page's own right button (F210: the app page's Installed toggle, left of Install / Modify).
//
// The icon goes after the page's button in the DOM, so every `querySelector(".nav-right .bar-button:not(.share-button)")`
// (browse.js setRightLabel) still finds Install first; CSS `order` (style.css .nav-icon-left) draws it on the left.

import { handleOf } from "./go.js";

// The page's own nav item, from its handle (nav/go.js pageHandle); null for a body no page holds.
export function navItemOf(body) {
  return handleOf(body)?.item ?? null;
}

// Puts `button` (class nav-icon-left) left of the page's own right button, in place of an earlier one with the same
// `key` (a page drawn again). False when the page has no nav item yet (its caller tries again once it is laid out).
export function addNavIcon(body, button, key = "icon") {
  const item = navItemOf(body);
  const right = item?.querySelector(".nav-right");
  if (!right) return false;
  if (button.parentElement === right) return true;
  for (const old of right.querySelectorAll(":scope > .nav-icon-left")) if (old.dataset.navIcon === key) old.remove();
  button.dataset.navIcon = key;
  button.classList.add("nav-icon-left");
  const own = [...right.children].filter((b) => b.classList.contains("bar-button") && !b.classList.contains("share-button")
    && !b.classList.contains("nav-icon-left"));
  for (const b of own) b.classList.add("nav-after-icon");
  right.append(button);
  item.classList.add("has-nav-icon");
  return true;
}

// ---- Large titles: a nav hook for eras (docs/eras.md, iOS 13 and later) ------------------------------------------
//
// With <html data-nav="large">, set by the era's JS through setLargeTitles(true), each tab's root page draws its
// title as a big bold left title at the top of its body (a .large-title, its layout in style.css behind the hook),
// which scrolls with the content. As it goes under the nav bar it fades out and the bar's own .nav-title fades in.
// Opacity only, written once a frame while the page scrolls, and only when it changes. Off (iOS 6, the default)
// nothing is drawn, watched or written.

export const LARGE_TITLE_H = 52;   // the large title's height when it can't be measured (style.css --large-title-h)

export const largeTitlesOn = (doc = globalThis.document) => doc?.documentElement?.getAttribute?.("data-nav") === "large";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fmt = (x) => String(+x.toFixed(3));

// How far the large title has gone into the bar: 0 shown in full (at the top or pulled down), 1 gone, from the
// scroller's offset and the title's height.
export function collapseOf(scrollTop, height = LARGE_TITLE_H) {
  if (!(height > 0)) return 1;
  return clamp01(scrollTop / height);
}

// One frame's styles: the large title's opacity and the bar title's. The bar title starts to show only once the
// large title is more than half under the bar, and is in full when it has gone.
export function collapseStyle(scrollTop, height = LARGE_TITLE_H) {
  const p = collapseOf(scrollTop, height);
  return { large: { opacity: fmt(1 - p) }, bar: { opacity: fmt(clamp01((p - 0.5) * 2)) } };
}

// Draws the large title of the page whose body is `body` and nav item `item`, and keeps it in step: put back at the
// top when the screen draws its body again, retitled when the bar's title changes, collapsed as the body scrolls.
// Returns { el, update(), destroy() }; update() applies the current scroll at once (a test, a resize). null for a
// page whose title is a control (F127's titleView) or that has no title.
export function attachLargeTitle(body, item, doc = globalThis.document) {
  const barTitle = () => item?.querySelector(".nav-title") ?? null;
  const h1 = barTitle();
  if (!body || !h1 || h1.classList.contains("nav-title-view")) return null;
  const el = doc.createElement("div");
  el.className = "large-title";
  el.setAttribute("aria-hidden", "true"); // the bar's h1 stays the page's heading
  el.textContent = h1.textContent;
  body.prepend(el);

  let height = 0;     // measured on the first frame after attaching or a resize, never per frame
  let last = null;    // the styles last written
  let frame = 0;
  let bar = h1;
  const write = (node, prop, v, was) => { if (node && v !== was) node.style[prop] = v; };
  const update = () => {
    frame = 0;
    if (!height) height = el.offsetHeight || LARGE_TITLE_H;
    const s = collapseStyle(body.scrollTop || 0, height);
    write(el, "opacity", s.large.opacity, last?.large.opacity);
    write(bar, "opacity", s.bar.opacity, last?.bar.opacity);
    last = s;
  };
  const raf = globalThis.requestAnimationFrame;
  const onScroll = () => { if (!frame) frame = raf ? raf(update) : (update(), 0); };
  const onResize = () => { height = 0; onScroll(); };
  body.addEventListener("scroll", onScroll, { passive: true });
  globalThis.addEventListener?.("resize", onResize);

  // The screen drew its body again (replaceChildren took the title out), or the page was retitled / redrawn.
  const keep = () => {
    if (body.firstElementChild !== el) body.prepend(el);
    const now = barTitle();
    if (now && now.classList.contains("nav-title-view")) { el.hidden = true; return; }
    el.hidden = false;
    if (now && el.textContent !== now.textContent) el.textContent = now.textContent;
    if (now !== bar) { bar = now; last = null; update(); }
  };
  const MO = globalThis.MutationObserver;
  const watchers = MO ? [new MO(keep), new MO(keep)] : [];
  watchers[0]?.observe(body, { childList: true });
  watchers[1]?.observe(item, { childList: true, subtree: true, characterData: true });

  update();
  return {
    el, update, keep,
    destroy() {
      for (const w of watchers) w.disconnect();
      body.removeEventListener("scroll", onScroll);
      globalThis.removeEventListener?.("resize", onResize);
      if (frame) globalThis.cancelAnimationFrame?.(frame);
      el.remove();
      if (bar) bar.style.opacity = "";
    },
  };
}

// The era turns the hook on or off. On, every tab's root page (the first .page of each #screens .tab-stack) gets
// its large title, and root pages made later get theirs as they are added; off takes them all away again and leaves
// the bar titles as iOS 6 draws them.
let largeState = null; // { doc, stackWatch, pages: Map(body -> attached) } while on

export function setLargeTitles(on, doc = globalThis.document) {
  const root = doc?.documentElement;
  if (!root) return;
  if (!on) {
    root.removeAttribute("data-nav");
    if (!largeState) return;
    largeState.stackWatch?.disconnect();
    for (const a of largeState.pages.values()) a?.destroy();
    largeState = null;
    return;
  }
  root.setAttribute("data-nav", "large");
  if (largeState) return;
  const state = { doc, stackWatch: null, pages: new Map() };
  largeState = state;
  const scan = () => {
    for (const stack of doc.querySelectorAll(".tab-stack")) {
      const page = stack.firstElementChild;
      const body = page?.querySelector(":scope > .page-body");
      if (!body || state.pages.has(body)) continue;
      state.pages.set(body, attachLargeTitle(body, navItemOf(body), doc));
    }
    for (const [body, a] of state.pages) if (!body.isConnected) { a?.destroy(); state.pages.delete(body); }
  };
  const MO = globalThis.MutationObserver;
  if (MO) {
    // Pages added to a stack, and stacks added to #screens (each watched once, MutationObserver dedupes targets).
    const watch = () => {
      const stacks = doc.querySelectorAll(".tab-stack");
      for (const stack of stacks) state.stackWatch.observe(stack, { childList: true });
      for (const host of new Set([...stacks].map((s) => s.parentNode).concat(doc.getElementById?.("screens")))) {
        if (host) state.stackWatch.observe(host, { childList: true });
      }
    };
    state.stackWatch = new MO(() => { watch(); scan(); });
    watch();
  }
  scan();
}
