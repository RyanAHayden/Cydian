// UIActivityViewController as iOS 6 draws it on the iPhone (F76; the Teehan+Lax kit's "Share" layer, sheet.svg
// x 131-771 y 2104-2938): a translucent black panel slides up over the dimmed screen, a grid of 57 pt rounded-square
// icons three to a row (pitch 100 x 101 pt) with white bold 12 pt labels under them, nine to a page (more pages
// swipe sideways, with page dots), and a wide black Cancel button at the bottom. Styles: ios6.css (.share-*).
// Slides and fades by transform and opacity only.
//
//   const i = await showShareSheet({ items: [
//     { label: "Copy Link", glyph: "copy", onSelect: () => … },          // a system activity: white glyph, grey rim
//     { label: "Sileo", letter: "S", color: "#6a5bd8", onSelect: … },    // an app: its initial on its colour,
//     { label: "Sileo", image: "data:image/png;…", onSelect: … },        // or its icon (app-icons.js, a data: URL)
//   ] });
//   // i: the tapped item's index (its onSelect has run), or -1 for Cancel, a tap on the dim or Escape
//
// The nav bar's Share button (the iOS 6 action icon, drawn in CSS): setShare(body, () => …) from a screen's render,
// once it knows what to share, puts it left of the page's own right button; setShare(body, null) hides it.
// All text goes in through textContent.

import { el } from "./ui.js";
import { EASE, DURATION } from "./motion.js";
import { navItemOf } from "./navbar.js";

const PER_PAGE = 9;

const GLYPHS = {
  // UIActivityCopy's shape, redrawn: a page with a folded corner and a plus.
  copy: '<path d="M8 3h13l7 7v19H8z" fill="currentColor"/><path d="M21 3v7h7" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>' +
    '<path d="M16.5 14h3v4.5H24v3h-4.5V26h-3v-4.5H12v-3h4.5z" fill="#000" fill-opacity=".45"/>',
  // A QR code's three finder squares and a few modules.
  qr: '<g fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4.2" y="4.2" width="9.6" height="9.6"/><rect x="22.2" y="4.2" width="9.6" height="9.6"/>' +
    '<rect x="4.2" y="22.2" width="9.6" height="9.6"/></g><g fill="currentColor"><rect x="7.5" y="7.5" width="3" height="3"/>' +
    '<rect x="25.5" y="7.5" width="3" height="3"/><rect x="7.5" y="25.5" width="3" height="3"/><rect x="17" y="4" width="3" height="3"/>' +
    '<rect x="17" y="10" width="3" height="5"/><rect x="21" y="17" width="4" height="3"/><rect x="28" y="17" width="4" height="4"/>' +
    '<rect x="17" y="21" width="4" height="4"/><rect x="24" y="24" width="3" height="3"/><rect x="29" y="27" width="3" height="5"/>' +
    '<rect x="21" y="29" width="5" height="3"/><rect x="4" y="17" width="5" height="3"/><rect x="11" y="17" width="3" height="3"/></g>',
};

function iconOf(item) {
  const box = el("span", "share-icon");
  if (item.glyph && GLYPHS[item.glyph]) {
    box.classList.add("system");
    box.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true">${GLYPHS[item.glyph]}</svg>`; // our own constant markup
  } else if (/^data:image\//.test(item.image ?? "")) {
    box.classList.add("app", "has-image");
    box.append(Object.assign(new Image(), { src: item.image, alt: "", className: "share-image" }));
  } else {
    box.classList.add("app");
    if (/^#[0-9a-f]{3,8}$/i.test(item.color ?? "")) box.style.setProperty("--share-tint", item.color);
    box.append(el("span", "share-letter", String(item.letter ?? item.label ?? "?").slice(0, 2)));
  }
  return box;
}

export function showShareSheet({ items = [], cancel = "Cancel", title = "Share" } = {}) {
  return new Promise((resolve) => {
    const scrim = el("div", "share-scrim");
    const dim = el("div", "share-dim"); // its own layer, so the dimming fades by opacity alone
    const sheet = el("div", "share-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", title);

    const pages = el("div", "share-pages");
    for (let p = 0; p < Math.max(1, Math.ceil(items.length / PER_PAGE)); p++) {
      const grid = el("div", "share-grid");
      items.slice(p * PER_PAGE, (p + 1) * PER_PAGE).forEach((item, j) => {
        const index = p * PER_PAGE + j;
        const b = el("button", "share-item");
        b.type = "button";
        b.append(iconOf(item), el("span", "share-label", item.label));
        b.addEventListener("click", (e) => { e.stopPropagation(); close(index); });
        grid.append(b);
      });
      pages.append(grid);
    }
    sheet.append(pages);

    // UIPageControl under the grid when there is more than one page.
    let dots = null;
    if (pages.children.length > 1) {
      dots = el("div", "share-dots");
      dots.setAttribute("aria-hidden", "true");
      for (let i = 0; i < pages.children.length; i++) dots.append(el("span", i ? "" : "on"));
      sheet.append(dots);
      pages.addEventListener("scroll", () => {
        const at = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
        [...dots.children].forEach((d, i) => d.classList.toggle("on", i === at));
      }, { passive: true });
    }

    const cancelButton = el("button", "share-cancel", cancel);
    cancelButton.type = "button";
    cancelButton.addEventListener("click", (e) => { e.stopPropagation(); close(-1); });
    sheet.append(cancelButton);
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, sheet);
    document.body.append(scrim);

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
    cancelButton.focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
      const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: EASE, fill: "forwards" });
      const end = () => scrim.remove();
      a.finished.then(end, end);
      // Run the item's action inside the tap (clipboard writes and app links need the user's gesture).
      if (index >= 0) {
        try { items[index]?.onSelect?.(); } catch (e) { console.error(e); }
      }
      resolve(index);
    }
  });
}

// ---- the nav bar's Share button ---------------------------------------------------------------------------------

const handlers = new WeakMap();

// open: called on a tap; null hides the button. The button goes in front of the page's own right button (Edit,
// Install), made on first use so no screen's nav() has to know about it.
export function setShare(body, open, label = "Share") {
  const right = navItemOf(body)?.querySelector(".nav-right");
  if (!right) return;
  let b = right.querySelector(".share-button");
  if (!b && !open) return;
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "bar-button bar-icon share-button";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", () => handlers.get(b)?.());
    right.prepend(b);
  }
  if (open) handlers.set(b, open);
  else handlers.delete(b);
  b.hidden = !open;
}
