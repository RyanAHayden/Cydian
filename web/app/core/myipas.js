// F77: My IPAs, the user's own IPAs (screens/myipas.js draws them). Pure: no DOM, no bridge, tested with node --test.
//
// In the sideload app the IPAs are files in the app's Documents, read and signed by the shell (native/Sources/
// MyIPAs.swift, library.*); each comes as an entry:
//   { file, name, bundleId, version, size, minimumOS, added, extensions: [{path, name, bundleId, point}],
//     icon (base64 PNG) | null, error | null, options: {name, bundleId, icon, removeExtensions, fixArm64e},
//     signed: { at, bundleId, name, version, size, expires? } | null }
// On the website there is no signer on the phone: the library is a list of links kept on this device
// (siteEntries/addSiteUrl/removeSiteUrl over localStorage), handed to iFizBox or another sideloader on Install (F89).
//
//   stateOf(entry, { identity, site })   { kind: "signed" | "unsigned" | "broken" | "link" | "file", label }
//   libraryRows(entries, opts)           A to Z, with the subtitle the list shows
//   ipaSubtitle(entry, opts)             "1.2 · 14.3 MB · Signed, ready to install"
//   formatBytes(n)                       "14.3 MB"
//   nameFromUrl(url)                     the file name a link would save as ("My App.ipa"), or ""
//   ipaToken(file) / fileOfToken(seg)    the route segment of an IPA's page: "ipa:<file>"
//   optionsParams(info, edits)           Sign Options for library.options; throws on a bad bundle ID
//   SITE_KEY, siteEntries(storage), addSiteUrl(storage, url, now), removeSiteUrl(storage, file)
//   F197: an IPA picked in Files on the website, its bytes kept in this browser (IndexedDB):
//   addSiteFile(file, { storage, store, read, room, now })   the entry ({ file, stored: true, name, bundleId, version,
//                                        size, icon, minimumOS, added }); throws a clear error when it isn't an IPA,
//                                        is over SITE_FILE_MAX or doesn't fit in what Safari lets this site keep
//   removeSiteEntry(entry, { storage, store })   removes it from the list, and a stored one's bytes
//   openIpaStore({ indexedDB }) / memoryIpaStore()   { put(file, blob), get(file), remove(file) }
// SPDX-License-Identifier: GPL-3.0-or-later
import { validBundleId } from "./signing.js";

export const MYIPAS = "myipas"; // the Installed tab's path segment for the library

export const STATE_LABELS = {
  signed: "Signed, ready to install",
  unsigned: "Not signed yet",
  broken: "Can't be read",
  link: "A link: Install opens it in a sideloader",
  file: "Kept in this browser: Install signs it here", // F197: picked in Files on the website
};

// `identity`: whether a certificate is in the app (without one nothing counts as signed: the shell already answers
// signed null then). `site`: the website's library, which never holds a signed copy.
export function stateOf(entry, { site = false } = {}) {
  if (site) return entry?.stored ? { kind: "file", label: STATE_LABELS.file } : { kind: "link", label: STATE_LABELS.link };
  if (entry?.error) return { kind: "broken", label: STATE_LABELS.broken };
  if (entry?.signed) return { kind: "signed", label: STATE_LABELS.signed };
  return { kind: "unsigned", label: STATE_LABELS.unsigned };
}

export function formatBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return "";
  if (b < 1024) return `${b} bytes`;
  const units = ["KB", "MB", "GB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ipaSubtitle(entry, opts = {}) {
  const st = stateOf(entry, opts);
  return [entry?.version || null, formatBytes(entry?.size) || null, st.label].filter(Boolean).join(" · ");
}

const displayName = (e) => String(e?.name || e?.file || "").trim() || "App";

export function libraryRows(entries, opts = {}) {
  return [...(entries ?? [])].filter((e) => e && e.file)
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base", numeric: true }) ||
      String(a.file).localeCompare(String(b.file)))
    .map((e) => ({ ...e, title: displayName(e), state: stateOf(e, opts), subtitle: ipaSubtitle(e, opts) }));
}

export function nameFromUrl(url) {
  let u;
  try { u = new URL(String(url ?? "").trim()); } catch { return ""; }
  if (!/^https?:$/.test(u.protocol)) return "";
  let last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  try { last = decodeURIComponent(last); } catch { /* as it is */ }
  last = last.replace(/[\u0000-\u001f\u007f:\\/]/g, "").replace(/^\.+/, "").trim();
  if (!last) return "";
  return /\.ipa$/i.test(last) ? last.slice(0, -4).trim() + ".ipa" : "";
}

export const ipaToken = (file) => `ipa:${file}`;
export const fileOfToken = (seg) => (typeof seg === "string" && seg.startsWith("ipa:") ? seg.slice(4) : null);

// The Sign Options page's edits as library.options' params. Empty fields mean "as the IPA has it".
export function optionsParams(info, edits = {}) {
  const t = (v) => (v == null ? "" : String(v).trim());
  const name = t(edits.name);
  const bundleId = t(edits.bundleId);
  if (bundleId && !validBundleId(bundleId)) {
    throw new Error(`"${bundleId}" isn't a bundle ID: letters, digits, - and ., like com.you.app.`);
  }
  const known = new Set((info?.extensions ?? []).map((x) => x.path));
  const out = {
    file: info?.file ?? "",
    name: name && name !== info?.name ? name : "",
    bundleId: bundleId && bundleId !== info?.bundleId ? bundleId : "",
    removeExtensions: [...new Set(edits.removeExtensions ?? [])].filter((p) => known.has(p)).sort(),
    fixArm64e: edits.fixArm64e !== false,
  };
  if (edits.icon) out.icon = edits.icon;
  return out;
}

// ---- the website's library: links, on this device -----------------------------------------------------------

const SITE_KEY = "ifizbox.myIpas";

export function siteEntries(storage = globalThis.localStorage) {
  let list = [];
  try { list = JSON.parse(storage?.getItem(SITE_KEY) ?? "[]"); } catch { list = []; }
  return Array.isArray(list) ? list.filter((e) => e && typeof e.file === "string" && (typeof e.url === "string" || e.stored === true)) : [];
}

function saveSite(storage, list) {
  try { storage?.setItem(SITE_KEY, JSON.stringify(list)); } catch { /* private mode: this session only */ }
}

// Adds a link (an https URL to an .ipa); the same link twice is one entry. Answers the entry. Throws on a link
// that isn't http(s).
export function addSiteUrl(storage, url, now = Date.now()) {
  const u = String(url ?? "").trim();
  let parsed;
  try { parsed = new URL(u); } catch { throw new Error("That isn't a link."); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("The link has to start with https://.");
  const list = siteEntries(storage);
  const had = list.find((e) => e.url === parsed.href);
  if (had) return had;
  const base = nameFromUrl(parsed.href) || "App.ipa";
  const taken = new Set(list.map((e) => e.file));
  let file = base;
  for (let n = 2; taken.has(file); n++) file = `${base.slice(0, -4)} ${n}.ipa`;
  const entry = { file, url: parsed.href, name: file.slice(0, -4), added: new Date(now).toISOString() };
  saveSite(storage, [...list, entry]);
  return entry;
}

export function removeSiteUrl(storage, file) {
  saveSite(storage, siteEntries(storage).filter((e) => e.file !== file));
}

// ---- F197: IPAs picked in Files, kept in this browser ----------------------------------------------------------

// Safari lets a site keep about 1 GB before iOS 17 (more since, up to a share of the disk): one IPA up to 400 MB
// leaves room for signing it (the IPA, its signed copy in memory) and for the user's other data.
export const SITE_FILE_MAX = 400 * 1024 * 1024;
const MB = (n) => Math.round(n / 1048576);

const IPA_DB = "ifizbox-myipas", IPA_STORE = "files";

export function memoryIpaStore() {
  const m = new Map();
  return { files: m, put: async (file, blob) => { m.set(file, blob); }, get: async (file) => m.get(file) ?? null, remove: async (file) => { m.delete(file); } };
}

export function openIpaStore({ indexedDB: idb = globalThis.indexedDB, name = IPA_DB } = {}) {
  if (!idb) return Promise.reject(new Error("This browser can't keep files (no IndexedDB): add the IPA From URL instead."));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IPA_STORE)) req.result.createObjectStore(IPA_STORE); };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB failed"));
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, f) => new Promise((res, rej) => {
        const tx = db.transaction(IPA_STORE, mode);
        const r = f(tx.objectStore(IPA_STORE));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error ?? r?.error ?? new Error("IndexedDB failed"));
        tx.onabort = () => rej(tx.error ?? new Error("IndexedDB aborted"));
      });
      resolve({
        put: (file, blob) => run("readwrite", (st) => st.put(blob, file)).then(() => undefined),
        get: (file) => run("readonly", (st) => st.get(file)).then((v) => v ?? null),
        remove: (file) => run("readwrite", (st) => st.delete(file)).then(() => undefined),
      });
    };
  });
}

const noRoom = (size) => new Error(`Safari has no room to keep this IPA (${MB(size)} MB) on this iPhone. Delete IPAs you no longer need, ` +
  "or free up storage, or add it From URL instead.");

// `file`: a File (or Blob with a name). `read`: core/ipainfo.js readIpaFile. `room()`: the bytes this site may still
// keep (navigator.storage.estimate's quota - usage), or null when the browser doesn't say.
export async function addSiteFile(file, { storage = globalThis.localStorage, store, read, room = async () => null, now = Date.now() } = {}) {
  const size = Number(file?.size ?? file?.byteLength ?? 0);
  if (!size) throw new Error("That file is empty.");
  const fname = String(file?.name ?? "");
  if (fname && !/\.ipa$/i.test(fname)) throw new Error(`${fname} isn't an IPA: choose an .ipa file.`);
  if (size > SITE_FILE_MAX) throw new Error(`${fname || "That IPA"} is ${MB(size)} MB: the website keeps IPAs up to ${MB(SITE_FILE_MAX)} MB. Add a bigger one From URL instead.`);
  const info = await read(file);
  const free = await Promise.resolve().then(room).catch(() => null);
  if (typeof free === "number" && free < size + 8 * 1048576) throw noRoom(size);
  const list = siteEntries(storage);
  const base = (fname.replace(/[\u0000-\u001f\u007f:\\/]/g, "").replace(/^\.+/, "").replace(/\.ipa$/i, "").trim() || info.name || "App") + ".ipa";
  const taken = new Set(list.map((e) => e.file));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base.slice(0, -4)} ${n}.ipa`;
  try { await store.put(name, file); } catch (e) {
    if (e?.name === "QuotaExceededError" || /quota|space|room/i.test(String(e?.message))) throw noRoom(size);
    throw new Error(`Safari couldn't keep the IPA: ${e?.message ?? e}.`);
  }
  const entry = { file: name, stored: true, name: info.name, bundleId: info.bundleId, version: info.version || "", size,
    minimumOS: info.minimumOS ?? null, icon: info.icon ?? null, added: new Date(now).toISOString() };
  saveSite(storage, [...list, entry]);
  return entry;
}

export async function removeSiteEntry(entry, { storage = globalThis.localStorage, store } = {}) {
  removeSiteUrl(storage, entry.file);
  if (entry?.stored) await store.remove(entry.file);
}
