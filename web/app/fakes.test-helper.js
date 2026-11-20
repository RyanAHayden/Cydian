// Shared fakes for the frontend's node --test files: a small DOM, the native bridge, a Storage and an IndexedDB.
// Import from here instead of copying one into a test. Test-only: nothing in the app imports this file.
// SPDX-License-Identifier: GPL-3.0-or-later
export { fakeDocument, fakePage, tick } from "./nav/fakedom.test-helper.js";

// The native bridge (backend-native.js's `native`): answers[method] is the reply, an Error to throw, or a
// function (params, onEvent) => reply. Every call is recorded in `calls` as { method, params }.
export function fakeNative(answers = {}, { mode = "sideload" } = {}) {
  const calls = [];
  return {
    mode, calls,
    async call(method, params, onEvent) {
      calls.push({ method, params });
      const a = answers[method];
      if (a instanceof Error) throw a;
      return typeof a === "function" ? a(params, onEvent) : a ?? null;
    },
  };
}

// localStorage in memory, seeded from `init`. The Map is exposed as both `m` and `map` (the names the old copies
// used) so a test can look inside.
export function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    m, map: m,
  };
}

// An in-memory IndexedDB: open (upgrade on first open), object stores with a keyPath, and get, getAll, getAllKeys
// (sorted), put, delete and clear. Writes outside a "readwrite" transaction throw, as the real one fails them. A
// transaction completes once its last request has run. The db keeps `stores` and `version`, and `closed` after
// close(), for tests that look inside.
export function fakeIndexedDB() {
  const dbs = new Map();
  const later = (f) => setTimeout(f, 0);
  return {
    open(name, version) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) {
          const stores = new Map();
          db = {
            stores, version,
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
              const write = (f) => { if (mode !== "readwrite") throw new Error("read-only"); return request(f); };
              tx.objectStore = () => ({
                get: (k) => request(() => structuredClone(s.rows.get(k))),
                getAll: () => request(() => [...s.rows.values()].map((v) => structuredClone(v))),
                getAllKeys: () => request(() => [...s.rows.keys()].sort()),
                put: (v) => write(() => { s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }),
                delete: (k) => write(() => { s.rows.delete(k); }),
                clear: () => write(() => { s.rows.clear(); }),
              });
              return tx;
            },
            close() { db.closed = true; },
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
