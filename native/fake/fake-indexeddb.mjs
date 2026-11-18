// An in-memory IndexedDB, just enough for core/sources.js openSourceStore and core/cache.js, for node tests of the
// app's backend (a copy of backend-native.test.js's, N4). SPDX-License-Identifier: GPL-3.0-or-later
export function fakeIndexedDB() {
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
              const request = (f) => {
                const r = {};
                later(() => { r.result = f(); later(() => tx.oncomplete?.()); });
                return r;
              };
              const write = (f) => { if (mode !== "readwrite") throw new Error("read-only"); return request(f); };
              tx.objectStore = () => ({
                get: (k) => request(() => structuredClone(s.rows.get(k))),
                getAll: () => request(() => [...s.rows.values()].map((v) => structuredClone(v))),
                put: (v) => write(() => { s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }),
                delete: (k) => write(() => { s.rows.delete(k); }),
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
