// F151: the install progress page, Cydia's Running/Complete screen made cleaner and more like a terminal
// (docs/cydia.md "Running: the console"; the brain is core/progress.js, the look progress.css):
//
//   const p = openProgress({ onCancel })   a black page over everything, "Running" in the black nav bar
//   p.line(kind, text)                     kind "step" (bold Helvetica Neue, white) | "raw" (monospace, grey)
//                                          | "error" (red, the x badge) | "warning" (yellow, the warning badge)
//   p.status(text) / p.progress(percent)   the status line and the bar at the bottom
//   p.cancellable(bool)                    Cancel at the top left (onCancel), while a step can be stopped
//   p.finish({ label, action, status })    "Complete": the big bottom button (drawn from the 4S's
//                                          UIAlertSheetBlackButton) and Close at the top right. action() runs on the
//                                          button; a truthy return keeps the page up. Close only closes.
//   p.reopen()                             "Running" again, for the next job of a run (progressHUD)
//   p.close() / p.closed / p.onClose(fn)
//
// Every line is selectable and copyable. The log follows the newest line and stops while the user scrolls up
// (core/progress.js createFollow); a "New Output" pill brings it back. Lines come in batched, one paint a frame.
//
//   progressHUD(label)                     the HUD interface ({ set, hide, done, fail }, nav/hud.js liveHUD's) on this
//                                          page: the sideload IPA's and the website's installs (signing-client.js),
//                                          each label a step, its percent on the bar; a job started while the page
//                                          is still up continues on it.
// SPDX-License-Identifier: GPL-3.0-or-later
import { el, barButton } from "./ui.js";
import { createFollow, hudLine } from "../core/progress.js";

const EASE = "cubic-bezier(.25,.1,.25,1)";
const MAX_LINES = 1500; // lines kept on screen while it follows; the callers' logs keep everything

export function openProgress({ title = "Running", onCancel = null } = {}) {
  const sheet = el("div", "sheet console progress-page");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);
  const bar = el("header", "navbar sheet-bar");
  const row = el("div", "sheet-bar-row");
  const left = el("div", "sheet-left");
  const h1 = el("h1", "nav-title", title);
  const right = el("div", "sheet-right");
  const cancel = barButton("Cancel");
  cancel.hidden = true;
  const close = barButton("Close");
  close.hidden = true;
  left.append(cancel);
  right.append(close);
  row.append(left, h1, right);
  bar.append(row);

  const body = el("div", "sheet-body progress-body");
  const scroll = el("div", "progress-scroll");
  const out = el("div", "progress-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  const cursor = el("span", "progress-cursor");
  cursor.setAttribute("aria-hidden", "true");
  scroll.append(out, cursor);
  const jump = el("button", "progress-jump", "New Output");
  jump.type = "button";
  jump.hidden = true;
  const foot = el("div", "progress-foot");
  const statusText = el("div", "progress-status", "Preparing");
  const track = el("div", "progress-track");
  const fill = el("div", "progress-fill");
  track.append(fill);
  const finishButton = el("button", "progress-finish");
  finishButton.type = "button";
  finishButton.hidden = true;
  foot.append(statusText, track, finishButton);
  body.append(scroll, jump, foot);
  sheet.append(bar, body);
  document.body.append(sheet);
  sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 350, easing: EASE });

  // ---- auto-scroll ----
  const follow = createFollow();
  const metrics = () => ({ top: scroll.scrollTop, height: scroll.scrollHeight, client: scroll.clientHeight });
  const toBottom = () => { scroll.scrollTop = scroll.scrollHeight; };
  scroll.addEventListener("scroll", () => {
    follow.scrolled(metrics());
    if (follow.following) jump.hidden = true;
  }, { passive: true });
  scroll.addEventListener("touchstart", () => follow.touch(true), { passive: true });
  const lift = () => follow.touch(false, metrics());
  scroll.addEventListener("touchend", lift, { passive: true });
  scroll.addEventListener("touchcancel", lift, { passive: true });
  jump.addEventListener("click", () => { follow.jump(); jump.hidden = true; toBottom(); });

  // ---- lines, one paint a frame ----
  let pending = [];
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (!pending.length) return;
    const frag = document.createDocumentFragment();
    for (const [kind, text] of pending) {
      const d = el("div", `pl pl-${kind}`, text);
      if (kind === "error" || kind === "warning") d.setAttribute("role", kind === "error" ? "alert" : "note");
      frag.append(d);
    }
    pending = [];
    out.append(frag);
    if (follow.shouldScroll()) {
      while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
      toBottom();
    } else if (!follow.following) jump.hidden = false;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };

  let closed = false;
  let finished = false;
  const closers = [];
  const setTitle = (t) => { h1.textContent = t; sheet.setAttribute("aria-label", t); };
  const setProgress = (pct) => { fill.style.transform = `scaleX(${Math.max(0, Math.min(100, Number(pct) || 0)) / 100})`; };
  setProgress(0);

  cancel.addEventListener("click", () => { if (!cancel.disabled && onCancel) onCancel(); });

  const page = {
    sheet, scroll, out,
    get closed() { return closed; },
    get finished() { return finished; },
    line(kind, text) {
      const t = String(text ?? "");
      if (!t || closed) return;
      pending.push([["step", "raw", "error", "warning"].includes(kind) ? kind : "raw", t]);
      schedule();
    },
    step(text) { page.line("step", text); },
    raw(text) { page.line("raw", text); },
    error(text) { page.line("error", text); },
    warning(text) { page.line("warning", text); },
    status(text) { statusText.textContent = String(text ?? ""); },
    progress: setProgress,
    setTitle,
    flush,
    cancellable(on, { disabled = false } = {}) { cancel.hidden = !on; cancel.disabled = Boolean(disabled); },
    finish({ label = "Return to Cydian", action = null, status = null, title: t = "Complete" } = {}) {
      flush();
      finished = true;
      setTitle(t);
      setProgress(100);
      if (status != null) statusText.textContent = status;
      cancel.hidden = true;
      cursor.hidden = true;
      track.hidden = true;
      finishButton.textContent = label;
      finishButton.hidden = false;
      finishButton.disabled = false;
      finishButton.onclick = async () => {
        if (finishButton.disabled) return;
        finishButton.disabled = true;
        let keep = false;
        try { keep = action ? await action() : false; } catch { keep = true; }
        finishButton.disabled = false;
        if (!keep) page.close();
      };
      close.hidden = false;
      if (follow.shouldScroll()) toBottom();
    },
    reopen({ title: t = "Running", status = "Preparing" } = {}) {
      finished = false;
      setTitle(t);
      statusText.textContent = status;
      setProgress(0);
      track.hidden = false;
      cursor.hidden = false;
      finishButton.hidden = true;
      close.hidden = true;
    },
    onClose(fn) { closers.push(fn); },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      if (frame) cancelAnimationFrame(frame);
      for (const f of closers.splice(0)) { try { f(); } catch { /* the page goes anyway */ } }
      const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 300, easing: EASE, fill: "forwards" });
      return a.finished.then(() => sheet.remove(), () => sheet.remove());
    },
  };
  close.addEventListener("click", () => page.close());
  return page;
}

// ---- the HUD interface on the page ------------------------------------------------------------------------------

let hudPage = null; // the page progressHUD drew last, while it is up

// `open` stands in for openProgress (tests).
export function progressHUD(label = "Preparing", { open = openProgress, done: doneLabel = "Return to Cydian" } = {}) {
  let page = hudPage && !hudPage.closed ? hudPage : null;
  if (page) page.reopen();
  else {
    page = open({ title: "Running" });
    hudPage = page;
    page.onClose?.(() => { if (hudPage === page) hudPage = null; });
  }
  let last = null;
  let ended = false;
  const set = (t) => {
    if (ended) return;
    const { text, percent } = hudLine(t);
    if (!text) return;
    if (text !== last) page.step(text);
    last = text;
    page.status(t);
    if (percent != null) page.progress(percent);
  };
  set(label);
  const end = (status) => {
    if (ended) return;
    ended = true;
    page.finish({ label: doneLabel, status });
  };
  return {
    set,
    // a job that ends without saying how (its alert says it): the page completes, Return under it
    hide: () => end(null),
    done: (t = "Done") => { if (!ended) { if (t !== last) page.step(t); last = t; } end(t); },
    fail: (message) => { if (!ended && message) page.error(message); end("Failed"); },
    page,
  };
}
