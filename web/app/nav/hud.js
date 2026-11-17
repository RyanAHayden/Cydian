// The "Reloading Data" HUD: a dark rounded box with a 12-spoke spinner and a bold label, over a clear scrim that
// eats taps until it goes. showHUD() returns hide(). Fades and spins by opacity/transform only.

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
  return function hide() {
    if (hidden) return;
    hidden = true;
    const a = scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: "ease-in", fill: "forwards" });
    a.finished.then(() => scrim.remove(), () => scrim.remove());
  };
}
