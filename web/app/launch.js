// Home Screen launches open on Home (F32), like Facebook's web app: whatever page was showing when the site was
// added (iOS before 17 keeps that URL, hash and all, instead of the manifest's start_url), and wherever the app was
// left last time it was killed. No DOM here, so it runs under `node --test`.
//
// The rule runs once, when app.js loads. A return from the background never reloads the page, so it never gets
// here; a reload (Home's Reload button, or iOS reloading the page) and back/forward keep the route. A notification
// tap that opens the app (sw.js) marks its URL with ?launch=push and keeps the page it names.

export const PUSH_MARK = "launch";

// win: window-like ({ matchMedia, navigator, performance, location, cydianApp }).
export function isStandaloneWeb(win) {
  if (win.cydianApp || win.cydianNative) return false; // the native app's WKWebView has its own launch
  return Boolean(win.matchMedia?.("(display-mode: standalone)")?.matches || win.navigator?.standalone === true);
}

// "navigate" | "reload" | "back_forward" | "prerender", or null when the browser can't tell.
export function navigationType(win) {
  const entry = win.performance?.getEntriesByType?.("navigation")?.[0];
  if (entry?.type) return entry.type;
  const old = win.performance?.navigation?.type; // 0 navigate, 1 reload, 2 back_forward
  return old === 1 ? "reload" : old === 2 ? "back_forward" : old === 0 ? "navigate" : null;
}

// The URL to replace the current one with before the router starts, or null to leave it. It drops the push mark
// everywhere, and sends a fresh standalone launch to Home. resumed: the page came back from the background or the
// back/forward cache (pageshow with persisted) rather than loading; it keeps its route.
export function launchURL(win, { resumed = false } = {}) {
  const { pathname, search, hash } = win.location;
  const params = new URLSearchParams(search);
  const fromPush = params.has(PUSH_MARK);
  params.delete(PUSH_MARK);
  const rest = params.toString() ? "?" + params : "";
  const fresh = !resumed && isStandaloneWeb(win) && !fromPush && navigationType(win) !== "reload" &&
    navigationType(win) !== "back_forward";
  if (fresh && hash !== "#/home") return pathname + rest + "#/home";
  if (fromPush) return pathname + rest + hash;
  return null;
}
