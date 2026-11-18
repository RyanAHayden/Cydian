// The nav bar seen from a screen: the nav item that goes with a page body, and a small icon button put beside the
// page's own right button (F210: the app page's Installed toggle, left of Install / Modify).
//
// The icon goes after the page's button in the DOM, so every `querySelector(".nav-right .bar-button:not(.share-button)")`
// (browse.js setRightLabel) still finds Install first; CSS `order` (style.css .nav-icon-left) draws it on the left.

// Same index in its tab's stack (as browse.js setRightLabel and sharesheet.js find it).
export function navItemOf(body) {
  const page = body?.closest?.(".page");
  const stack = page?.parentElement;
  if (!stack) return null;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  return document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i] ?? null;
}

// Puts `button` (class nav-icon-left) left of the page's own right button, in place of an earlier one with the same
// `key` (a page drawn again). False when the page has no nav item yet (its caller tries again once it is laid out).
export function addNavIcon(body, button, key = "icon") {
  const item = navItemOf(body);
  const right = item?.querySelector(".nav-right");
  if (!right) return false;
  if (button.parentElement === right) return true;
  for (const old of right.querySelectorAll(":scope > .nav-icon-left")) if (old.dataset.navIcon === key) old.remove();
  button.dataset.navIcon = key;
  button.classList.add("nav-icon-left");
  const own = [...right.children].filter((b) => b.classList.contains("bar-button") && !b.classList.contains("share-button")
    && !b.classList.contains("nav-icon-left"));
  for (const b of own) b.classList.add("nav-after-icon");
  right.append(button);
  item.classList.add("has-nav-icon");
  return true;
}
