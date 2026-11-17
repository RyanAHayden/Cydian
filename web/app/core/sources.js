// The source list: defaults, the Add Source check, refreshing a source's package count, and the IndexedDB store
// the list lives in. Shared by the site and the app: everything that touches the network goes through a backend
// (backend-http.js or backend-native.js), which only needs these calls:
//
//   backend.packages(dir) -> { text, source }  the Packages index in a repo directory (.xz/.bz2/.gz/plain)
//   backend.text(url)     -> string
//   backend.fetch(url)    -> Response
//
// and throws errors with a `code` (BackendError: bad_url, refused, too_large, timeout, upstream, not_found,
// network, rate_limited). Cydia's behaviour this follows: docs/cydia.md, "Fetching a source" and "Sources tab".
import { repoLayout, parseRelease, parseControl, matchesArch, DEFAULT_ARCH } from "./apt.js";

// A source: { key, uri, dist, components, name?, origin?, depiction?, count?, updated?, error? }. `name` is ours
// (the defaults), `origin` comes from the repo's Release; the row shows the first there is, else the host.
// `depiction` is the Release's Depiction: template (see releaseDepiction), null when the Release has none.
export const DEFAULT_SOURCES = [
  { name: "Telesphoreo", uri: "http://apt.saurik.com/", dist: "ios/1800.00", components: ["main"] },
  { name: "BigBoss", uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] },
  { name: "Chariz", uri: "https://repo.chariz.com/", dist: "./", components: [] },
  { name: "Havoc", uri: "https://havoc.app/", dist: "./", components: [] },
  { name: "Procursus", uri: "https://apt.procurs.us/", dist: "1800", components: ["main"] },
].map((s) => ({ ...s, key: sourceKey(s) }));

// Cydia's key, `deb:<URI>:<dist>`.
export function sourceKey({ uri, dist }) {
  return `deb:${uri}:${dist || "./"}`;
}

// Cydia's alert texts (docs/cydia.md "UI strings"). `kind`: invalid_url, not_repository, verification.
export const ALERTS = {
  invalid_url: ["Invalid URL", "That is not a valid source URL. Please check it and try again."],
  not_repository: ["Did not Find Repository", "The indicated repository could not be found. This could be because "
    + "you are trying to add a legacy Installer repository (these are not supported). Also, this interface is only "
    + "capable of working with exact repository URLs."],
  verification: ["Verification Error", ""],
};

export class SourceError extends Error {
  constructor(kind, message, code) {
    super(message || ALERTS[kind]?.[1] || kind);
    this.name = "SourceError";
    this.kind = kind;
    this.title = ALERTS[kind]?.[0] ?? "Error";
    if (code) this.code = code;
  }
}

// What the user typed -> the repo URL with a trailing slash, or SourceError("invalid_url"). Cydia's
// VerifySource() wants `(http(s?)://|file:///)[^# ]*`; file:/// can't be fetched by either backend, so only
// http(s). Unlike Cydia, a bare host ("repo.example.com") gets https:// in front: that's how repos are shared now.
export function normalizeSourceUrl(input) {
  let s = String(input ?? "").trim();
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  if (!/^https?:\/\/[^#\s/?]+[^#\s]*$/i.test(s)) throw new SourceError("invalid_url");
  let u;
  try { u = new URL(s); } catch { throw new SourceError("invalid_url"); }
  if (u.search || u.username || u.password) throw new SourceError("invalid_url");
  return u.href.replace(/\/*$/, "/");
}

// Where the source's Release and CydiaIcon.png live: the flat dir, or URI/dists/<dist>/.
export const sourceBase = (source) => repoLayout(source).base;
export const sourceIconUrl = (source) => sourceBase(source) + "CydiaIcon.png";

export function displayName(source) {
  if (source.name) return source.name;
  if (source.origin) return source.origin;
  try { return new URL(source.uri).hostname.toLowerCase(); } catch { return source.uri; }
}

// Cydia's order: names that start with a letter first, then a compare without case or diacritics.
export function sortSources(list) {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const letter = (s) => /^\p{L}/u.test(displayName(s));
  return [...list].sort((a, b) => (letter(b) - letter(a)) || collator.compare(displayName(a), displayName(b)));
}

// The repo answered, but not with this file: try the next name. Anything else (refused, timeout, network, too
// large, rate limited) ends the check: asking again won't help.
const missing = (e) => e?.code === "upstream" || e?.code === "not_found";

function verificationError(e) {
  return new SourceError("verification", e?.message || String(e), e?.code);
}

// A Release (or InRelease) file, not an HTML page the host sent for any path.
function looksLikeRelease(text) {
  if (/^\s*</.test(text)) return false;
  const r = parseRelease(text);
  return Boolean(r.origin || r.label || r.suite || r.codename || r.architectures.length || Object.keys(r.hashes).length);
}

const MAGIC = {
  "Packages.zst": [0x28, 0xb5, 0x2f, 0xfd],
  "Packages.lzma": [0x5d, 0x00, 0x00],
};

async function hasMagic(res, magic) {
  const head = new Uint8Array(await res.arrayBuffer(), 0);
  return magic.every((b, i) => head[i] === b);
}

// Counts the packages in a Packages text that install on `arch`. Pass `count` (core/parser.js's, which runs in
// the worker) to keep big lists off the UI thread; this inline one is the fallback.
function countInline(text, arch) {
  return parseControl(text).filter((s) => s.package && matchesArch(s, arch)).length;
}

async function releaseOf(backend, base) {
  for (const name of ["Release", "InRelease"]) {
    try {
      const text = await backend.text(base + name);
      if (looksLikeRelease(text)) return parseRelease(text);
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  return null;
}

// The Add Source check. Cydia HEADs only Packages.bz2 and .gz, so it turns away repos that ship .xz or .zst
// alone; this accepts a flat repo if any of Packages(.xz/.bz2/.gz) (one backend.packages call: the server or
// the app tries each), Release/InRelease, Packages.zst or Packages.lzma is there. Returns the source to save,
// with its package count when the index could be read (null for .zst/.lzma-only repos), or throws SourceError:
// invalid_url, not_repository, or verification (with the backend's `code`, e.g. "refused" by the proxy).
export async function verifySource(backend, input, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  const uri = normalizeSourceUrl(input);
  const source = { uri, dist: "./", components: [] };
  source.key = sourceKey(source);
  let text = null;
  let release = null;
  let found = false;
  try {
    text = (await backend.packages(uri)).text;
    found = true;
  } catch (e) {
    if (!missing(e)) throw verificationError(e);
  }
  try {
    release = await releaseOf(backend, uri);
  } catch (e) {
    if (!found) throw verificationError(e);
  }
  found ||= Boolean(release);
  for (const name of Object.keys(MAGIC)) {
    if (found) break;
    try {
      found = await hasMagic(await backend.fetch(uri + name), MAGIC[name]);
    } catch (e) {
      if (!missing(e)) throw verificationError(e);
    }
  }
  if (!found) throw new SourceError("not_repository");
  if (release?.origin) source.origin = release.origin;
  if (release) source.depiction = release.fields.depiction || null;
  source.count = text == null ? null : await count(text, arch);
  source.updated = Date.now();
  return source;
}

// A package's fallback depiction: the source's Release Depiction: template with every `*` replaced by the
// package id (Cydia's `Package -depiction`, docs/cydia.md "Package page and depictions"). Only http(s) URLs
// count; anything else (or no template) is null. The package's own Depiction: always wins over this.
export function releaseDepiction(source, id) {
  const tpl = String(source?.depiction ?? "").trim();
  if (!tpl || !id) return null;
  const url = tpl.split("*").join(id);
  return /^https?:\/\//i.test(url) ? url : null;
}

// Refetches a source and returns the fields to store: { count, origin?, depiction?, updated, error }. `depiction`
// is only set when a Release was read, so a refresh that can't reach it keeps the stored template. A dist repo whose
// Release lists Architectures without ours has nothing for us (Telesphoreo is rootful only): count 0, no index
// fetched. Errors don't throw: they come back as `error` so one bad source doesn't stop the others.
export async function refreshSource(backend, source, { arch = DEFAULT_ARCH, count = countInline } = {}) {
  const layout = repoLayout(source, arch);
  const out = { updated: Date.now(), error: null };
  try {
    let release = null;
    try {
      release = await releaseOf(backend, layout.base);
    } catch (e) {
      if (!layout.flat) throw e;
    }
    if (release?.origin) out.origin = release.origin;
    if (release) out.depiction = release.fields.depiction || null;
    if (!layout.flat && release?.architectures.length && !release.architectures.includes(arch)) {
      out.count = 0;
      return out;
    }
    let total = 0;
    for (const file of layout.packages) {
      const dir = file.slice(0, -"Packages".length);
      total += await count((await backend.packages(dir)).text, arch);
    }
    out.count = total;
  } catch (e) {
    out.error = e?.message || String(e);
  }
  return out;
}

// ---- the store ----------------------------------------------------------------------------------------------

// IndexedDB: store "sources" (keyPath "key") and "meta". The defaults go in once, on the first open, so a source
// the user deletes stays deleted. The IDBFactory is passed in so node tests can hand it a fake.
export function openSourceStore({ indexedDB: idb = globalThis.indexedDB, name = "cydian-sources" } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const store = wrap(req.result);
      store.seed().then(() => resolve(store), reject);
    };
  });
}

function wrap(db) {
  const run = (storeName, mode, f) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = f(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  const store = {
    async seed() {
      if (await run("meta", "readonly", (s) => s.get("seeded"))) return;
      for (const s of DEFAULT_SOURCES) await run("sources", "readwrite", (st) => st.put(s));
      await run("meta", "readwrite", (s) => s.put({ key: "seeded", at: Date.now() }));
    },
    // Every source, in the Sources tab's order.
    list: async () => sortSources(await run("sources", "readonly", (s) => s.getAll())),
    get: (key) => run("sources", "readonly", (s) => s.get(key)),
    // Adds or replaces a whole source record.
    put: (source) => run("sources", "readwrite", (s) => s.put(source)).then(() => source),
    // Merges `fields` into the stored source; returns the new record, or undefined if it's gone.
    async update(key, fields) {
      const cur = await store.get(key);
      if (!cur) return undefined;
      return store.put({ ...cur, ...fields });
    },
    remove: (key) => run("sources", "readwrite", (s) => s.delete(key)).then(() => undefined),
    close: () => db.close(),
  };
  return store;
}

// The source-list calls every backend exposes (docs/native.md): `sources()`, `addSource(input)`,
// `removeSource(key)`, `refreshSources(onEach)`. Both backends mix these in over their own fetch calls, so the
// list lives on the device either way. `opts`: { indexedDB, arch: () => string, count }.
export function sourceCalls(backend, opts = {}) {
  let opened = null;
  const store = () => (opened ??= openSourceStore(opts));
  const arch = () => (typeof opts.arch === "function" ? opts.arch() : opts.arch) || DEFAULT_ARCH;
  const count = opts.count;
  return {
    sources: async () => (await store()).list(),
    // Checks the repo, then saves it. Throws SourceError (see verifySource). An already-listed source is
    // refreshed in place rather than added twice.
    async addSource(input) {
      const s = await verifySource(backend, input, { arch: arch(), count });
      const db = await store();
      const cur = await db.get(s.key);
      return db.put(cur ? { ...cur, ...s } : s);
    },
    removeSource: async (key) => (await store()).remove(key),
    // Refreshes every source (all at once), saving each as it lands; onEach(source) sees the updated record.
    async refreshSources(onEach = () => {}) {
      const db = await store();
      const list = await db.list();
      return Promise.all(list.map(async (s) => {
        const fields = await refreshSource(backend, s, { arch: arch(), count });
        const next = await db.update(s.key, fields);
        if (next) onEach(next);
        return next;
      }));
    },
  };
}
