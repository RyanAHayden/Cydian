// Client-side navigation: the route lives in the URL hash (`#/sources/…`), so changing screens never loads a
// page, and it works the same from the site and from the app bundle (file:// or a custom scheme). No DOM here:
// the router gets a window-like object, which keeps it testable under `node --test`.

export const TABS = ["home", "sources", "changes", "installed", "search"];
export const DEFAULT_TAB = "home";

// "#/sources/a%20b/c" -> { tab: "sources", path: ["a b", "c"] }. Anything unknown lands on the default tab.
export function parse(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("/").filter(Boolean).map(safeDecode);
  const [tab, ...path] = parts;
  return TABS.includes(tab) ? { tab, path } : { tab: DEFAULT_TAB, path: [] };
}

export function format({ tab, path = [] }) {
  return "#/" + [tab, ...path].map(encodeURIComponent).join("/");
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// onRoute(route, previous) runs on start and on every change (links, back/forward, go(), selectTab()).
export function createRouter({ win, onRoute }) {
  let current = null;
  const lastPath = Object.fromEntries(TABS.map((t) => [t, []])); // each tab keeps its own stack, as on iOS

  function sync() {
    const route = parse(win.location.hash);
    const canonical = format(route);
    if (win.location.hash !== canonical) {
      // Normalise without adding a history entry (e.g. "" or "#/bogus" -> "#/home").
      win.history.replaceState(null, "", canonical);
    }
    if (current && format(current) === canonical) return;
    const previous = current;
    current = route;
    lastPath[route.tab] = route.path;
    onRoute(route, previous);
  }

  return {
    start() { win.addEventListener("hashchange", sync); sync(); },
    stop() { win.removeEventListener("hashchange", sync); },
    current: () => current,
    go(route) {
      const hash = format(route);
      if (win.location.hash === hash) return;
      win.location.hash = hash; // fires hashchange -> sync
    },
    // Tab bar tap: switch to the tab where the user left it; tapping the tab you are on pops it to its root.
    selectTab(tab) {
      if (!TABS.includes(tab)) return;
      const path = current && current.tab === tab ? [] : lastPath[tab];
      this.go({ tab, path });
    },
  };
}
