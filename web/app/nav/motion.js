// The app's motion constants and its one stylesheet loader, so every module animates with the same numbers.
//
// EASE is iOS 6's default animation curve (CSS `ease`): sheets, banners, bars, rows and slide.js all use it.
// The navigation push has its own curve in transition.js (UINavigationController's), kept there.

export const EASE = "cubic-bezier(.25,.1,.25,1)";
export const DURATION = 300;  // ms: iOS 6's standard .3s (sheets leaving, bars, banners, fades)
export const SHEET_IN = 350;  // ms: a sheet or action sheet rising from the bottom, and the navigation push

// A stylesheet from web/app/ (name relative to it, e.g. "settings.css"), linked once per page. No build step: a
// module calls this when it loads or first draws. Without a document (node --test) it does nothing.
const linked = new Set();
export function loadStyle(name) {
  if (linked.has(name) || typeof document === "undefined" || !document.head) return;
  linked.add(name);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL(`../${name}`, import.meta.url).href;
  document.head.append(link);
}
