// The screens' handle on the package catalog. The catalog itself (core/catalog.js) lives in the parse worker;
// this file feeds it every source's Packages index and forwards the screens' questions to it.
//
//   await catalog.ensure();                    // every source loaded for getArch(), at most once per refresh
//   catalog.sections(key)  catalog.list(key, section)  catalog.search(q)  catalog.author(name)
//   catalog.package(id, key)  catalog.has(names)       // all promises; key "*" = All Sources
//   catalog.changes()  catalog.onChange(f)             // the Changes tab (core/changes.js)
//   catalog.setHiddenAuthors(names)                    // Hide by Author (F104): sent like the hidden sections
//   catalog.setHidden(names)                           // Section Visibility: sent to the worker before the next question
//   catalog.setDevice(device, { filter })              // Works on my phone (F17, device.js): likewise
//   catalog.installed()  catalog.upgrades(holds)       // dpkg's status file (F7): rows or null; { available, ignored }
//   catalog.altSource(key)                     // an AltStore source's page data (F9, core/altstore.js), or null
//   catalog.setStatus(text)  catalog.reloadInstalled() // the site's upload (kept on the device); the app re-reads dpkg
//
// Cydia's model: the package lists change when the sources are refreshed, not on every visit. A source's
// Packages text is kept in IndexedDB (core/cache.js) and reused while it is newer than the source's last
// refresh (`updated`, set by the Sources tab's Refresh or Add); after a refresh it is fetched again. Package
// lists go through filterArch (core/apt.js matchesArch, in the worker) with backend.js getArch().
import { getBackend, getParser, getArch } from "./backend.js";
import { repoLayout } from "./core/apt.js";
import { openIndexCache } from "./core/cache.js";
import { ALL, freshLists } from "./core/catalog.js";
import { openSeenStore, recordRefresh, dayGroups } from "./core/changes.js";
import { looksLikeStatus } from "./core/installed.js";
import { isAltKey } from "./core/altstore.js";

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

// F9: an AltStore source's JSON, cached like a Packages text (reused while newer than the source's refresh).
async function altText(source) {
  const db = await indexCache();
  const cacheKey = `altstore:${source.uri}`;
  try {
    const hit = db && (await db.get(cacheKey));
    if (hit && hit.savedAt >= (source.updated ?? 0)) return hit.value;
  } catch {
    // a broken cache only costs a fetch
  }
  const text = await getBackend().text(source.uri);
  db?.put(cacheKey, text).catch(() => {});
  return text;
}

async function loadSource(source, arch, sig) {
  if (isAltKey(source.key)) {
    // F16a: a source only its own app can read (an encrypted GBox one) has no apps to load: its page says why.
    if (source.unsupported) {
      await getParser().catalog("remove", [source.key]);
      loaded.set(source.key, { sig, count: 0, error: source.unsupported });
      return;
    }
    // The candidate is the newest version this phone's iOS runs (core/altstore.js), so the iOS is in the signature.
    // F16a: the record's `format` (Scarlet, ESign, GBox…) picks the reader in the worker.
    try {
      const count = await getParser().catalog("loadAlt", [source.key, undefined, device?.device.ios ?? null, source.format ?? null], await altText(source));
      loaded.set(source.key, { sig, count, error: null });
    } catch (e) {
      loaded.set(source.key, { sig, count: loaded.get(source.key)?.count ?? 0, error: e?.message || String(e) });
    }
    return;
  }
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
  // F37: a phone without a jailbreak sees AltStore sources only; APT ones aren't fetched until the type changes.
  const appsOnly = device?.device.jailbreak === "none";
  await Promise.all(sources.map((s) => {
    if (appsOnly && !isAltKey(s.key)) return null;
    const sig = signature(s, arch) + (isAltKey(s.key) ? `|${device?.device.ios ?? ""}` : "");
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
// Section Visibility (F24): the hidden section names, sent to the worker ahead of the next question, so the
// worker's catalog filters every list, Search and Changes with them (core/catalog.js setHidden).
let hidden = [];
let hiddenSent = true;
function setHidden(names) {
  const next = [...new Set(names ?? [])].sort();
  if (JSON.stringify(next) === JSON.stringify(hidden)) return;
  hidden = next;
  hiddenSent = false;
  for (const f of changeListeners) f(); // the Changes tab redraws without the hidden sections
}

// Hide by Author (F104): the hidden author names, sent like the hidden sections (core/catalog.js setHiddenAuthors).
let hiddenAuthors = [];
let hiddenAuthorsSent = true;
function setHiddenAuthors(names) {
  const next = [...new Set(names ?? [])].sort();
  if (JSON.stringify(next) === JSON.stringify(hiddenAuthors)) return;
  hiddenAuthors = next;
  hiddenAuthorsSent = false;
  for (const f of changeListeners) f();
}

// Works on my phone (F17): the device every row is judged for, and whether what can't work is left out. Sent like
// the hidden sections, ahead of the next question (core/catalog.js setDevice).
let device = null;
let deviceSent = true;
function setDevice(next, { filter = true } = {}) {
  const v = next ? { device: { ios: next.ios ?? null, jailbreak: next.jailbreak }, filter: Boolean(filter) } : null;
  if (JSON.stringify(v) === JSON.stringify(device)) return;
  // F37: leaving Not Jailbroken: the APT sources skipped so far load before the next question.
  if (device?.device.jailbreak === "none" && v?.device.jailbreak !== "none") first = null;
  device = v;
  deviceSent = false;
  for (const f of changeListeners) f();
}

// ---- Installed (F7): dpkg's status file, parsed in the worker beside the catalog. In the app the native
// backend reads it (N3: `cydianNative.dpkgStatus()` resolves to the text of /var/lib/dpkg/status, or
// /var/jb/var/lib/dpkg/status rootless; core/installed.js STATUS_PATHS); on the site the visitor uploads it and
// it is kept in IndexedDB on the device, never sent anywhere. ----
const STATUS_KEY = "dpkg:status";
let statusSent = null; // Promise of the worker's installed count (-1: no status file), once sent

export const statusSource = () => (typeof globalThis.cydianNative?.dpkgStatus === "function" ? "native" : "upload");

async function statusText() {
  if (statusSource() === "native") return (await globalThis.cydianNative.dpkgStatus()) ?? null;
  const db = await indexCache();
  return (db && (await db.get(STATUS_KEY))?.value) ?? null;
}

function sendStatus() {
  return (statusSent ??= statusText().catch(() => null)
    .then((text) => getParser().catalog("setInstalled", [], text ?? undefined)));
}

// The site's upload: checked, kept on the device, then handed to the worker. Resolves to the installed count.
async function setStatus(text) {
  if (!looksLikeStatus(text)) throw new Error("That isn't a dpkg status file. Choose the file named status from /var/jb/var/lib/dpkg/ (rootless) or /var/lib/dpkg/.");
  const db = await indexCache();
  await db?.put(STATUS_KEY, text);
  statusSent = getParser().catalog("setInstalled", [], text);
  const n = await statusSent;
  for (const f of changeListeners) f();
  return n;
}

// The app: read dpkg's status again (after an install or remove).
async function reloadInstalled() {
  statusSent = null;
  await sendStatus();
  for (const f of changeListeners) f();
}

const ask = async (op, args) => {
  await (running ?? ready());
  await sendStatus();
  if (!hiddenSent) {
    hiddenSent = true;
    await getParser().catalog("setHidden", [hidden]);
  }
  if (!hiddenAuthorsSent) {
    hiddenAuthorsSent = true;
    await getParser().catalog("setHiddenAuthors", [hiddenAuthors]);
  }
  if (!deviceSent) {
    deviceSent = true;
    await getParser().catalog("setDevice", device ? [device.device, { filter: device.filter }] : [null]);
  }
  return getParser().catalog(op, args);
};

export const catalog = {
  ensure: () => (first = ensure()),
  status: (key) => loaded.get(key) ?? null,
  sections: (key = ALL, opts) => ask("sections", opts ? [key, opts] : [key]),
  setHidden,
  setHiddenAuthors,
  setDevice,
  list: (key = ALL, section = ALL) => ask("list", [key, section]),
  search: (q, filters) => ask("search", filters ? [q, filters] : [q]), // F35: core/catalog.js search filters
  author: (name) => ask("author", [name]),
  categories: () => ask("categories"), // F46: Home's Browse (core/catalog.js)
  browse: (category) => ask("browse", [category]),
  popular: (opts) => ask("popular", opts ? [opts] : []),
  // F124, Browse's lists (core/catalog.js): Free Apps / Tweaks / Themes, Featured (refs [{ key, id }]), and New or
  // Recently Updated (`kind` "new" | "updated") from the Changes tab's records; with no IndexedDB, from the
  // sources' own version dates only.
  free: (kind) => ask("free", [kind]),
  featured: (refs) => ask("featured", [refs]),
  fresh: async (kind, now = Date.now()) => {
    const rows = await ask("list", [ALL, ALL]);
    const store = await seen();
    const records = store ? await store.all()
      : (await ask("versions", [])).filter((v) => Number.isFinite(v[3])).map(([, id, version, date]) => ({ id, version, first: date, date }));
    return freshLists(records, rows, { now })[kind] ?? [];
  },
  package: (id, key = ALL) => ask("package", [id, key]),
  history: (id, key = ALL) => ask("history", [id, key]), // F29: Version History (core/catalog.js history)
  altSource: (key) => ask("altSource", [key]),
  has: (names) => ask("has", [names]),
  deps: (id, key = ALL) => ask("deps", [id, key]), // F18: plain-language dependency problems (core/deps.js)
  aptProblems: (output) => ask("aptProblems", [output]), // N4: apt's refusal in F18's words (Confirm sheet)
  queueInfo: (ids) => ask("queueInfo", [ids]), // N4: { id: { name, restart } } for the install queue
  // The Changes tab (F51): the last 7 days, [{ day, rows: [{ ...row, change: "new" | "updated", seen }] }],
  // newest day first (core/changes.js dayGroups).
  changes: async (now = Date.now()) => {
    const rows = await ask("list", [ALL, ALL]);
    const store = await seen();
    return store ? dayGroups(await store.all(), rows, { now }) : [];
  },
  // The installed packages as rows (each with `installed`, its version), or null before a status file came.
  installed: () => ask("installed", []),
  // { available: [row], ignored: [row] }: installed packages with a newer version on a source (core/installed.js);
  // `holds` (Ignored Upgrades) go under ignored, and so do the status file's dpkg holds, except in the app, where
  // `holds` is dpkg's own list already (core/settings.js holds.sync) and newer than the file.
  upgrades: (holds = []) => ask("upgrades", [holds, { dpkgHolds: statusSource() !== "native" }]),
  setStatus,
  reloadInstalled,
  // Whether there is a status file at all, without loading the sources (the launch badge waits on it).
  hasStatus: () => statusText().then((t) => t != null, () => false),
  statusSource,
  // Called after a refresh filed something new, or the installed list changed; returns unsubscribe.
  onChange: (f) => { changeListeners.add(f); return () => changeListeners.delete(f); },
};
