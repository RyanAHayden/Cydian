// The screens' handle on the package catalog. The catalog itself (core/catalog.js) lives in the parse worker;
// this file feeds it every source's Packages index and forwards the screens' questions to it.
//
//   await catalog.ensure();                    // every source loaded for getArch(), at most once per refresh
//   catalog.sections(key)  catalog.list(key, section)  catalog.search(q)  catalog.author(name)
//   catalog.package(id, key)  catalog.has(names)       // all promises; key "*" = All Sources
//   catalog.changes()  catalog.onChange(f)             // the Changes tab (core/changes.js)
//
// Cydia's model: the package lists change when the sources are refreshed, not on every visit. A source's
// Packages text is kept in IndexedDB (core/cache.js) and reused while it is newer than the source's last
// refresh (`updated`, set by the Sources tab's Refresh or Add); after a refresh it is fetched again. Package
// lists go through filterArch (core/apt.js matchesArch, in the worker) with backend.js getArch().
import { getBackend, getParser, getArch } from "./backend.js";
import { repoLayout } from "./core/apt.js";
import { openIndexCache } from "./core/cache.js";
import { ALL } from "./core/catalog.js";
import { openSeenStore, recordRefresh, changeGroups } from "./core/changes.js";

export { ALL };

const loaded = new Map(); // source key -> { sig, count, error }
let running = null;       // the ensure() in flight
let cache;                // Promise of the IndexedDB cache, or of null where there is none

function indexCache() {
  return (cache ??= openIndexCache().catch(() => null));
}

const signature = (source, arch) => `${arch}|${source.uri}|${source.dist}|${(source.components ?? []).join(" ")}|${source.updated ?? 0}`;

// One source's Packages text: every component's index joined (a dist repo has one per component).
async function packagesText(source, arch) {
  const layout = repoLayout(source, arch);
  const db = await indexCache();
  const parts = [];
  let firstError = null;
  for (const file of layout.packages) {
    const dir = file.slice(0, -"Packages".length);
    const cacheKey = `packages:${dir}`;
    try {
      const hit = db && (await db.get(cacheKey));
      if (hit && hit.savedAt >= (source.updated ?? 0)) {
        parts.push(hit.value);
        continue;
      }
    } catch {
      // a broken cache only costs a fetch
    }
    try {
      const { text } = await getBackend().packages(dir);
      parts.push(text);
      db?.put(cacheKey, text).catch(() => {});
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!parts.length && firstError) throw firstError;
  return { text: parts.join("\n\n"), root: layout.root };
}

// ---- Changes (core/changes.js): every reload that loaded something files what it saw, under one `now`. ----
let seenStore;            // Promise of the first-seen store, or of null where there is no IndexedDB
const changeListeners = new Set();

function seen() {
  return (seenStore ??= openSeenStore().catch(() => null));
}

async function recordSeen() {
  try {
    const store = await seen();
    if (!store) return;
    const triples = await getParser().catalog("versions", []);
    const added = await recordRefresh(store, triples, Date.now());
    if (added) for (const f of changeListeners) f();
  } catch {
    // Changes is a nicety: a failed write only means the next refresh files these instead
  }
}

async function loadSource(source, arch, sig) {
  try {
    // The last refresh found nothing for this arch (Telesphoreo's Release lists no arm64): nothing to fetch.
    const empty = source.count === 0 && !source.error;
    const { text, root } = empty ? { text: "", root: null } : await packagesText(source, arch);
    const count = await getParser().catalog("load", [source.key, undefined, root, arch], text);
    loaded.set(source.key, { sig, count, error: null });
  } catch (e) {
    // Keep what the worker had (if anything) and say why on the source's Sections page.
    loaded.set(source.key, { sig, count: loaded.get(source.key)?.count ?? 0, error: e?.message || String(e) });
  }
}

async function run() {
  const arch = getArch();
  const sources = await getBackend().sources();
  const keys = new Set(sources.map((s) => s.key));
  for (const key of [...loaded.keys()]) {
    if (!keys.has(key)) {
      loaded.delete(key);
      await getParser().catalog("remove", [key]);
    }
  }
  let reloaded = false;
  await Promise.all(sources.map((s) => {
    const sig = signature(s, arch);
    if (loaded.get(s.key)?.sig === sig) return null;
    reloaded = true;
    return loadSource(s, arch, sig);
  }));
  if (reloaded) await recordSeen();
  return sources;
}

// Loads whatever changed since the last call (new, removed or refreshed sources, or a new arch). Calls made
// while one runs share it.
function ensure() {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

let first = null; // the first ensure, so search keystrokes don't each re-read the source list
const ready = () => (first ??= ensure());
const ask = async (op, args) => {
  await (running ?? ready());
  return getParser().catalog(op, args);
};

export const catalog = {
  ensure: () => (first = ensure()),
  status: (key) => loaded.get(key) ?? null,
  sections: (key = ALL) => ask("sections", [key]),
  list: (key = ALL, section = ALL) => ask("list", [key, section]),
  search: (q) => ask("search", [q]),
  author: (name) => ask("author", [name]),
  package: (id, key = ALL) => ask("package", [id, key]),
  has: (names) => ask("has", [names]),
  // The Changes tab: [{ seen, rows: [{ ...row, change: "new" | "updated" }] }], newest first (core/changes.js).
  changes: async () => {
    const rows = await ask("list", [ALL, ALL]);
    const store = await seen();
    return store ? changeGroups(await store.all(), rows) : [];
  },
  // Called after a refresh filed something new; returns unsubscribe.
  onChange: (f) => { changeListeners.add(f); return () => changeListeners.delete(f); },
};
