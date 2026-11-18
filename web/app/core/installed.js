// Installed packages and their upgrades. The core takes dpkg's status file as text: on the site the visitor
// uploads it (kept on the device, catalog.js), in the app the native backend reads it (N3). Pure JS, no DOM, no
// I/O; the worker's catalog (core/catalog.js) holds the parsed list and answers `installed` and `upgrades`.
//
//   parseStatus(text)                         -> [pkg]: the installed packages, sorted by name
//   installedStanzas(text)                    -> [stanza]: their status stanzas, file order (the package page, F27)
//   findUpgrades(installed, candidateOf, holds, { dpkgHolds }) -> { available: [row], ignored: [row] }
//
// Cydia's rule (docs/cydia.md "Changes and metadata.cb0"): a package is upgradable when it is installed and its
// candidate (the newest version on any source) is newer than the installed one. Held packages (dpkg's `hold`
// selection, or Cydian's Ignored Upgrades list) go under Ignored Upgrades, not Available Upgrades.
import { parseControl, description, compareVersions } from "./apt.js";
import { sectionName, parseAuthor, compareNames } from "./catalog.js";

// Where dpkg keeps it: rootful, then rootless (Dopamine, palera1n rootless).
export const STATUS_PATHS = ["/var/lib/dpkg/status", "/var/jb/var/lib/dpkg/status"];

// dpkg's package states that leave the package's files on disk (dpkg(1) "package states"). `not-installed` and
// `config-files` don't: those stanzas are leftovers, not installed packages.
const ON_DISK = new Set(["installed", "half-installed", "unpacked", "half-configured", "triggers-awaited", "triggers-pending"]);

// "want flag state", e.g. "hold ok installed" -> { want: "hold", state: "installed" }.
export function parseStatusField(value) {
  const [want = "", , state = ""] = String(value ?? "").trim().split(/\s+/);
  return { want, state };
}

// One installed package, shaped like a catalog row (core/catalog.js) so the same lists draw it, plus `held`
// (dpkg's hold selection) and `state` (anything but "installed" means a broken install).
function installedRow(st) {
  const { want, state } = parseStatusField(st.status);
  const name = st.name || st.package;
  return {
    id: st.package, name, short: description(st).short, version: st.version ?? "", section: sectionName(st.section),
    icon: null, key: null, author: parseAuthor(st.author)?.name || parseAuthor(st.maintainer)?.name || "",
    held: want === "hold", state, essential: /^yes$/i.test(st.essential ?? ""),
  };
}

// The status stanzas of the packages dpkg has on disk, first stanza per package, in file order.
export function installedStanzas(text) {
  const out = [];
  const seen = new Set();
  for (const st of parseControl(text)) {
    if (!st.package || !st.version || seen.has(st.package)) continue;
    if (!ON_DISK.has(parseStatusField(st.status).state)) continue;
    seen.add(st.package);
    out.push(st);
  }
  return out;
}

// The packages dpkg has on disk, sorted by name. A file that isn't a status file (no Status fields) gives [].
// `stanzas` (installedStanzas' result) saves parsing the text again.
export function parseStatus(text, stanzas = installedStanzas(text)) {
  return stanzas.map(installedRow).sort(compareNames);
}

// Whether text looks like a dpkg status file: at least one stanza with Package and Status. For the upload, so a
// Packages file or a random text file is refused with a message instead of an empty Installed tab.
export function looksLikeStatus(text) {
  return parseControl(String(text ?? "").slice(0, 65536)).some((st) => st.package && st.status);
}

// `installed`: parseStatus rows. `candidateOf(id)`: the row of the newest version on any source (with `version`),
// or null. `holds`: Cydian's Ignored Upgrades (package ids). Each result row is the candidate's row with
// `installed` (the version on the device) added; both lists sorted by name. `dpkgHolds` off ignores the status
// file's hold flags: the app passes that, since there `holds` already is dpkg's list (apt-mark showhold, F22) and
// is newer than the status file it read.
export function findUpgrades(installed, candidateOf, holds = [], { dpkgHolds = true } = {}) {
  const ignoredIds = new Set(holds);
  const available = [];
  const ignored = [];
  for (const pkg of installed) {
    const cand = candidateOf(pkg.id);
    if (!cand || compareVersions(cand.version, pkg.version) <= 0) continue;
    const row = { ...cand, installed: pkg.version };
    ((dpkgHolds && pkg.held) || ignoredIds.has(pkg.id) ? ignored : available).push(row);
  }
  return { available: available.sort(compareNames), ignored: ignored.sort(compareNames) };
}

// ---- Apps installed without a jailbreak (F30) ----------------------------------------------------------------
// On the site and in the sideload build there is no dpkg to ask, so tapping Install on an app page (an AltStore
// app, screens/altstore.js) records it here, on the device (IndexedDB, nothing uploaded). The Installed tab lists
// the records newest first, marks the ones a source now has a newer version of, and Edit or a swipe removes one
// the user deleted from the phone. Jailbreak mode doesn't record: it reads dpkg's status file as above.
//
//   appRecord(app, now)                 -> { id, name, version, key, source, sourceName, icon, date }
//   recordInstall(store, app, now)      -> the record, put in the store (one per app id: a reinstall replaces it)
//   removeInstall(store, id)
//   appRows(records)                    -> newest first (then by name)
//   appUpgrades(rows, candidateOf)      -> each row with `upgrade`: the candidate's version when it is newer, else null
//   openAppStore({ indexedDB, name })   -> Promise of { all, put, remove }; memoryAppStore() is the same in memory
//   apps()                              -> the device's store, opened once; onAppsChange(f) after record/remove

export const APP_DB = "cydian-installed";
const APP_STORE = "apps";

const text = (v) => (v == null ? "" : String(v).trim());

export function appRecord(app, now = Date.now()) {
  const id = text(app?.id);
  if (!id) throw new Error("An app needs an id to be recorded");
  return {
    id, name: text(app.name) || id, version: text(app.version), key: app.key ?? null, source: text(app.source) || null,
    sourceName: text(app.sourceName) || null, icon: app.icon ?? null, date: now,
  };
}

export async function recordInstall(store, app, now = Date.now()) {
  const rec = appRecord(app, now);
  await store.put(rec);
  for (const f of appListeners) f();
  return rec;
}

export async function removeInstall(store, id) {
  await store.remove(id);
  for (const f of appListeners) f();
}

export function appRows(records) {
  return [...(records ?? [])].sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || compareNames(a, b));
}

// `candidateOf(id)`: the newest version on any source (a row with `version`), or null when no source has the app.
export function appUpgrades(rows, candidateOf) {
  return rows.map((r) => {
    const cand = candidateOf(r.id);
    const upgrade = cand?.version && r.version && compareVersions(cand.version, r.version) > 0 ? cand.version : null;
    return { ...r, upgrade };
  });
}

export function memoryAppStore(initial = []) {
  const m = new Map(initial.map((r) => [r.id, r]));
  return {
    all: async () => [...m.values()],
    put: async (rec) => { m.set(rec.id, rec); return rec; },
    remove: async (id) => { m.delete(id); },
  };
}

export function openAppStore({ indexedDB: idb = globalThis.indexedDB, name = APP_DB } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(APP_STORE)) db.createObjectStore(APP_STORE, { keyPath: "id" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, f) => new Promise((res, rej) => {
        const tx = db.transaction(APP_STORE, mode);
        const r = f(tx.objectStore(APP_STORE));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error ?? r?.error);
        tx.onabort = () => rej(tx.error ?? new Error("transaction aborted"));
      });
      resolve({
        all: () => run("readonly", (s) => s.getAll()),
        put: (rec) => run("readwrite", (s) => s.put(rec)).then(() => rec),
        remove: (id) => run("readwrite", (s) => s.delete(id)).then(() => undefined),
      });
    };
  });
}

let shared = null;
// Where IndexedDB is missing (Safari private mode can refuse it) the records last for this session only.
// The sideload app always lists itself, at the version it is (app.info), whatever was recorded: so Cydian's own
// updates show in Installed and Changes like any app's. (The jailbreak app reads dpkg, which already has it.)
export const apps = () => (shared ??= openAppStore().catch(() => memoryAppStore()).then(withSelf));

export const SELF_ID = "com.ryha.cydian";
let selfInfo = null;
function selfRecord(native = globalThis.cydianNative) {
  if (!native?.call) return Promise.resolve(null);
  selfInfo ??= Promise.resolve().then(() => native.call("app.info", {})).then((i) => (i?.mode === "jailbreak" || !i?.version ? null
    : { id: SELF_ID, name: "Cydian", version: String(i.version), key: null, source: null, sourceName: "Cydian",
      icon: "icons/icon-glossy-76.png", date: 0, self: true }), () => null);
  return selfInfo;
}
export function withSelf(store, native) {
  return { ...store, all: async () => {
    const recs = await store.all();
    const me = await selfRecord(native);
    return me ? [me, ...recs.filter((r) => r.id !== SELF_ID)] : recs;
  } };
}

const appListeners = new Set();
export function onAppsChange(f) {
  appListeners.add(f);
  return () => appListeners.delete(f);
}

// F51: the ids of everything the user has installed, for the Changes tab's Installed scope: dpkg's packages
// (parseStatus rows, or null without a status file) and the apps recorded on the device (appRecord records).
export function installedIds(dpkgRows, appRecords) {
  const ids = new Set();
  for (const r of dpkgRows ?? []) if (r?.id) ids.add(r.id);
  for (const r of appRecords ?? []) if (r?.id) ids.add(r.id);
  return ids;
}
