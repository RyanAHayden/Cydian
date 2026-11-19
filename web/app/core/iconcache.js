// B58: source icons kept on the device, so Sources and Manage show them at once instead of losing and reloading
// them on every visit and launch. One record per source key (core/sources.js sourceKey):
//
//   { key, url, type, bytes, at }   the icon (PNG or JPEG bytes, checked here too), the URL it came from, when
//   { key, none: true, at }          every place answered with no usable icon (404, not PNG/JPEG, too big)
//
// load(key, urls, onIcon) hands the stored icon to onIcon before any network, then refreshes in the background when
// the record is more than a day old (or came from a URL no longer on the list): a new icon goes to onIcon again; a
// failed refresh keeps the old one (and waits a day before asking again). A network failure (no answer at all)
// writes nothing for a source with no icon yet, so the next visit tries again; each source is refreshed at most once
// per session either way.
//
// fetchIcon(url) -> { bytes: Uint8Array } or throws an error with a `code` (backend-native.js iconBytes, the shell's
// net.icon: not_found, upstream, bad_type, too_large = the repo answered; anything else = it didn't).
export const ICON_MAX_AGE = 24 * 3600 * 1000;
export const ICON_MAX_BYTES = 256 * 1024;
const ANSWERED = new Set(["not_found", "upstream", "bad_type", "too_large"]);

// "image/png" | "image/jpeg" by the bytes' signature, else null (no SVG, no GIF, nothing else).
export function iconType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 4) return null;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

const same = (a, b) => a?.length === b?.length && a.every((v, i) => v === b[i]);

// store: { get(key) -> record | undefined, put(record) } (openIconStore below, or a Map-backed one in tests).
export function iconCache({ store, fetchIcon, now = () => Date.now(), maxAge = ICON_MAX_AGE }) {
  const inflight = new Map(); // key -> the running refresh
  const tried = new Set();    // keys refreshed this session

  async function get(key) {
    try { return (await store.get(key)) ?? null; } catch { return null; }
  }
  async function put(rec) {
    try { await store.put(rec); } catch { /* a full or broken store: shown this time, fetched again next time */ }
  }

  async function refresh(key, urls, old) {
    let answered = true;
    for (const url of urls) {
      let bytes;
      try { ({ bytes } = await fetchIcon(url)); } catch (e) {
        if (!ANSWERED.has(e?.code)) answered = false;
        continue;
      }
      const type = iconType(bytes);
      if (!type || bytes.length > ICON_MAX_BYTES) continue;
      const rec = { key, url, type, bytes, at: now() };
      await put(rec);
      return rec;
    }
    if (old?.bytes) {
      // The old icon stays. Asked again in a day when every place answered; next session when none did.
      if (answered) await put({ ...old, at: now() });
      return old;
    }
    if (answered && urls.length) {
      const rec = { key, none: true, at: now() };
      await put(rec);
      return rec;
    }
    return null;
  }

  const stale = (rec, urls) => !rec || now() - rec.at >= maxAge || now() < rec.at || (rec.bytes && !urls.includes(rec.url));

  // The icon record for key (null: none known), after onIcon has seen the stored one and, when refreshed, the new one.
  async function load(key, urls, onIcon = () => {}) {
    const list = (urls ?? []).filter(Boolean);
    const rec = await get(key);
    if (rec?.bytes) onIcon(rec);
    if (!stale(rec, list) || tried.has(key)) return rec;
    if (!inflight.has(key)) {
      tried.add(key);
      inflight.set(key, refresh(key, list, rec).finally(() => inflight.delete(key)));
    }
    const next = await inflight.get(key);
    if (next?.bytes && !(rec?.bytes && same(next.bytes, rec.bytes) && next.url === rec.url)) onIcon(next);
    return next;
  }

  return { load };
}

// The records in IndexedDB (database ifizbox-icons, store icons, keyPath key). Rejects without IndexedDB.
export function openIconStore({ indexedDB: idb = globalThis.indexedDB, name = "ifizbox-icons" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("icons")) db.createObjectStore("icons", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, f) => new Promise((ok, fail) => {
        const tx = db.transaction("icons", mode);
        const r = f(tx.objectStore("icons"));
        r.onerror = () => fail(r.error);
        tx.oncomplete = () => ok(r.result);
        tx.onerror = () => fail(tx.error);
      });
      resolve({
        get: (key) => run("readonly", (s) => s.get(key)),
        put: (rec) => run("readwrite", (s) => s.put(rec)),
      });
    };
  });
}
