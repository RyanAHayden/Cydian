// Home Screen launches open on Home (F32), like Facebook's web app: whatever page was showing when the site was
// added (iOS before 17 keeps that URL, hash and all, instead of the manifest's start_url), and wherever the app was
// left last time it was killed. No DOM here, so it runs under `node --test`.
//
// The rule runs once, when app.js loads. A return from the background never reloads the page, so it never gets
// here; a reload (Home's Reload button, or iOS reloading the page) and back/forward keep the route.

// win: window-like ({ matchMedia, navigator, performance, location, ifizboxApp }).
export function isStandaloneWeb(win) {
  if (win.ifizboxApp || win.ifizboxNative) return false; // the native app's WKWebView has its own launch
  return Boolean(win.matchMedia?.("(display-mode: standalone)")?.matches || win.navigator?.standalone === true);
}

// "navigate" | "reload" | "back_forward" | "prerender", or null when the browser can't tell.
export function navigationType(win) {
  const entry = win.performance?.getEntriesByType?.("navigation")?.[0];
  if (entry?.type) return entry.type;
  const old = win.performance?.navigation?.type; // 0 navigate, 1 reload, 2 back_forward
  return old === 1 ? "reload" : old === 2 ? "back_forward" : old === 0 ? "navigate" : null;
}

// The URL to replace the current one with before the router starts, or null to leave it: a fresh standalone launch
// goes to Home. resumed: the page came back from the background or the
// back/forward cache (pageshow with persisted) rather than loading; it keeps its route.
export function launchURL(win, { resumed = false } = {}) {
  const { pathname, search, hash } = win.location;
  const fresh = !resumed && isStandaloneWeb(win) && navigationType(win) !== "reload" &&
    navigationType(win) !== "back_forward";
  return fresh && hash !== "#/home" ? pathname + search + "#/home" : null;
}
