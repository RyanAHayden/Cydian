// Per-tab navigation stacks, as UINavigationController keeps them: every tab holds the screens from its root to
// the one on top, so a push leaves the previous screen in place (for the slide and the edge-swipe back to reveal)
// and a pop removes only the top. No DOM here: `create(tab, path)` makes whatever a page is (a DOM element in the
// app, a plain object in tests), and sync() tells the caller what changed so it can animate and clean up.

import { prefixes } from "../router.js";

const same = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);

export function createStacks({ tabs, create }) {
  const stacks = Object.fromEntries(tabs.map((t) => [t, []])); // entries: { tab, path, page, pushed }
  let activeTab = null;

  return {
    activeTab: () => activeTab,
    stack: (tab) => stacks[tab].slice(),
    top: (tab = activeTab) => (tab && stacks[tab].length ? stacks[tab][stacks[tab].length - 1] : null),

    // Bring the stacks in line with a route. Returns
    //   { kind, tab, from, to, added, removed }
    // kind: "tab" (another tab came to the front, or the first route), "push" (one screen on top),
    // "pop" (one or more screens off the top), "replace" (anything else within the tab), "none".
    // from/to: the top entry before and after (from is null on the first route). removed: entries taken off,
    // top first; the caller removes their pages once any animation is done.
    sync(route) {
      const stack = stacks[route.tab];
      const want = prefixes(route.path);
      const before = activeTab;
      const from = this.top();
      let keep = 0;
      while (keep < stack.length && keep < want.length && same(stack[keep].path, want[keep])) keep++;
      const removed = stack.splice(keep).reverse();
      const added = [];
      for (let i = keep; i < want.length; i++) {
        const entry = { tab: route.tab, path: want[i], page: create(route.tab, want[i]), pushed: false };
        stack.push(entry);
        added.push(entry);
      }
      activeTab = route.tab;
      const to = this.top();
      let kind;
      if (before !== route.tab) kind = "tab";
      else if (!added.length && !removed.length) kind = "none";
      else if (added.length === 1 && !removed.length) kind = "push";
      else if (!added.length) kind = "pop";
      else kind = "replace";
      // A pushed entry has its parent right behind it in the browser history, so back can be history.back().
      if (kind === "push") to.pushed = true;
      return { kind, tab: route.tab, from, to, added, removed };
    },
  };
}

// Edge-swipe back: does letting go here finish the pop? Past half the width, or flicked rightwards; a flick back
// to the left cancels even past half, as on iOS. dx in px, vx in px/ms, width in px.
export function swipeCommits(dx, vx, width) {
  if (vx > 0.3) return true;
  if (vx < -0.3) return false;
  return dx > width / 2;
}
