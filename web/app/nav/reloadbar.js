// F150: Cydia's reload bar. While sources refresh, a dark translucent strip drops down from the top like the
// notification banner (nav/banner.js), with a small white spinner at its left, a line saying what is happening
// (core/reloadsteps.js) and a blue Cancel at its right. It blocks nothing: there is no scrim, only the strip itself
// takes touches, and the nav bar and the screens move down by its height (ios6.css html.has-reload) so it covers
// no buttons. It slides back up when hidden. Only transform animates.
//
//   const bar = showReloadBar("Updating Sources", { onCancel: () => stop() });
//   bar.set("Loading Data");  bar.hide();
//
// One bar at a time: showing another hides the first. `doc` is for the tests.

let current = null;

export function showReloadBar(text = "", { onCancel = null, doc = globalThis.document } = {}) {
  current?.hide();
  if (!doc?.createElement) return { set() {}, hide() {}, el: null, get hidden() { return true; } };
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

  let hidden = false;
  const root = doc.documentElement;
  const handle = {
    el: bar,
    get hidden() { return hidden; },
    set(t) { if (!hidden && label) label.textContent = t; },
    hide() {
      if (hidden) return;
      hidden = true;
      if (current === handle) current = null;
      root?.classList?.remove("has-reload");
      const a = bar.animate?.([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 250, easing: "ease-in", fill: "forwards" });
      if (a?.finished) a.finished.then(() => bar.remove(), () => bar.remove());
      else bar.remove();
    },
  };
  cancel.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    if (hidden) return;
    handle.hide();
    onCancel?.();
  });
  handle.set(text);
  doc.body.append(bar);
  bar.animate?.([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" });
  root?.classList?.add("has-reload");
  current = handle;
  return handle;
}
