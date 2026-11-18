// F150: Cydia's reload bar. While sources refresh, a dark translucent strip drops down from the top like the
// notification banner (nav/banner.js), with a small white spinner at its left, a line saying what is happening
// (core/reloadsteps.js) and a blue Cancel at its right. It blocks nothing: there is no scrim, only the strip itself
// takes touches, and the nav bar and the screens move down by its height (ios6.css html.has-reload) so it covers
// no buttons. It slides back up when hidden. Only transform animates.
//
//   const bar = showReloadBar("Updating Sources", { onCancel: () => stop() });
//   bar.set("Loading Data");  bar.hide();   // hide() waits until the last step has had its time
//
// F179: only Cydia's few general steps ever show (core/reloadsteps.js STEP_TEXT): any other text is dropped, and
// "Downloading <anything>" shows as "Downloading Packages", so no source name, URL or count reaches the strip. Each
// step stays up at least `minMs` (0.6 s) even when the work is faster: later steps queue behind it, and hide()
// lets the queue play out before the bar slides away. Cancel, or a new bar, takes it away at once.
//
// One bar at a time: showing another takes the first away at once. `doc` and `clock` are for the tests.

import { STEP_TEXT } from "../core/reloadsteps.js";

export const PHASES = Object.freeze(Object.values(STEP_TEXT));
export const MIN_STEP_MS = 600;

// The fixed step a text stands for, or null for a text that is none of them.
export function phaseOf(text) {
  const t = String(text ?? "").trim();
  if (PHASES.includes(t)) return t;
  if (/^Downloading\b/.test(t)) return STEP_TEXT.download;
  return null;
}

const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) };

let current = null;

export function showReloadBar(text = "", { onCancel = null, doc = globalThis.document, minMs = MIN_STEP_MS, clock = realClock } = {}) {
  current?.dismiss();
  if (!doc?.createElement) return { set() {}, hide() {}, dismiss() {}, el: null, get hidden() { return true; } };
  const bar = doc.createElement("div");
  bar.className = "reload-bar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = '<span class="reload-spinner" aria-hidden="true"></span>' // F166: UIKit's white spinner (ios6.css)
    + '<span class="reload-text"></span>';
  const label = bar.querySelector?.(".reload-text") ?? null;
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "bar-button done reload-cancel";
  cancel.textContent = "Cancel";
  bar.append(cancel);

  let hidden = false;   // hide() was asked: the run is over, set() changes nothing more
  let gone = false;     // the strip has started sliding away
  let shown = null;     // the step on screen
  let shownAt = -Infinity;
  const queue = [];     // steps waiting for the one on screen to have had its time
  let timer = null;
  const root = doc.documentElement;

  const show = (t) => { shown = t; shownAt = clock.now(); if (label) label.textContent = t; };
  const slide = () => {
    if (gone) return;
    gone = true;
    hidden = true;
    queue.length = 0;
    if (timer != null) { clock.clearTimeout(timer); timer = null; }
    if (current === handle) current = null;
    root?.classList?.remove("has-reload");
    const a = bar.animate?.([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
    if (a?.finished) a.finished.then(() => bar.remove(), () => bar.remove());
    else bar.remove();
  };
  // Shows what waits once the step on screen has had minMs, then slides away if hide() was asked.
  const pump = () => {
    timer = null;
    if (gone) return;
    const left = shownAt + minMs - clock.now();
    if (left > 0 && (queue.length || hidden)) { timer = clock.setTimeout(pump, left); return; }
    if (queue.length) { show(queue.shift()); if (queue.length || hidden) timer = clock.setTimeout(pump, minMs); return; }
    if (hidden) slide();
  };
  const handle = {
    el: bar,
    get hidden() { return hidden; },
    set(t) {
      if (hidden) return;
      const p = phaseOf(t);
      if (!p || p === (queue.at(-1) ?? shown)) return;
      queue.push(p);
      if (timer == null) pump();
    },
    hide() {
      if (hidden) return;
      hidden = true;
      if (timer == null) pump();
    },
    dismiss: slide,
  };
  cancel.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    if (gone) return;
    const asked = hidden;
    slide();
    if (!asked) onCancel?.();
  });
  handle.set(text);
  doc.body.append(bar);
  bar.animate?.([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" });
  root?.classList?.add("has-reload");
  current = handle;
  return handle;
}
