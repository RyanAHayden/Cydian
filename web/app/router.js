// Client-side navigation: the route lives in the URL hash (`#/sources/…`), so changing screens never loads a
// page, and it works the same from the site and from the app bundle (file:// or a custom scheme). No DOM here:
// the router gets a window-like object, which keeps it testable under `node --test`.

export const ALL_TABS = ["home", "sources", "changes", "installed", "search", "settings"];
// The tabs this build shows: every build (site, jailbreak, sideload) shows every tab (user 2026-11-17).
export const TABS = ALL_TABS;
const DEFAULT_TAB = "home";
// F123: Settings is no tab of its own any more, as in Cydia: the tab bar shows the other five, and Settings' pages
// open on Home's stack (Home's Settings row), as #/home/settings/<…>. Its screen stays in TABS: it draws those pages.
export const BAR_TABS = TABS.filter((t) => t !== "settings");
const IN_HOME = "settings"; // Home's path segment that holds the Settings screen's pages
// The route to a Settings page (path below Settings' root): on Home's stack.
export const settingsRoute = (path = []) => ({ tab: "home", path: [IN_HOME, ...path] });
const inHome = (route) => route.tab === "home" && route.path[0] === IN_HOME;

// "#/sources/a%20b/c" -> { tab: "sources", path: ["a b", "c"] }. Anything unknown lands on the default tab.
export function parse(hash) {
  const parts = String(hash || "").replace(/^#/, "").split("/").filter(Boolean).map(safeDecode);
  const [tab, ...path] = parts;
  if (tab === IN_HOME) return settingsRoute(path); // links made before F123 (#/settings/signing) and format({ tab: "settings" })
  return TABS.includes(tab) ? { tab, path } : { tab: DEFAULT_TAB, path: [] };
}

export function format({ tab, path = [] }) {
  return "#/" + [tab, ...path].map(encodeURIComponent).join("/");
}

// The pages a route stands on, root first: ["a", "b"] -> [[], ["a"], ["a", "b"]]. Each one is a screen in its tab's
// navigation stack, so a deep link builds the whole stack and back walks it.
export function prefixes(path) {
  // A "~tab" segment only opens another tab's pages inside this one (see mounted): it is no page of its own.
  return Array.from({ length: path.length + 1 }, (_, i) => path.slice(0, i)).filter((p) => !isMount(p.at(-1)));
}

// Another tab's pages opened inside this tab (user 2026-11-17: a link keeps the current page and slides the new one
// in; Back comes back): #/home/~installed/myipas is Installed's myipas page on Home's stack.
const MOUNT = "~";
const isMount = (seg) => typeof seg === "string" && seg.startsWith(MOUNT) && TABS.includes(seg.slice(1));
// The screen a route shows: its innermost "~tab" and the path after it, or the route itself; Home's settings/… is
// the Settings screen's (F123).
export function mounted(route) {
  let r = route;
  for (let i = route.path.length - 1; i >= 0; i--) {
    if (isMount(route.path[i])) { r = { tab: route.path[i].slice(1), path: route.path.slice(i + 1) }; break; }
  }
  return inHome(r) ? { tab: IN_HOME, path: r.path.slice(1) } : r;
}
// A link from `from` to another tab's page, as a push on from's own stack: back to from's page, inside the same
// mount when from already shows that tab. Null when `to` stays in from's tab (or is a tab's root: a plain switch).
// A Settings page (Home's settings/…) linked from another tab mounts as "~settings"; Settings' root switches to Home.
export function mountLink(from, to) {
  if (from && from.tab !== "home" && inHome(to)) to = { tab: IN_HOME, path: to.path.slice(1) };
  if (!from || to.tab === from.tab || !to.path.length) return null;
  const k = from.path.indexOf(MOUNT + to.tab);
  const base = k >= 0 ? from.path.slice(0, k) : from.path;
  return { tab: from.tab, path: [...base, MOUNT + to.tab, ...to.path] };
}

// The route one level up, or null at a tab's root.
export function parent(route) {
  if (!route.path.length) return null;
  const path = route.path.slice(0, -1);
  while (isMount(path.at(-1))) path.pop();
  return { tab: route.tab, path };
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// onRoute(route, previous) runs on start and on every change (links, back/forward, go(), selectTab()).
export function createRouter({ win, onRoute }) {
  let current = null;
  const lastPath = Object.fromEntries(TABS.map((t) => [t, []])); // each tab keeps its own stack, as on iOS

  const seen = []; // the hashes walked, to tell a back (to the one before) from a link
  let switching = false; // the tab bar's own switch: never a mounted link
  function sync() {
    let route = parse(win.location.hash);
    const back = seen.length > 1 && seen.at(-2) === format(route);
    const link = !switching && !back ? mountLink(current, route) : null;
    switching = false;
    if (link) { win.history.replaceState(null, "", format(link)); route = link; }
    const canonical = format(route);
    if (win.location.hash !== canonical) {
      // Normalise without adding a history entry (e.g. "" or "#/bogus" -> "#/home").
      win.history.replaceState(null, "", canonical);
    }
    if (current && format(current) === canonical) return;
    if (back) seen.pop(); else seen.push(canonical);
    if (seen.length > 200) seen.splice(0, seen.length - 200);
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
    // Like go, but without a history entry (the back button on a deep link that has no history behind it).
    replace(route) {
      const hash = format(route);
      if (win.location.hash === hash) return;
      win.history.replaceState(null, "", hash);
      sync();
    },
    // Tab bar tap: switch to the tab where the user left it; tapping the tab you are on pops it to its root.
    selectTab(tab) {
      if (!TABS.includes(tab)) return;
      const path = current && current.tab === tab ? [] : lastPath[tab];
      // hashchange comes later: sync clears the flag (go does nothing when the hash is already there)
      switching = win.location.hash !== format({ tab, path });
      this.go({ tab, path });
    },
  };
}
