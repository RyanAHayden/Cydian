// UIActionSheet as iOS 6 draws it (F29; Cydia's Modify and Downgrade sheets, ref/4s/screens/cydia-package-modify.png
// and -downgrade.png): a translucent grey-blue panel slides up from the bottom over a dimmed screen, with a
// stack of white glossy buttons and a dark Cancel button below a wider gap. Styles: packages.css (.action-sheet),
// colours sampled from the 4S's UIAlertSheet* art. Slides by transform only.
//
//   const i = await showActionSheet({ title, buttons: ["Reinstall", "Remove"], destructive: 1 });
//   // i: the tapped button's index, or -1 for Cancel (also a tap on the dimmed screen and Escape)
//
// All text goes in through textContent.
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
    const make = (label, cls, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `action-button${cls ? ` ${cls}` : ""}`;
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); close(index); });
      sheet.append(b);
      return b;
    };
    buttons.forEach((label, i) => make(label, i === destructive ? "destructive" : "", i));
    const cancelButton = cancel ? make(cancel, "cancel", -1) : null;
    dim.addEventListener("click", () => close(-1));
    scrim.append(dim, sheet);
    document.body.append(scrim);

    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(-1); } };
    document.addEventListener("keydown", onKey);
    const ease = "cubic-bezier(.25,.1,.25,1)";
    dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
    sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 300, easing: ease });
    (cancelButton || sheet.querySelector(".action-button"))?.focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      scrim.style.pointerEvents = "none";
      dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
      const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 250, easing: ease, fill: "forwards" });
      const end = () => scrim.remove();
      a.finished.then(end, end);
      resolve(index);
    }
  });
}
