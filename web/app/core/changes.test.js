import { test } from "node:test";
import assert from "node:assert/strict";
import { openSeenStore, recordRefresh, changeGroups, newRecords, recordKey, groupTitle } from "./changes.js";

// The slice of IndexedDB changes.js uses, in memory: open with upgradeneeded, one keyPath store, async requests,
// several requests per transaction, completion after the last one.
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  return {
    open(name) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) {
          const stores = new Map();
          db = {
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore(n, { keyPath }) { stores.set(n, { keyPath, rows: new Map() }); },
            transaction(n, mode) {
              const s = stores.get(n);
              const tx = {};
              let pending = 0;
              const request = (f) => {
                const r = {};
                pending++;
                later(() => { r.result = f(); if (--pending === 0) later(() => tx.oncomplete?.()); });
                return r;
              };
              tx.objectStore = () => ({
                put: (v) => { if (mode !== "readwrite") throw new Error("read-only"); return request(() => { s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }); },
                getAll: () => request(() => [...s.rows.values()].map((v) => structuredClone(v))),
                getAllKeys: () => request(() => [...s.rows.keys()].sort()),
                clear: () => request(() => { s.rows.clear(); }),
              });
              return tx;
            },
            close() {},
          };
          dbs.set(name, db);
        }
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

const DAY = 86400000;
const row = (id, version, key = "r1") => ({ id, name: id, version, key, short: "", section: "Tweaks" });

test("changes: a refresh with a bumped version files it under today, and a repeat refresh doesn't", async () => {
  const indexedDB = fakeIndexedDB();
  const store = await openSeenStore({ indexedDB });
  const day1 = Date.UTC(2026, 10, 16, 9, 0, 0);
  const today = day1 + DAY;

  // First load: everything is seen at day1, and that oldest group is dropped (Cydia's rule).
  assert.equal(await recordRefresh(store, [["r1", "a", "1.0"], ["r1", "b", "2.0"]], day1), 2);
  assert.deepEqual(changeGroups(await store.all(), [row("a", "1.0"), row("b", "2.0")]), []);

  // Today's refresh: a's version is bumped and c is new; both file under today, b stays put.
  assert.equal(await recordRefresh(store, [["r1", "a", "1.1"], ["r1", "b", "2.0"], ["r1", "c", "0.1"]], today), 2);
  const rows = [row("a", "1.1"), row("b", "2.0"), row("c", "0.1")];
  let groups = changeGroups(await store.all(), rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].seen, today);
  assert.deepEqual(groups[0].rows.map((r) => [r.id, r.change]), [["a", "updated"], ["c", "new"]]);
  assert.match(groupTitle(today, "en-US"), /^New at Nov 1[78], 2026/);

  // A repeat refresh (later the same day, nothing changed) records nothing and moves nothing.
  assert.equal(await recordRefresh(store, [["r1", "a", "1.1"], ["r1", "b", "2.0"], ["r1", "c", "0.1"]], today + 3600000), 0);
  groups = changeGroups(await store.all(), rows);
  assert.deepEqual(groups.map((g) => g.seen), [today]);

  // Reopening the database keeps it all (it lives on the device).
  store.close();
  const again = await openSeenStore({ indexedDB });
  assert.equal((await again.all()).length, 4);
});

test("changes: newest group first; the oldest is dropped; dropOldest off keeps it", () => {
  const records = [
    ...newRecords(new Set(), [["r1", "a", "1"], ["r1", "b", "1"]], 100),
    ...newRecords(new Set(), [["r1", "c", "1"]], 200),
    ...newRecords(new Set(), [["r1", "d", "1"], ["r1", "b", "2"]], 300),
  ];
  const rows = [row("a", "1"), row("b", "2"), row("c", "1"), row("d", "1")];
  assert.deepEqual(changeGroups(records, rows).map((g) => [g.seen, g.rows.map((r) => r.id)]), [[300, ["b", "d"]], [200, ["c"]]]);
  assert.deepEqual(changeGroups(records, rows, { dropOldest: false }).map((g) => g.seen), [300, 200, 100]);
});

test("changes: a package mirrored on a second repo isn't new again; first/last are minimums over repos", () => {
  const known = new Set();
  const r1 = newRecords(known, [["r1", "a", "1"], ["r1", "z", "1"]], 100);
  r1.forEach((r) => known.add(r.k));
  // A second repo carrying a (same version) and a newer a on a third: only the newer version moves it.
  const r2 = newRecords(known, [["r2", "a", "1"]], 200);
  const r3 = newRecords(known, [["r3", "a", "2"]], 300);
  const records = [...r1, ...r2, ...r3];
  assert.deepEqual(changeGroups(records, [row("a", "1", "r2")], { dropOldest: false }).map((g) => g.seen), [100]);
  const g = changeGroups(records, [row("a", "2", "r3")], { dropOldest: false });
  assert.deepEqual(g.map((x) => [x.seen, x.rows[0].change]), [[300, "updated"]]);
});

test("changes: duplicate triples in one refresh make one record; unrecorded rows are left out", () => {
  const add = newRecords(new Set([recordKey("r1", "a", "1")]), [["r1", "a", "1"], ["r1", "b", "1"], ["r1", "b", "1"]], 5);
  assert.deepEqual(add.map((r) => r.id), ["b"]);
  assert.deepEqual(changeGroups(add, [row("b", "1"), row("x", "1")], { dropOldest: false })[0].rows.map((r) => r.id), ["b"]);
});

test("changes: no IndexedDB is a rejection, not a throw", async () => {
  await assert.rejects(openSeenStore({ indexedDB: null }), /not available/);
});
