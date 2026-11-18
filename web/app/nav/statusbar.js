// F167: a tap on the status bar scrolls to the top, as in native iOS apps. iOS sends the tap to the WKWebView's own
// scroll view, which never scrolls (every page scrolls inside its .page-body), so the native shell refuses it
// (scrollViewShouldScrollToTop -> false) and calls globalThis.cydianScrollToTop() instead. Safari never sends it.
//
// What scrolls is the list on top: an open sheet's (the last [role=dialog] on the page), else the top page's. Inside
// that layer, the scroller that is scrolled down (Search's results under its field, a sheet's list), the innermost
// one when several are, so the tap moves what the user sees.
import { scrollToTop } from "./tabbar.js";

export const SCROLLERS = ".page-body, [data-scroller], .sheet-scroll, .sheet-body, .progress-scroll, .console-scroll, "
  + ".search-results, .filter-drop-inner, .action-list";

const shown = (el) => !el.getClientRects || el.getClientRects().length > 0;

// The scroller the status bar tap should move, or null when nothing on top is scrolled down.
export function statusBarTarget(doc, pageBody) {
  const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter(shown);
  const layer = dialogs.at(-1) || pageBody;
  if (!layer) return null;
  const all = [layer, ...layer.querySelectorAll(SCROLLERS)];
  return all.filter((el) => el.scrollTop > 0 && shown(el)).at(-1) || null;
}

// globalThis.cydianScrollToTop: true when something scrolled.
export function makeScrollToTop(doc, topBody, win = globalThis) {
  return () => scrollToTop(statusBarTarget(doc, topBody()), win);
}
