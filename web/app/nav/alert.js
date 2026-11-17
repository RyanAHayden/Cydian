// UIAlertView as iOS 6 draws it ("Alert diaglog" in the kit; styles in sources.css): a translucent navy box with
// a gloss, bold title, message, an optional text field and one or two buttons side by side (three or more
// stack). Pops in with the iOS bounce, by transform/opacity only.
//
//   const { index, value } = await showAlert({ title, message, input: { placeholder, value, type },
//                                              buttons: ["Cancel", "Add Source"], cancel: 0 });
//
// Resolves with the tapped button's index and the field's text. Return in the field taps the last button,
// Escape taps `cancel`. All text goes in through textContent.
export function showAlert({ title = "", message = "", input = null, buttons = ["OK"], cancel = 0 } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "alert-scrim";
    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const h = Object.assign(document.createElement("h2"), { className: "alert-title", textContent: title });
    box.append(h);
    if (message) box.append(Object.assign(document.createElement("p"), { className: "alert-message", textContent: message }));
    let field = null;
    if (input) {
      field = document.createElement("input");
      field.className = "alert-field";
      field.type = input.type || "text";
      field.placeholder = input.placeholder || "";
      field.value = input.value || "";
      field.autocapitalize = "off";
      field.autocomplete = "off";
      field.spellcheck = false;
      field.setAttribute("autocorrect", "off");
      field.setAttribute("aria-label", title);
      box.append(field);
    }
    const row = document.createElement("div");
    row.className = "alert-buttons" + (buttons.length > 2 ? " stacked" : "");
    buttons.forEach((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "alert-button" + (i === cancel && buttons.length > 1 ? " cancel" : "");
      b.textContent = label;
      b.addEventListener("click", () => close(i));
      row.append(b);
    });
    box.append(row);
    scrim.append(box);
    document.body.append(scrim);

    // Locked in place, as on iOS 6: nothing behind it scrolls, and with the keyboard up it stays centred in the part of
    // the screen that's still showing (iOS pans the page when a field takes focus; the visual viewport says where to).
    const noScroll = (e) => { if (e.cancelable) e.preventDefault(); };
    scrim.addEventListener("touchmove", noScroll, { passive: false });
    scrim.addEventListener("wheel", noScroll, { passive: false });
    const vv = globalThis.visualViewport;
    const fit = () => {
      scrim.style.top = vv.offsetTop + "px";
      scrim.style.height = vv.height + "px";
      scrim.style.bottom = "auto";
    };
    if (vv) { fit(); vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(cancel); }
      if (e.key === "Enter" && field && document.activeElement === field) { e.preventDefault(); close(buttons.length - 1); }
    };
    document.addEventListener("keydown", onKey);
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    box.animate([
      { transform: "scale(1.15)", opacity: 0 },
      { transform: "scale(.95)", opacity: 1, offset: 0.55 },
      { transform: "scale(1.02)", offset: 0.8 },
      { transform: "scale(1)" },
    ], { duration: 360, easing: "ease-out" });
    (field || row.lastChild).focus({ preventScroll: true });

    let done = false;
    function close(index) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
      const value = field ? field.value : undefined;
      field?.blur();
      const a = scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      a.finished.then(() => scrim.remove(), () => scrim.remove());
      resolve({ index, value });
    }
  });
}
