// Pull to refresh, the classic way (Tweetie's): pulling a list down past its top shows an area attached to the top of
// the list, a down arrow at its left, bold "Pull down to refresh..." and "Last Updated: Today 3:14 PM" under it.
// Past TRIGGER points of pull the arrow turns over and the text reads "Release to refresh...". Letting go there runs
// the page's own refresh, exactly as its nav button does (the reload bar shows it), and holds the area open, as
// Tweetie and iOS 6's own pull did: the list slides to HOLD points below where it starts (never snaps), held there
// by transform, the arrow gives way to iOS 6's grey spinner and the text reads "Refreshing..." (Last Updated stays).
// When the refresh ends (its onRefresh promise has settled and nothing is refreshing any more: the ifizbox:refreshing
// count back at 0, no reload bar, the page's busy() false; refreshEnd() decides) the list slides back up, and only
// once the area is fully behind the top bar does it go back to the arrow and "Pull down to refresh...". Letting go
// earlier springs back and runs nothing; a pull while a refresh runs (or while the area is held) does nothing at all.
// States (pullTracker): idle -> pull -> armed -> (release) refreshing -> (refresh ended) closing -> (hidden) idle.
//
//   pullToRefresh(scroller, { onRefresh: () => refresh(ctx), busy: () => state.busy, settings });
//
// `scroller` is the element the list scrolls in: the .page-body, or the .search-results of a page with the pinned
// search bar (nav/searchbar.js pinned). Calling it again for the same scroller only takes the new options.
//
// The area is not inside the scroller: WebKit paints nothing of a scroller's content above its top, so an area placed
// there stayed blank in the rubber band (iPhone 7). It sits beside the scroller, over it, in a box clipped to where
// the list starts (.pull-clip), and moves by transform so its foot is always on the content's top edge: it covers
// exactly the gap the pull opens.
// Two ways a pull happens:
//  - native: iOS rubber-bands the scroller itself (scrollTop goes below 0); a passive scroll listener reads it.
//  - script: a browser without the rubber band (Chromium, Android) keeps scrollTop at 0. Then a finger pulling down at
//    the top moves the scroller's children by transform (rubber() damping) and they spring back on release.
// Holding the area open is a transform on the scroller's children too (a padding or inset would be layout). On the
// script path the children slide from the pull to HOLD. On the native path iOS's own bounce still runs after the lift
// (scrollTop climbs back to 0); while it does, the children are pushed down by whatever the bounce gives back under
// HOLD (bounceHold()), so the list's visible top runs down to HOLD and stops there as the bounce ends, without a jump.
// While held, the area rides with the list (HOLD - scrollTop), and children a redraw adds get the same transform.
// Either way only transform changes per frame, and every listener is passive: 120 Hz holds.
//
// The Last Updated time is settings.lastRefresh (core/settings.js): set when a source refresh ends (the
// ifizbox:refreshing count from screens/sources.js falls back to 0: Sources' Refresh, Home's Reload, the launch
// refresh) and by Changes' Refresh, which refreshes without that count.

import { haptic, hapticTick, bridgeHaptics } from "./haptic.js";

export const TRIGGER = 60;  // points of pull where it arms (the 4S's Twitter: about the area's own height)
export const AREA_H = 480;   // the area is this tall, its contents at its foot, so a long pull still shows its colour
export const HOLD = 60;      // while refreshing, the list is held this far down: the area's foot (.pull-inner) shows whole
const DECIDE = 10;           // px of finger travel at the top before a browser without the rubber band is assumed
const SPRING_MS = 340;
export const MIN_HOLD_MS = 600;     // the spinner shows at least this long, and a refresh gets this long to announce itself
export const MAX_HOLD_MS = 120000;  // a refresh that never says it ended can't hold the area open for ever
const CHECK_MS = 250;               // how often a held area asks busy() (pages' own busy flags send no event)

// ---- The logic, without the DOM (pullrefresh.test.js) ----------------------------------------------------------

// While pulling: "idle" (nothing pulled, or a refresh runs), "pull" (under the trigger) or "armed" (release runs the
// refresh). pullTracker adds "refreshing" and "closing" after an armed release.
export function pullState(pull, { busy = false, threshold = TRIGGER } = {}) {
  if (busy || !(pull > 0)) return "idle";
  return pull >= threshold ? "armed" : "pull";
}

// UIScrollView's rubber band: the farther the finger goes, the less the list follows. `dim` is the scroller's height.
export function rubber(dy, dim = AREA_H) {
  if (!(dy > 0)) return 0;
  return (1 - 1 / (dy * 0.55 / dim + 1)) * dim;
}

// One gesture's decisions: start() on touch-down, move(pull) as the list moves, end() on lift. end() runs onRefresh
// (and returns true) only when the pull is armed at the lift and no refresh was running at the start or runs now;
// the state is then "refreshing" (area held open, spinner) until done() (the refresh ended: "closing", the list slides
// back up) and hidden() (the area is behind the top bar: "idle", the arrow and "Pull down to refresh..." again).
// A gesture that starts while held is blocked: it never arms and never changes the state.
// B197: onHaptic("tick") each time the pull arms (the arrow turns over), onHaptic("tap") when a release starts the
// refresh; nothing on a release that runs nothing.
export function pullTracker({ threshold = TRIGGER, busy = () => false, onRefresh = () => {}, onState = () => {},
  onHaptic = () => {} } = {}) {
  let state = "idle";
  let active = false;
  let blocked = false;
  const buzz = (kind) => { try { onHaptic(kind); } catch { /* a haptic never stops the pull */ } };
  const set = (s) => {
    if (s === state) return;
    state = s;
    if (s === "armed") buzz("tick");
    else if (s === "refreshing") buzz("tap");
    onState(s);
  };
  const held = () => state === "refreshing" || state === "closing";
  return {
    get state() { return state; },
    get active() { return active; },
    get blocked() { return blocked; },
    get held() { return held(); },
    start() { active = true; blocked = held() || Boolean(busy()); if (!held()) set("idle"); },
    move(pull) { if (active && !blocked) set(pullState(pull, { threshold })); },
    end() {
      if (!active) return false;
      active = false;
      if (held()) return false;
      const go = !blocked && state === "armed" && !busy();
      set(go ? "refreshing" : "idle");
      if (go) onRefresh();
      return go;
    },
    done() { if (state === "refreshing") set("closing"); },
    hidden() { if (state === "closing") set("idle"); },
    cancel() { active = false; if (!held()) set("idle"); },
  };
}

// Native path, after an armed release: how far the list's children are pushed down while iOS's bounce brings
// scrollTop (`top`, under 0 while it bounces) back to 0. The list's visible top is then max(-top, HOLD): it follows
// the bounce down to HOLD and stops there. Never shrinks (`hold` is what it is now).
export function bounceHold(hold, top, h = HOLD) {
  if (!(top < 0)) return h;
  return Math.min(h, Math.max(hold, h + top));
}

// Calls onEnd() once the refresh a release started has ended: `result` (onRefresh's return, a promise for Changes and
// Sources) has settled, busy() is false, and at least minMs has gone by (Home's Reload button says it's busy only once
// its click has run, and the spinner should be seen). Checked when the promise settles, on ifizbox:refreshing, and
// every CHECK_MS; after maxMs it ends anyway. -> stop(), which cancels it without calling onEnd.
export function refreshEnd(result, { busy = () => false, onEnd = () => {}, minMs = MIN_HOLD_MS, maxMs = MAX_HOLD_MS,
  timers = globalThis, now = () => Date.now(), target = globalThis } = {}) {
  const t0 = now();
  let settled = false;
  let over = false;
  const stop = () => {
    if (over) return;
    over = true;
    timers.clearInterval(poll);
    timers.clearTimeout(cap);
    timers.clearTimeout(soon);
    target.removeEventListener?.("ifizbox:refreshing", check);
  };
  const finish = () => { if (!over) { stop(); onEnd(); } };
  function check() {
    if (over || !settled || now() - t0 < minMs) return;
    let b = true;
    try { b = Boolean(busy()); } catch { b = false; }
    if (!b) finish();
  }
  const poll = timers.setInterval(check, CHECK_MS);
  const cap = timers.setTimeout(finish, maxMs);
  const soon = timers.setTimeout(check, minMs);
  target.addEventListener?.("ifizbox:refreshing", check);
  Promise.resolve(result).then(() => {}, () => {}).then(() => { settled = true; check(); });
  return stop;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (d) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// "Last Updated: Today 3:14 PM", "Yesterday 9:05 AM", "Nov 3 3:14 PM" (another year: "Nov 3, 2025"), "Never".
export function lastUpdatedText(ms, now = new Date()) {
  if (!(ms > 0)) return "Last Updated: Never";
  const d = new Date(ms);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  let day;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Yesterday";
  else if (d.getFullYear() === now.getFullYear()) day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  else return `Last Updated: ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `Last Updated: ${day} ${clock(d)}`;
}

export const TEXT = Object.freeze({ pull: "Pull down to refresh...", armed: "Release to refresh...", refreshing: "Refreshing..." });

// The title line for a pullTracker state: "Refreshing..." stays up while the list slides back ("closing").
export function titleFor(state) {
  if (state === "refreshing" || state === "closing") return TEXT.refreshing;
  return state === "armed" ? TEXT.armed : TEXT.pull;
}

// B197: pull to refresh's haptics, only where the app's bridge plays them (as screens/roulette.js): a pull arms in a
// scroll event, not a gesture start, where Safari's fallbacks stay silent. "tick" is the smallest there is
// (haptic.tick), "tap" the regular light one (haptic.tap).
export function pullHaptic(kind, { bridge = bridgeHaptics, tick = hapticTick, tap = haptic } = {}) {
  if (!bridge()) return;
  if (kind === "tick") tick();
  else if (kind === "tap") tap();
}

// ---- Last Updated bookkeeping ----------------------------------------------------------------------------------

let watching = null;
function watchRefreshes(settings) {
  if (watching || !settings?.lastRefresh || typeof globalThis.addEventListener !== "function") return;
  watching = settings;
  let was = globalThis.ifizboxRefreshing > 0;
  globalThis.addEventListener("ifizbox:refreshing", () => {
    const now = globalThis.ifizboxRefreshing > 0;
    if (was && !now) settings.lastRefresh.set(Date.now());
    was = now;
  });
}

// A refresh is running somewhere: the Sources count (screens/sources.js announce) or the reload bar is up.
export function refreshRunning(doc = globalThis.document) {
  return globalThis.ifizboxRefreshing > 0 || Boolean(doc?.documentElement?.classList?.contains("has-reload"));
}

// ---- The DOM side --------------------------------------------------------------------------------------------

const attached = new WeakMap(); // scroller -> its options (live: a second call replaces them)
// This browser rubber-bands its scrollers (never move them by script): iOS's WebKit (the only one with
// -webkit-touch-callout), or any browser seen taking a scroller below 0.
let nativeBounce = Boolean(globalThis.CSS?.supports?.("-webkit-touch-callout: none"));

export function pullToRefresh(scroller, opts = {}) {
  if (!scroller?.addEventListener || typeof document === "undefined") return null;
  watchRefreshes(opts.settings);
  const known = attached.get(scroller);
  if (known) { Object.assign(known, opts); return known; }
  const o = { ...opts };
  attached.set(scroller, o);

  const clip = document.createElement("div");
  clip.className = "pull-clip";
  clip.setAttribute("aria-hidden", "true");
  clip.innerHTML = '<div class="pull-refresh"><div class="pull-inner"><span class="pull-arrow"></span>'
    + '<span class="pull-spinner"></span>'
    + '<span class="pull-text"><b class="pull-title"></b><span class="pull-time"></span></span></div></div>';
  const area = clip.querySelector(".pull-refresh");
  const title = area.querySelector(".pull-title");
  const time = area.querySelector(".pull-time");
  title.textContent = TEXT.pull;

  const busy = () => refreshRunning() || Boolean(o.busy?.());
  let pending = 0; // a release's refresh waiting for the spring back to end
  let stopWatch = null; // refreshEnd()'s stop, while a held area waits for its refresh to end
  const runNow = () => {
    clearTimeout(pending);
    pending = 0;
    const result = Promise.resolve().then(() => o.onRefresh?.()); // after the lift's own work
    result.catch(() => {});
    stopWatch?.();
    stopWatch = refreshEnd(result, { busy, onEnd: () => { stopWatch = null; tracker.done(); } });
  };
  const tracker = pullTracker({
    busy,
    onHaptic: (kind) => pullHaptic(kind),
    onRefresh: () => {
      // Once the list is back at its top: iOS's own spring still runs after the lift, and a refresh that put Sources'
      // strip up mid-spring left the list scrolled down by the strip's height (iPhone 7).
      if (scroller.scrollTop < 0) { pending = setTimeout(runNow, 900); return; }
      runNow();
    },
    onState: (s) => {
      // "armed" goes before "refreshing" comes: the arrow is hidden (and its turn not animated) when it turns back.
      area.classList.toggle("armed", s === "armed");
      area.classList.toggle("refreshing", s === "refreshing" || s === "closing");
      title.textContent = titleFor(s);
      if (s === "closing") close();
    },
  });

  // Puts the clip box back beside the scroller (a redraw that empties the page takes it away) over the list's box,
  // from where its content starts. Layout is read here, once per touch at the top, never per frame.
  const ensure = () => {
    if (clip.parentNode !== scroller.parentNode || clip.previousSibling !== scroller) scroller.after(clip);
    const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    clip.style.top = `${scroller.offsetTop + pad}px`;
    clip.style.height = `${Math.max(0, scroller.clientHeight - pad)}px`;
    // The area wears the page's own background: white on a plain list, the pinstripe on a grouped page (ios6.css).
    clip.classList.toggle("grouped", scroller.classList.contains("grouped"));
    time.textContent = lastUpdatedText(o.settings?.lastRefresh?.get?.() ?? null);
  };
  const show = (on) => clip.classList.toggle("on", on);
  const k = () => globalThis.devicePixelRatio || 1; // whole device pixels: a fractional offset smeared the rows' edges
  const px = (v) => Math.round(v * k()) / k();
  // The area's foot on the content's top edge, `pull` below where the list starts.
  const follow = (pull) => { area.style.transform = `translateY(${px(Math.max(0, pull)) - AREA_H}px)`; };

  // The script way: the scroller's children follow the finger by transform, and the area with them.
  let g = null; // the gesture: { y, base, mode: "?" | "native" | "script", pull }
  const moved = () => [...scroller.children];
  const place = (pull) => {
    const t = pull > 0 ? `translateY(${px(pull)}px)` : "";
    for (const c of moved()) c.style.transform = t;
    follow(pull);
  };
  const springBack = (from) => {
    place(0);
    if (!(from > 0)) { show(false); return; }
    const opts = { duration: SPRING_MS, easing: "cubic-bezier(.25,.6,.3,1)" };
    for (const c of moved()) c.animate?.([{ transform: `translateY(${px(from)}px)` }, { transform: "none" }], opts);
    const last = area.animate?.([{ transform: `translateY(${px(from) - AREA_H}px)` }, { transform: `translateY(${-AREA_H}px)` }], opts);
    if (last?.finished) last.finished.then(() => { if (!g) show(false); }, () => {});
    else show(false);
  };
  const release = () => { if (g?.mode === "script") scroller.style.overflowY = ""; };

  // Holding the area open while the refresh runs: the children `hold` px down by transform, the area riding with them.
  let hold = 0;
  let bouncing = false; // native: iOS's bounce after the release still runs, and the hold follows it (bounceHold)
  let mo = null;        // while held: children a redraw adds get the hold too
  const holdT = (v) => (v > 0 ? `translateY(${px(v)}px)` : "none");
  const setHold = (v) => {
    hold = Math.max(0, v);
    const t = hold > 0 ? holdT(hold) : "";
    for (const c of moved()) c.style.transform = t;
    if (hold > 0 && !mo && typeof MutationObserver === "function") {
      mo = new MutationObserver(() => { const t = holdT(hold); for (const c of moved()) if (c.style.transform !== t) c.style.transform = t; });
      mo.observe(scroller, { childList: true });
    } else if (!(hold > 0) && mo) { mo.disconnect(); mo = null; }
  };
  const areaAt = () => follow(hold - scroller.scrollTop);
  const slideHold = (from, to, ms = SPRING_MS) => {
    setHold(to);
    areaAt();
    const opts = { duration: ms, easing: "cubic-bezier(.25,.6,.3,1)" };
    for (const c of moved()) c.animate?.([{ transform: holdT(from) }, { transform: holdT(to) }], opts);
    const top = scroller.scrollTop;
    const at = (v) => `translateY(${px(Math.max(0, v - top)) - AREA_H}px)`;
    return area.animate?.([{ transform: at(from) }, { transform: at(to) }], opts);
  };
  // An armed release: the list goes to HOLD and stays there, the spinner turning (tracker state "refreshing").
  const holdOpen = (was) => {
    show(true);
    if (was.mode === "script") { slideHold(was.pull, HOLD); return; }
    const top = scroller.scrollTop;
    if (top >= 0) { slideHold(0, HOLD); return; } // the bounce was already over
    bouncing = true;
    setHold(bounceHold(0, top));
    areaAt();
    setTimeout(() => { if (bouncing && scroller.scrollTop >= 0) settleBounce(); }, 900); // in case no last scroll event comes
  };
  // The bounce is over: whatever the last scroll event left under HOLD slides the rest of the way, it doesn't jump.
  const settleBounce = () => {
    bouncing = false;
    if (hold < HOLD - 4) slideHold(hold, HOLD, 150);
    else { setHold(HOLD); areaAt(); }
  };
  // The refresh ended (state "closing"): the list slides back up; once the area is behind the bar, back to the arrow.
  const close = () => {
    bouncing = false;
    const from = hold;
    const top = scroller.scrollTop;
    const reset = () => { if (!g) show(false); tracker.hidden(); };
    if (!(from > 0)) { reset(); return; }
    if (top >= from) { setHold(0); scroller.scrollTop = top - from; reset(); return; } // already hidden: nothing moves
    const a = slideHold(from, 0);
    if (a?.finished) a.finished.then(reset, reset);
    else reset();
  };

  scroller.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) {
      if (g) { tracker.cancel(); release(); if (!tracker.held && !(hold > 0)) springBack(g.pull); g = null; }
      return;
    }
    const y = e.touches[0].clientY;
    const top = scroller.scrollTop;
    g = { y, base: top <= 0 ? y : null, mode: nativeBounce ? "native" : "?", pull: 0, ready: false };
    if (top <= 1) { ensure(); g.ready = true; } // style is read here, never per frame
    tracker.start();
    if (top < 0 && !tracker.blocked) { follow(-top); show(true); } // caught while springing back
  }, { passive: true });

  scroller.addEventListener("touchmove", (e) => {
    if (!g || g.mode === "native" || tracker.blocked) return;
    const y = e.touches[0]?.clientY;
    if (y == null) return;
    if (scroller.scrollTop < 0) { g.mode = "native"; nativeBounce = true; place(0); return; }
    if (g.mode === "?") {
      if (scroller.scrollTop > 0) { g.base = null; return; }
      g.base ??= y;
      const dy = y - g.base;
      if (dy < 0) { g.base = y; return; }
      if (dy < DECIDE) return;
      g.mode = "script";
      g.base += DECIDE; // the pull starts from here, without a jump
      if (!g.ready) { ensure(); g.ready = true; }
      scroller.style.overflowY = "hidden"; // the browser pans nothing while the list is pulled by hand
    }
    if (y <= g.base) { // pushed back past the start: an ordinary scroll again
      release(); g.mode = "?"; g.base = y; g.pull = 0;
      place(0); show(false); tracker.move(0);
      return;
    }
    g.pull = rubber(y - g.base, scroller.clientHeight || AREA_H);
    show(g.pull > 0 && !tracker.blocked);
    place(g.pull);
    tracker.move(g.pull);
  }, { passive: true });

  // The native way: scrollTop under 0 is the rubber band.
  scroller.addEventListener("scroll", () => {
    const top = scroller.scrollTop;
    if (bouncing) {
      if (top >= 0) settleBounce();
      else { const h = bounceHold(hold, top); if (h !== hold) setHold(h); }
    }
    if (hold > 0 || bouncing) { // held open: the area rides with the list
      areaAt();
      show(true);
      if (top >= 0 && pending) runNow();
      return;
    }
    if (top < 0) {
      nativeBounce = true;
      if (g?.mode === "script") return;
      if (g) {
        if (!g.ready) { ensure(); g.ready = true; } // scrolled up to the top and on past it in one gesture
        g.mode = "native"; g.pull = -top; tracker.move(-top);
      } else if (clip.parentNode !== scroller.parentNode) ensure(); // a fling's overshoot
      follow(-top);
      show(!(g ? tracker.blocked : busy()));
    } else {
      if (!g || g.mode === "native") show(false);
      if (pending) runNow(); // the spring is over
    }
  }, { passive: true });

  const end = (e) => {
    if (!g) return;
    const was = g;
    let went = false;
    if (e.type === "touchcancel") tracker.cancel();
    else went = tracker.end();
    release();
    g = null;
    if (went) holdOpen(was);
    else if (tracker.held || hold > 0 || bouncing) return; // a blocked touch while held: the area stays as it is
    else if (was.mode === "script") springBack(was.pull);
    else if (scroller.scrollTop >= 0) show(false); // native: the scroll listener hides it once it's back
  };
  scroller.addEventListener("touchend", end, { passive: true });
  scroller.addEventListener("touchcancel", end, { passive: true });
  return o;
}
