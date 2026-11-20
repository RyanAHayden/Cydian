// A modal sheet, as iOS 6 presents one (presentModalViewController): it slides up over everything with its own
// blue nav bar, a title and a Done button, and slides back down on Done or Escape. Transform only.
// Styles: packages.css (.sheet). The one sheet scaffold: the Confirm sheets (screens/queue.js modal), Write a Review
// (screens/reviews.js), the progress page (nav/progress.js) and the Install sheet (signing-sheet.js) are built on it.
//
//   const close = showSheet({ title: "Depiction", body: element, onClose });
//   close()                      slides it down, removes it, runs onClose; a promise that settles once it is gone
//                                (the same promise on every later call)
//   close.sheet / .h1 / .left / .right / .content   its nodes (.content is the .sheet-body the body goes in)
//   close.setTitle(t)            the title and the dialog's label
//   close.closed()               true once close() ran
//
// Options beyond title/body/onClose:
//   left                         a node (or array) at the left of the bar (empty by default)
//   right                        a node (or array) at the right in place of Done; null for nothing there
//   cls                          more classes on the .sheet ("confirm-sheet", "console progress-page")
//   bodyCls                      more classes on the .sheet-body
//   escape                       false: Escape does nothing (sheets whose close has more to do than slide down)
import { EASE, DURATION, SHEET_IN } from "./motion.js";

export function showSheet({ title = "", body = null, onClose = () => {}, left = null, right, cls = "", bodyCls = "", escape = true } = {}) {
  const doc = globalThis.document;
  const make = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };
  const put = (box, nodes) => { for (const n of [nodes].flat()) if (n) box.append(n); };

  const sheet = make("div", `sheet ${cls}`.trim());
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);

  const bar = make("header", "navbar sheet-bar");
  const h1 = make("h1", "nav-title", title);
  const l = make("div", "sheet-left");
  const r = make("div", "sheet-right");
  let done = null;
  if (right === undefined) {
    done = make("button", "bar-button done", "Done");
    done.type = "button";
    r.append(done);
  } else put(r, right);
  put(l, left);
  const row = make("div", "sheet-bar-row");
  row.append(l, h1, r);
  bar.append(row);

  const content = make("div", `sheet-body ${bodyCls}`.trim());
  put(content, body);
  sheet.append(bar, content);
  doc.body.append(sheet);

  sheet.animate?.([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: SHEET_IN, easing: EASE });

  let gone = null;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    if (gone) return gone;
    doc.removeEventListener?.("keydown", onKey);
    gone = new Promise((resolve) => {
      const end = () => {
        sheet.remove();
        try { onClose(); } finally { resolve(); }
      };
      const a = sheet.animate?.([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: DURATION, easing: EASE, fill: "forwards" });
      if (a?.finished) a.finished.then(end, end); else end();
    });
    return gone;
  }
  if (escape) doc.addEventListener?.("keydown", onKey);
  if (done) {
    done.addEventListener("click", () => close());
    done.focus?.({ preventScroll: true });
  }
  return Object.assign(close, {
    sheet, h1, left: l, right: r, content,
    setTitle(t) { h1.textContent = t; sheet.setAttribute("aria-label", t); },
    closed: () => gone !== null,
  });
}
