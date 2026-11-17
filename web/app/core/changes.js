// The Changes tab's memory: when each package version was first seen, kept on the device in IndexedDB, like
// Cydia's metadata.cb0 (docs/cydia.md "Changes and metadata.cb0"). Pure JS plus a thin IndexedDB wrapper; the
// IDBFactory is passed in so node tests can hand it a fake.
//
// One record per (repo, package, version): { k, key, id, version, first }. Every catalog reload ("refresh")
// stamps `now` once and files every triple it hasn't seen before under it, so a repeat refresh adds nothing.
// Per package, Cydia's {first, last} come out as minimums over repos, so a package mirrored on two repos isn't
// new twice:
//   first = the earliest record of the package (any repo, any version): when it was first seen;
//   last  = the earliest record of its current candidate version: when that version showed up.
// The tab groups packages by `last` (a bumped version moves the package to the refresh that found it), newest
// first, under "New at <date>", and drops the oldest group: that is everything from the first load, so a fresh
// install doesn't list the whole archive. A row is "updated" when last > first, else "new" (Cydian's addition:
// Cydia doesn't mark rows).
//
//   const store = await openSeenStore();
//   await recordRefresh(store, [[key, id, version], ...], Date.now())  -> number of new records
//   changeGroups(await store.all(), rows)                              -> [{ seen, rows: [{ ...row, change }] }]

const STORE = "seen";

export const recordKey = (key, id, version) => `${key}\u0000${id}\u0000${version}`;

// The records a refresh at `now` adds: every (key, id, version) in `current` not in `known` (a Set of recordKey).
export function newRecords(known, current, now) {
  const out = [];
  const added = new Set();
  for (const [key, id, version] of current) {
    const k = recordKey(key, id, version ?? "");
    if (known.has(k) || added.has(k)) continue;
    added.add(k);
    out.push({ k, key, id, version: version ?? "", first: now });
  }
  return out;
}

// id -> { first, byVersion: Map(version -> earliest first) }.
export function packageTimes(records) {
  const times = new Map();
  for (const r of records) {
    let t = times.get(r.id);
    if (!t) times.set(r.id, (t = { first: r.first, byVersion: new Map() }));
    if (r.first < t.first) t.first = r.first;
    const v = t.byVersion.get(r.version);
    if (v === undefined || r.first < v) t.byVersion.set(r.version, r.first);
  }
  return times;
}

// The Changes list: `rows` are the catalog's rows (All Sources, one per id, the candidate version). Groups are
// newest first; within a group rows keep their order (the catalog's: by name). `dropOldest`: Cydia's rule.
export function changeGroups(records, rows, { dropOldest = true } = {}) {
  const times = packageTimes(records);
  const groups = new Map(); // seen -> rows
  for (const row of rows) {
    const t = times.get(row.id);
    const last = t?.byVersion.get(row.version ?? "");
    if (last === undefined) continue; // not recorded yet: the next refresh files it
    const item = { ...row, change: last > t.first ? "updated" : "new", seen: last };
    if (!groups.has(last)) groups.set(last, []);
    groups.get(last).push(item);
  }
  const list = [...groups].sort((a, b) => b[0] - a[0]).map(([seen, rs]) => ({ seen, rows: rs }));
  if (dropOldest) list.pop();
  return list;
}

// "New at Nov 17, 2026, 12:36:22 PM": Cydia's medium date and medium time, in the user's locale.
export function groupTitle(seen, locale) {
  return `New at ${new Date(seen).toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" })}`;
}

// Files a refresh: one `now` for every triple it saw. Returns how many records it added.
export async function recordRefresh(store, current, now = Date.now()) {
  const known = new Set(await store.keys());
  const add = newRecords(known, current, now);
  if (add.length) await store.putMany(add);
  return add.length;
}

export function openSeenStore({ indexedDB: idb = globalThis.indexedDB, name = "cydian-changes" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "k" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(wrap(req.result));
  });
}

function wrap(db) {
  const run = (mode, f) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = f(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  return {
    all: () => run("readonly", (s) => s.getAll()),
    keys: () => run("readonly", (s) => s.getAllKeys()),
    // One transaction for the whole refresh: BigBoss alone is ~30k records on the first load.
    putMany: (records) => run("readwrite", (s) => { for (const r of records) s.put(r); return null; }).then(() => undefined),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
    close: () => db.close(),
  };
}
