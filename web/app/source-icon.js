// B58: a source row's icon <img> (Sources, Manage > Sources, Recommended). With a backend that fetches icon bytes
// itself (backend-native.js iconBytes: the app, where ATS keeps <img> off http repos such as BigBoss), the icon comes
// from the device's icon cache (core/iconcache.js): shown at once from memory or IndexedDB, refreshed at most daily in
// the background, kept when a refresh fails. The bytes reach the page only as a blob: URL in this <img>, never as
// markup. Without iconBytes (the website, whose proxy and browser cache keep icons), or when the cache has nothing
// and the repo never answered, the <img> walks the URLs itself as before (backend.assetUrl).
import { iconCache, openIconStore } from "./core/iconcache.js";

let shared = null;   // { cache, backend }
const shown = new Map(); // key -> { url, src }: this session's blob: URLs, for a redraw with no wait at all

function cacheFor(backend, opts = {}) {
  if (!backend?.iconBytes) return null;
  if (shared?.backend === backend && !opts.store) return shared.cache;
  let storeP = null;
  const lazy = opts.store ?? {
    get: async (k) => (await (storeP ??= openIconStore())).get(k),
    put: async (r) => (await (storeP ??= openIconStore())).put(r),
  };
  const cache = iconCache({ store: lazy, fetchIcon: (u) => backend.iconBytes(u), ...(opts.now ? { now: opts.now } : {}) });
  if (!opts.store) shared = { cache, backend };
  return cache;
}

const sameBytes = (a, b) => a?.length === b?.length && a.every((v, i) => v === b[i]);

function blobSrc(key, rec) {
  const had = shown.get(key);
  if (had && had.url === rec.url && sameBytes(had.bytes, rec.bytes)) return had.src;
  // A changed icon gets a new blob: URL; the old one stays valid for rows still showing it (icons rarely change).
  const src = URL.createObjectURL(new Blob([rec.bytes], { type: rec.type }));
  shown.set(key, { url: rec.url, bytes: rec.bytes, src });
  return src;
}

// The plain way: each URL in turn through assetUrl, removed when none loads.
function walk(img, urls, backend) {
  const list = urls.map((u) => (backend?.assetUrl ? backend.assetUrl(u) : u));
  img.onerror = () => (list.length ? (img.src = list.shift()) : img.remove());
  if (list.length) img.src = list.shift();
  else img.remove();
}

// An <img> for the source `key` whose icon may be at `urls` (core/sources.js sourceIcons), in order. It gets the
// class "loaded" once it shows something (sources.css hides it until then, so the letter shows through).
// opts.store / opts.now: a stand-in store and clock (tests).
export function sourceIconImage(key, urls, backend, opts = {}) {
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  const list = (urls ?? []).filter(Boolean);
  const cache = key ? cacheFor(backend, opts) : null;
  if (!cache) {
    walk(img, list, backend);
    return img;
  }
  const mem = shown.get(key);
  if (mem) img.src = mem.src;
  const show = (rec) => { const src = blobSrc(key, rec); if (img.src !== src) img.src = src; };
  img.done = cache.load(key, list, show).then((rec) => {
    // Nothing known and nothing learned (the shell couldn't ask, or no answer yet): the old way, https only, as the
    // web view can't load http. A source known to have no icon stays a letter.
    if (!rec && !img.getAttribute("src")) walk(img, list.filter((u) => /^https:/i.test(u)), backend);
    return rec;
  }, () => null);
  return img;
}

// Tests: forget this session's blob: URLs and the shared cache.
export function resetSourceIcons() {
  for (const { src } of shown.values()) { try { URL.revokeObjectURL(src); } catch { /* not a blob: URL */ } }
  shown.clear();
  shared = null;
}
