// Which bar buttons a page's nav bar shows, from its screen's nav() info and whether it sits above another page.
//
// A root page's left button (Sources' and Changes' Refresh) gives way to Back when that root is pushed on another
// tab (Home's green tile, Help's and the guides' Refresh Sources / Check for Changes). A spec with
// `pushed: "right"` moves to the right end of the bar there instead of going away, so the pushed copy keeps its
// Refresh. A right-hand spec with `pushed: false` is left out of a pushed copy, to keep the bar from crowding
// (Sources' Add: Manage has its own Add). Moved buttons carry `moved: true`, so the screen code that finds its own
// right-hand button (Changes' Upgrade) can skip them.
//
// -> { back: boolean, left: spec|null, right: spec[] }
export function navButtons(info, pushed) {
  const own = [info.right].flat().filter(Boolean);
  if (!pushed) return { back: false, left: info.left ?? null, right: own };
  const right = own.filter((b) => b.pushed !== false);
  if (info.left?.pushed === "right") right.push({ ...info.left, moved: true });
  return { back: true, left: null, right };
}

// The class a moved button carries in the bar (`.nav-right .bar-button:not(.nav-moved)` finds a screen's own).
export const MOVED_CLASS = "nav-moved";
