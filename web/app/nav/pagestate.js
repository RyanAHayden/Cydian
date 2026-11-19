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
