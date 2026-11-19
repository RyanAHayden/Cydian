// iOS 6's notification banner: a dark glossy strip with the app's icon, a bold title and a line of text. F204: it no
// longer pushes the page down. It sits right under the nav bar (ios6.css .banner: top = --nav-h), below it in z-order,
// and slides out from behind it over the top of the page, so it never covers the nav bar or the status bar and
// nothing on the page moves. With a sheet open it goes inside the top sheet, under that sheet's own nav bar.
//
//   showBanner({ title: "iFizBox", message: "Wi-Fi is off." })            // goes by itself after 5 s
//   showBanner({ message: "Press Open to import your settings.", wait: true })  // stays until the user is back
//
// It goes by itself after AUTO_MS (5 s), ACTION_MS (8 s) with an action button, or `duration` ms when given; a 2 pt
// line along its bottom runs out meanwhile. Touching it pauses the timer; a tap or a swipe up dismisses it.
// `wait: true` is for banners that tell the user which button to press in an iOS prompt iFizBox can't word itself
// (Safari's "Open in iFizBox?", "… would like to install …"): no timer, it stays until it is tapped or the page
// comes back after the user was away (they answered iOS). Every banner also goes when the page comes back.
import { detectMode } from "../core/settings.js";
import { NAME } from "../brand.js";

export const AUTO_MS = 5000;
export const ACTION_MS = 8000;
const EASE = "cubic-bezier(.25,.1,.25,1)";
const SWIPE_PX = 16;   // an upward drag past this dismisses; a move under TAP_PX is still a tap
const TAP_PX = 8;

export const MAX_WAITING = 3;  // banners queued behind the one up; more are dropped

// iFizBox's own icon for where it runs: WEB on the website, LITE in the sideload app, plain in the jailbreak app.
const ownIcon = () => (!globalThis.ifizboxNative ? "icons/icon-web-glossy-76.png"
  : detectMode() === "sideload" ? "icons/icon-lite-glossy-76.png" : "icons/icon-glossy-76.png");

// How long a banner stays up by itself: 0 for one that waits for iOS.
export function bannerTime({ duration, action = null, wait = false } = {}) {
  if (wait) return 0;
  if (duration > 0) return duration;
  return action ? ACTION_MS : AUTO_MS;
}

// Where the banner goes: inside the top sheet when one is open (under its nav bar), else the page.
function host(doc) {
  const sheets = doc.querySelectorAll?.(".sheet") ?? [];
  return sheets.length ? sheets[sheets.length - 1] : doc.body;
}

// B62: one banner is up at a time, and the others wait their turn: a new banner no longer hides the one up (on launch
// the refresh-failure banner used to replace "iFizBox X is out." before its Upgrade could be tapped). The next one
// slides in once the current one has gone. A `wait` banner (Press Open / Press Install) can't wait: iOS's prompt is up
// now, so it goes up at once and a timed banner it pushed off comes back after it, with its full time. A banner with
// the same title and message as one up or waiting isn't added twice. `present(opts, gone)` draws one and returns its
// hide; it calls gone() once it has left. The returned function hides the banner, or takes it out of the queue.
export function bannerQueue(present, { max = MAX_WAITING } = {}) {
  let shown = null;
  const waiting = [];
  const same = (a, b) => a.title === b.title && a.message === b.message;
  const start = (e) => {
    shown = e;
    const run = (e.run = {});
    e.hide = present(e.opts, () => {
      if (shown !== e || e.run !== run) return;
      shown = null;
      const next = waiting.shift();
      if (next) start(next);
    });
  };
  const cancel = (e) => {
    const i = waiting.indexOf(e);
    if (i >= 0) waiting.splice(i, 1);
    if (shown === e) e.hide?.();
  };
  const show = (opts) => {
    const twin = [shown, ...waiting].find((x) => x && same(x.opts, opts));
    if (twin) return () => cancel(twin);
    const e = { opts, hide: null, run: null };
    if (!shown) start(e);
    else if (opts.wait) {
      // Up at once; the one pushed off slides out meanwhile (its gone() is ignored: it is no longer `shown`).
      const off = shown;
      if (!off.opts.wait) waiting.unshift(off);
      start(e);
      off.hide();
    } else if (waiting.length < max) waiting.push(e);
    else return () => {};
    return () => cancel(e);
  };
  show.state = () => ({ shown: shown?.opts ?? null, waiting: waiting.map((x) => x.opts) });
  return show;
}

let queue = null;
export function showBanner(opts = {}) {
  queue ??= bannerQueue(present);
  return queue({ title: NAME, ...opts });
}

// `action`: { label, onClick } puts a small blue button at the banner's right (Upgrade); a tap on it runs onClick.
// `onTap` (B23): a tap on the banner hides it and runs onTap (the refresh-failure banner opens Sources).
function present({ title = NAME, message = "", icon = ownIcon(), duration = 0, action = null, onTap = null, wait = false } = {}, onLeft = () => {}) {
  const b = document.createElement("div");
  b.className = "banner";
  b.setAttribute("role", "status");
  b.setAttribute("aria-live", "polite");
  const img = Object.assign(document.createElement("img"), { className: "banner-icon", src: icon, alt: "" });
  const text = document.createElement("div");
  text.className = "banner-text";
  text.append(Object.assign(document.createElement("strong"), { textContent: title }),
    Object.assign(document.createElement("span"), { textContent: message }));
  b.append(img, text);
  if (action) {
    const btn = Object.assign(document.createElement("button"), { type: "button", className: "bar-button done banner-action", textContent: action.label });
    btn.addEventListener("click", (e) => { e.stopPropagation(); hide(); action.onClick?.(); });
    b.append(btn);
  }
  const ms = bannerTime({ duration, action, wait });
  const line = ms ? Object.assign(document.createElement("div"), { className: "banner-timer" }) : null;
  if (line) b.append(line);
  host(document).append(b);
  b.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 300, easing: EASE });

  let gone = false;
  // The line running out is the timer: pausing it pauses the banner, its end hides it.
  const timer = line?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: ms, easing: "linear", fill: "forwards" });
  timer?.finished.then(() => hide(), () => {});

  const hide = () => {
    if (gone) return;
    gone = true;
    document.removeEventListener("visibilitychange", onVis);
    timer?.cancel();
    const from = dragY < 0 ? `translateY(${dragY}px)` : "none";
    const a = b.animate([{ transform: from }, { transform: "translateY(-100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
    const left = () => { b.remove(); onLeft(); };
    a.finished.then(left, left);
  };

  // Touch: hold pauses the timer; a drag up follows the finger and, past SWIPE_PX, dismisses; else it springs back.
  let startY = null;
  let dragY = 0;
  let moved = false;
  b.addEventListener("pointerdown", (e) => {
    if (gone) return;
    startY = e.clientY;
    dragY = 0;
    moved = false;
    timer?.pause();
    b.setPointerCapture?.(e.pointerId);
  });
  b.addEventListener("pointermove", (e) => {
    if (startY == null || gone) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > TAP_PX) moved = true;
    dragY = Math.min(0, dy);
    b.style.transform = dragY ? `translateY(${dragY}px)` : "";
  });
  const release = () => {
    if (startY == null) return;
    startY = null;
    if (gone) return;
    if (dragY < -SWIPE_PX) { b.style.transform = ""; hide(); return; }
    if (dragY) b.animate([{ transform: `translateY(${dragY}px)` }, { transform: "none" }], { duration: 200, easing: EASE });
    dragY = 0;
    b.style.transform = "";
    timer?.play();
  };
  b.addEventListener("pointerup", release);
  b.addEventListener("pointercancel", () => { moved = true; release(); });
  b.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    hide();
    onTap?.();
  });

  // Back after leaving the page (the user pressed Open or Install and iOS took over): it has done its job.
  let away = false;
  const onVis = () => {
    if (document.visibilityState === "hidden") away = true;
    else if (away) hide();
  };
  document.addEventListener("visibilitychange", onVis);
  return hide;
}
