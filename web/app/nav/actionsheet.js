// UIActionSheet as iOS 6 draws it (F29; Cydia's Modify and Downgrade sheets, ref/4s/screens/cydia-package-modify.png
// and -downgrade.png): a translucent grey-blue panel slides up from the bottom over a dimmed screen, with a
// stack of white glossy buttons and a dark Cancel button below a wider gap. Styles: packages.css (.action-sheet),
// colours sampled from the 4S's UIAlertSheet* art. Slides by transform only.
//
//   const i = await showActionSheet({ title, buttons: ["Reinstall", "Remove"], destructive: 1 });
//   // i: the tapped button's index, or -1 for Cancel (also a tap on the dimmed screen and Escape)
//   // destructive: one index or a list of them (red buttons)
//
// All text goes in through textContent.
import { EASE, DURATION } from "./motion.js";

export function showActionSheet({ title = "", buttons = [], cancel = "Cancel", destructive = -1 } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "action-scrim";
    const dim = document.createElement("div"); // its own layer, so the dimming fades by opacity alone
    dim.className = "action-dim";
    const sheet = document.createElement("div");
    sheet.className = "action-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    if (title) {
      sheet.setAttribute("aria-label", title);
      sheet.append(Object.assign(document.createElement("p"), { className: "action-title", textContent: title }));
    }
    // The choices scroll in their own list; the title and Cancel stay put, so Cancel is always a tap away.
    const list = document.createElement("div");
    list.className = "action-list";
    list.dataset.scroller = ""; // nav/scroller.js draws its iOS 6 indicator in the list's box
    sheet.append(list);
    const make = (label, cls, index, parent = list) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `action-button${cls ? ` ${cls}` : ""}`;
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); close(index); });
      parent.append(b);
      return b;
    };
    buttons.forEach((label, i) => make(label, [].concat(destructive).includes(i) ? "destructive" : "", i));
    const cancelButton = cancel ? make(cancel, "cancel", -1, sheet) : null;
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, sheet);
    document.body.append(scrim);

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION, easing: EASE });
    (cancelButton || sheet.querySelector(".action-button"))?.focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      // B202: the answer and the sheet's removal never hang on the slide-out. A throw in it (C26's undefined `ease`
      // until B201) left the sheet drawn with dead buttons and the caller never answered: View Repo froze the app.
      resolve(index);
      let timer = 0;
      const end = () => { clearTimeout(timer); scrim.remove(); };
      try {
        dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
        const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: EASE, fill: "forwards" });
        timer = setTimeout(end, 250 + 300); // an animation iOS drops (the app went to the background) still ends
        a.finished.then(end, end);
      } catch {
        end();
      }
    }
  });
}
