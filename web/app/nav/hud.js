// The "Reloading Data" HUD: a dark rounded box with a 12-spoke spinner and a bold label, over a clear scrim that
// eats taps until it goes. showHUD() returns hide(), and hide.done(label) ends it on a checkmark. Fades and spins by
// opacity/transform only.

const SPOKES = Array.from({ length: 12 }, (_, i) =>
  `<line x1="18" y1="3" x2="18" y2="10" transform="rotate(${i * 30} 18 18)" opacity="${(1 - i / 14).toFixed(2)}"/>`).join("");

export function showHUD(text = "Reloading Data") {
  const scrim = document.createElement("div");
  scrim.className = "hud-scrim";
  scrim.innerHTML = '<div class="hud" role="status" aria-live="polite">' +
    `<svg class="hud-spinner" viewBox="0 0 36 36" aria-hidden="true"><g stroke="#fff" stroke-width="3.2" stroke-linecap="round">${SPOKES}</g></svg>` +
    '<span class="hud-label"></span></div>';
  scrim.querySelector(".hud-label").textContent = text;
  document.body.append(scrim);
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
  let hidden = false;
  const hide = function hide() {
    if (hidden) return;
    hidden = true;
    const a = scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
    a.finished.then(() => scrim.remove(), () => scrim.remove());
  };
  // hide.done("Done"): the spinner becomes a white circled checkmark with the label, held a moment, then the HUD
  // fades, so the end of a long job is plain to see.
  hide.done = (label = "Done", hold = 1100) => {
    if (hidden) return;
    const svg = scrim.querySelector(".hud-spinner");
    svg.outerHTML = '<svg class="hud-check" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#fff" stroke-width="2.6"/>'
      + '<path d="M10.5 18.5l5 5 10-11" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    scrim.querySelector(".hud-label").textContent = label;
    scrim.querySelector(".hud-check").animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1.08)", opacity: 1, offset: 0.7 }, { transform: "none" }],
      { duration: 260, easing: "ease-out" });
    setTimeout(hide, hold);
  };
  return hide;
}

// A HUD whose label changes as a job goes on: { set(text), hide, done(label) } (hide and done as showHUD's).
export function liveHUD(text) {
  const hide = showHUD(text);
  const label = typeof document === "undefined" ? null : [...document.querySelectorAll(".hud-label")].at(-1);
  return { set: (t) => { if (label) label.textContent = t; }, hide, done: (t) => hide.done(t) };
}
