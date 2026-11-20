// B43: what a page shows first. A pushed page (from Home or anywhere) always opens on its default segment, filter
// or pane; coming Back to a page keeps what it showed; a tab's root keeps its state across tab switches, as iOS 6
// does. The stacks (nav/stack.js) already give most of that: Back and a tab switch never rebuild a page, so the
// page below is as it was left. What breaks it is state a screen keeps in its module (a filter, a mode, Edit), which
// outlives its page and would pick what the next page of that kind opens on.
//
// So a screen registers a reset for such state: onPageOpen(match, reset). app.js makePage calls pageOpened(route)
// each time it builds a page (a push, a deep link's levels, a tab's first visit), before the screen's nav() and
// render(); every reset whose match(route) is true runs. Back and tab switches build nothing, so nothing resets.
// `route` is the mounted route (router.js mounted): { tab, path } of the screen that draws the page.

const resets = [];

// Registers `reset()` for the pages `match(route)` picks. Returns a function that unregisters it.
export function onPageOpen(match, reset) {
  const entry = { match, reset };
  resets.push(entry);
  return () => {
    const i = resets.indexOf(entry);
    if (i >= 0) resets.splice(i, 1);
  };
}

// A page for `route` is being built: put the state it starts from back to its defaults.
export function pageOpened(route) {
  for (const { match, reset } of resets.slice()) {
    let hit = false;
    try { hit = Boolean(match(route)); } catch { hit = false; }
    if (hit) reset(route);
  }
}

// B148: a page coming back into view. Back (and a tab switch) shows the kept page below as it was drawn, so a detail
// read from state when it was built (Settings' iFizBox Account: Off, then Sign In on the Account page) stays stale.
// app.js calls pageShown(route, body) each time an existing page becomes the top again (a pop or a tab switch; a page
// just built is already fresh). Two ways to follow it, both in place (no rebuild, no rows added or removed, only
// text changes: F284's rule):
//   liveText(node, compute)   a row's detail that comes from state: compute() (a string, or a promise of one) is run
//                             now and again whenever the page holding `node` is shown; nav/ui.js grouped() registers a
//                             row's `live` this way
//   onPageShow(match, show)   anything else a screen refreshes itself: show(route, el) for the pages match(route) picks
const shows = [];
const live = new Set(); // { node, compute, n, shown }

export function onPageShow(match, show) {
  const entry = { match, show };
  shows.push(entry);
  return () => {
    const i = shows.indexOf(entry);
    if (i >= 0) shows.splice(i, 1);
  };
}

// Sets node's text to compute()'s answer now and on every later show of its page. Answers land in order: an older
// one never paints over a newer one. A null/undefined answer leaves the text as it is. Returns the refresh.
export function liveText(node, compute) {
  const entry = { node, compute, n: 0, shown: 0 };
  live.add(entry);
  const run = () => {
    const n = ++entry.n;
    let p;
    try { p = Promise.resolve(compute()); } catch { p = Promise.resolve(null); }
    return p.catch(() => null).then((v) => {
      if (n < entry.shown || v == null) return;
      entry.shown = n;
      if (node.textContent !== String(v)) node.textContent = String(v);
    });
  };
  entry.run = run;
  run();
  return run;
}

// The live texts inside `el` (all of them without one), run again. Nodes taken off the page are forgotten.
export function refreshLive(el = null) {
  const runs = [];
  for (const entry of [...live]) {
    if (entry.seen && entry.node.isConnected === false) { live.delete(entry); continue; } // was on a page, now gone
    if (entry.node.isConnected) entry.seen = true;
    if (el && !(el === entry.node || el.contains?.(entry.node))) continue;
    runs.push(entry.run());
  }
  return Promise.all(runs);
}

// An existing page for `route` (router.js mounted) is on top again, its body `el`: refresh what it shows in place.
export function pageShown(route, el) {
  const done = el ? [refreshLive(el)] : [];
  for (const { match, show } of shows.slice()) {
    let hit = false;
    try { hit = Boolean(match(route)); } catch { hit = false; }
    if (!hit) continue;
    try { done.push(Promise.resolve(show(route, el)).catch(() => {})); } catch { /* one screen's error stops no other */ }
  }
  return Promise.all(done);
}

// Copies each fresh row's detail onto the cell with the same label, in place: `cells` are { label, detail } with
// `detail` the drawn detail node (or null), `rows` the rows as they'd be drawn now ({ label, detail }). Cells with no
// fresh row, or no detail node, stay as they are: nothing is added or removed. Returns how many changed.
export function patchDetails(cells, rows) {
  const fresh = new Map();
  for (const r of rows) if (r && r.label != null && r.detail != null && !fresh.has(r.label)) fresh.set(r.label, String(r.detail));
  let changed = 0;
  for (const c of cells) {
    if (!c.detail || !fresh.has(c.label)) continue;
    const v = fresh.get(c.label);
    if (c.detail.textContent !== v) { c.detail.textContent = v; changed++; }
  }
  return changed;
}

// The drawn cells under `el` as patchDetails takes them (DOM).
export function cellsOf(el) {
  return [...(el.querySelectorAll?.(".cell-inner") ?? [])].map((c) => ({
    label: c.querySelector(".cell-label")?.textContent ?? null, detail: c.querySelector(".cell-detail"),
  }));
}
