// UIMenuController as iOS 6 draws it: the black glossy callout with an arrow (Copy, Select All…), shown above a
// held item. Styles: ios6.css (.menu). Any touch outside, a scroll or Escape puts it away.
//
//   showMenu(element, [{ label: "Copy URL", onClick }])
//   longPress(element, (e) => ...)  a 500 ms hold that doesn't move; returns true from the hold to eat the click
import { haptic } from "./haptic.js";

let open = null; // the menu on screen: { close() }

export function showMenu(anchor, items, { x = null } = {}) {
  open?.close();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const row = document.createElement("div");
  row.className = "menu-items";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-item";
    b.setAttribute("role", "menuitem");
    b.textContent = it.label;
    b.addEventListener("click", () => { close(); it.onClick(); });
    row.append(b);
  }
  const arrow = document.createElement("span");
  arrow.className = "menu-arrow";
  menu.append(row, arrow);
  document.body.append(menu);

  // Above the item, centred on the finger (or the item), kept on screen; below it when there's no room above.
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const cx = x ?? r.left + r.width / 2;
  const left = Math.max(6, Math.min(innerWidth - w - 6, cx - w / 2));
  const below = r.top - h - 4 < 60;
  menu.classList.toggle("below", below);
  menu.style.left = left + "px";
  menu.style.top = (below ? r.bottom + 4 : r.top - h - 4) + "px";
  arrow.style.left = Math.max(14, Math.min(w - 14, cx - left)) + "px";
  menu.animate([{ opacity: 0, transform: "scale(.8)" }, { opacity: 1, transform: "none" }], { duration: 150, easing: "ease-out" });
  anchor.classList.add("is-held");

  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey);
  });
  function close() {
    if (open !== ctl) return;
    open = null;
    anchor.classList.remove("is-held");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("scroll", close, true);
    document.removeEventListener("keydown", onKey);
    const a = menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
    a.finished.then(() => menu.remove(), () => menu.remove());
  }
  const ctl = { close };
  open = ctl;
  return close;
}

// Copy text, with the old execCommand path where the async clipboard isn't allowed.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    t.style.cssText = "position:fixed;opacity:0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

// The app's clipboard straight from UIPasteboard (Bridge.swift clipboard.read: no WebKit Paste bubble), "" when
// there's no text. null on the website, or a shell from before clipboard.read: those use navigator.clipboard.
// F146: `params.auto` (Sources' Add filling its field by itself) lets the sideload build skip the read when iOS says
// no URL was copied or the user refused Allow Paste before; without it (a tap on Paste) it always reads.
export async function nativePaste(native = globalThis.cydianNative, params = {}) {
  if (!native?.call) return null;
  try { return String((await native.call("clipboard.read", params)) ?? ""); } catch { return null; }
}

// A hold on `el` (or a descendant matching `selector`): 500 ms without moving more than 10px. `onHold(target, e)`
// runs at the hold; the click that ends it is swallowed so the item doesn't open.
export function longPress(el, selector, onHold) {
  let timer = 0, start = null, fired = false;
  const cancel = () => { clearTimeout(timer); start = null; };
  el.addEventListener("pointerdown", (e) => {
    const target = e.target.closest(selector);
    fired = false;
    if (!target || !el.contains(target)) return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { fired = true; start = null; haptic(); onHold(target, e); }, 500);
  });
  el.addEventListener("pointermove", (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("click", (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  el.addEventListener("contextmenu", (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}
