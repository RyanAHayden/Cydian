// F102: the Wish List (Sileo's Wish List Manager, Zebra's ZBWishListTableViewController; docs/sileo-zebra.md). Add to /
// Remove from Wish List on the package page's sheet (screens/browse.js packageActions), its page from Home
// (screens/home.js, route wishlist). Kept on the device like the holds: a JSON list of package ids at
// localStorage["cydian.wishlist"]. Installed packages drop off it (prune, when the page draws). Pure JS, no DOM.
//
//   const w = createWishlist();           // storage defaults to localStorage; memory only where that throws
//   w.has(id)  w.list()  w.set(id, on)    // list(): in the order they were added
//   w.prune(installedIds)                 // drops the installed ones; returns what it dropped
//   wishLabel(on)                         // the sheet's button for a package on (or off) the list
//   wishRows(ids, rows, installed)        // the page's rows: the catalog's, by name, installed and unknown left out

export const WISHLIST_KEY = "cydian.wishlist";
export const WISH_ADD = "Add to Wish List";
export const WISH_REMOVE = "Remove from Wish List";
export const WISH_EMPTY = "Packages you add from their page (Add to Wish List) show here until they are installed.";

export const wishLabel = (on) => (on ? WISH_REMOVE : WISH_ADD);

export function createWishlist({ storage = globalThis.localStorage } = {}) {
  let mem = null; // the session's copy when storage throws (Safari's private mode, a full quota)
  const listeners = new Set();
  function read() {
    let raw = mem;
    try { const v = storage?.getItem(WISHLIST_KEY); if (v != null) raw = v; } catch { /* unavailable */ }
    try {
      const list = JSON.parse(raw || "[]");
      return Array.isArray(list) ? [...new Set(list.filter((p) => typeof p === "string" && p))] : [];
    } catch {
      return [];
    }
  }
  function write(list) {
    mem = JSON.stringify(list);
    try { storage?.setItem(WISHLIST_KEY, mem); } catch { /* the memory copy stands */ }
    for (const f of listeners) f(list);
  }
  return {
    list: read,
    has: (id) => read().includes(id),
    set(id, on) {
      const list = read();
      const has = list.includes(id);
      if (on && !has) write([...list, id]);
      else if (!on && has) write(list.filter((p) => p !== id));
    },
    prune(installed) {
      const inst = new Set(installed);
      const list = read();
      const gone = list.filter((p) => inst.has(p));
      if (gone.length) write(list.filter((p) => !inst.has(p)));
      return gone;
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

// `rows`: the catalog's rows for the wished ids (null or missing for one no source carries now), `installed`: ids
// on the device. Sorted by name, as the other plain package lists.
export function wishRows(ids, rows, installed = []) {
  const inst = new Set(installed);
  const want = new Set(ids);
  return rows.filter((r) => r && want.has(r.id) && !inst.has(r.id))
    .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), undefined, { sensitivity: "base" }));
}
