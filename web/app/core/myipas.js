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
//   libraryMode(mode) / nativeLibrary(mode)   F212: "site" | "sideload" | "jailbreak"; whether the shell keeps it
//   stateOf(entry, { site, jailbreak })  { kind: "signed" | "unsigned" | "broken" | "link" | "file" | "ready", label }
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
import { SELECT, DESELECT } from "./installed.js"; // F224: Manage's words, as Installed's (F222)

export const MYIPAS = "myipas"; // the Installed tab's path segment for the library

// F212: whose library My IPAs shows, from core/settings.js detectMode: "site" (this browser: links and kept files),
// "sideload" (the shell's library, signed with the user's certificate) or "jailbreak" (the same shell library, in
// /var/mobile/Documents, installed as it is by ifizbox-helper: no signing, no sideloader handoffs).
export function libraryMode(mode) {
  return mode === "sideload" || mode === "jailbreak" ? mode : "site";
}
// Whether the shell keeps the library (library.list/pick/add/delete): both app builds.
export const nativeLibrary = (mode) => libraryMode(mode) !== "site";

export const STATE_LABELS = {
  ready: "Ready to install", // F212: the jailbreak app, which installs IPAs as they are
  signed: "Signed, ready to install",
  unsigned: "Not signed yet",
  broken: "Can't be read",
  link: "A link: Install opens it in a sideloader",
  file: "Kept in this browser: Install signs it here", // F197: picked in Files on the website
};

// `identity`: whether a certificate is in the app (without one nothing counts as signed: the shell already answers
// signed null then). `site`: the website's library, which never holds a signed copy. `jailbreak` (F212): the
// jailbreak app's, which isn't signed here (ifizbox-helper installs it as it is).
export function stateOf(entry, { site = false, jailbreak = false } = {}) {
  if (site) return entry?.stored ? { kind: "file", label: STATE_LABELS.file } : { kind: "link", label: STATE_LABELS.link };
  if (entry?.error) return { kind: "broken", label: STATE_LABELS.broken };
  if (jailbreak) return { kind: "ready", label: STATE_LABELS.ready };
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

// ---- F208: managing the list: total size, the edit and swipe states, deleting several ------------------------------
//
//   totalSize(entries)                     bytes of every IPA (a link counts 0: nothing is kept)
//   libraryFooter(entries)                 "3 IPAs · 120 MB" under the list, "" when it is empty
//   deleteLabel(n) / deleteSheetTitle(n, { site })   the toolbar's "Delete (2)", the confirm sheet's button
//   listState(), listStep(state, action)   the list's edit, swipe and selection state, as data (see listStep)
//   holdActions(entry, { site })           a held row's sheet: Install, Sign Now, Save Signed IPA, Delete
//   deleteEntries(entries, { site, storage, store, call })   deletes each (record and stored file) ->
//                                          { deleted: [file], failed: [{ file, message, error }], ipas }

export function totalSize(entries) {
  return (entries ?? []).reduce((sum, e) => sum + (Number.isFinite(Number(e?.size)) && Number(e?.size) > 0 ? Number(e.size) : 0), 0);
}

export function libraryFooter(entries) {
  const n = (entries ?? []).filter((e) => e && e.file).length;
  if (!n) return "";
  const size = formatBytes(totalSize(entries));
  return [`${n} ${n === 1 ? "IPA" : "IPAs"}`, size || null].filter(Boolean).join(" · ");
}

export const deleteLabel = (n) => (n > 0 ? `Delete (${n})` : "Delete");
export const deleteButtonText = (n) => (n === 1 ? "Delete IPA" : `Delete ${n} IPAs`);
export function deleteSheetTitle(n, { site = false, stored = true, jailbreak = false } = {}) {
  const what = n === 1 ? "The IPA is" : `${n} IPAs are`;
  if (site) return stored ? `${what} deleted from this browser.` : "";
  if (jailbreak) return `${what} deleted from this iPhone.`; // F212: no signed copies there
  return n === 1 ? "The IPA and its signed copy are deleted from this iPhone." : `${n} IPAs and their signed copies are deleted from this iPhone.`;
}

// The list's state: `editing` (Edit tapped: red minus on every row, taps select), `armed` (the one row showing its
// red Delete: a left swipe, or its minus tapped), `selected` (files ticked for the toolbar's Delete (n)).
export const listState = () => ({ editing: false, armed: null, selected: [] });

// One step. Actions: { type: "edit" | "done" } | { type: "swipe", file, dir: "left" | "right" } | { type: "minus", file }
// | { type: "tap", file } (a tap on a row's body) | { type: "selectAll", files } | { type: "deselectAll" }
// | { type: "deleted", files } | { type: "list", files } (the list redrawn: drop what is gone).
// A tap outside editing with no Delete showing is the row's own link: the state stays (the screen lets it through).
export function listStep(s, a) {
  const sel = new Set(s.selected);
  switch (a?.type) {
    case "edit": return { editing: true, armed: null, selected: [] };
    case "done": return listState();
    case "swipe":
      if (s.editing) return s; // edit mode has its minus for that
      if (a.dir === "left") return { ...s, armed: a.file };
      return s.armed ? { ...s, armed: null } : s;
    case "minus":
      if (!s.editing) return s;
      return { ...s, armed: s.armed === a.file ? null : a.file };
    case "tap":
      if (s.armed) return { ...s, armed: null }; // a tap only puts the Delete away
      if (!s.editing) return s;
      if (sel.has(a.file)) sel.delete(a.file); else sel.add(a.file);
      return { ...s, selected: [...sel] };
    case "selectAll": return s.editing ? { ...s, armed: null, selected: [...new Set(a.files ?? [])] } : s;
    case "deselectAll": return { ...s, selected: [] };
    case "deleted": {
      const gone = new Set(a.files ?? []);
      return { ...s, armed: gone.has(s.armed) ? null : s.armed, selected: s.selected.filter((f) => !gone.has(f)) };
    }
    case "list": {
      const have = new Set(a.files ?? []);
      return { ...s, armed: have.has(s.armed) ? s.armed : null, selected: s.selected.filter((f) => have.has(f)) };
    }
    default: return s;
  }
}

// Whether a tap on a row's body opens its page (true) or is the list's (false: editing, or a Delete is showing).
export const tapOpens = (s) => !s.editing && !s.armed;
// Select All turns into Deselect All once everything is ticked.
export const allSelected = (s, files) => files.length > 0 && files.every((f) => s.selected.includes(f));

export const HOLD = { INSTALL: "Install", SIGN: "Sign Now", SAVE: "Save Signed IPA", DELETE: "Delete" };

export function holdActions(entry, { site = false, jailbreak = false } = {}) {
  if (!entry?.file) return [];
  if (site) return [HOLD.INSTALL, HOLD.DELETE];
  if (entry.error) return [HOLD.DELETE];
  if (jailbreak) return [HOLD.INSTALL, HOLD.DELETE]; // F212: nothing to sign or save signed there
  return [HOLD.INSTALL, HOLD.SIGN, HOLD.SAVE, HOLD.DELETE];
}

// Deletes `entries` one by one. The website: removeSiteEntry (its record, and a kept IPA's bytes in IndexedDB).
// The app: `call("delete", { file })` (signing-client.js libraryCall: the shell deletes the IPA, its signed copy and
// options, and answers { ipas }). One failing doesn't stop the rest. `ipas`: the list after (the last answer, or
// the website's own list).
export async function deleteEntries(entries, { site = false, storage = globalThis.localStorage, store = null, call } = {}) {
  const deleted = [], failed = [];
  let ipas = null;
  for (const e of entries ?? []) {
    if (!e?.file) continue;
    try {
      if (site) await removeSiteEntry(e, { storage, store: e.stored ? (typeof store === "function" ? await store() : store) : null });
      else { const r = await call("delete", { file: e.file }); if (Array.isArray(r?.ipas)) ipas = r.ipas; }
      deleted.push(e.file);
    } catch (err) {
      failed.push({ file: e.file, message: String(err?.message ?? err), error: err });
    }
  }
  if (site) ipas = siteEntries(storage);
  return { deleted, failed, ipas };
}

// ---- F224: Install IPAs as one page: the user's IPAs only, Not Installed / Installed, the price button, Manage --------
//
//   installedIdOf(entry)                   the bundle ID iOS knows the app by (the signed copy's, Sign Options', the IPA's)
//   ipaLine(entry, opts)                   the row's line: "Version 1.2 · 14.3 MB · Signed" ("Not signed"; the website's
//                                          link "Link"; the jailbreak app no signing word)
//   matchIpa(entry, q)                     the search bar: name, bundle ID or file name
//   ipaSections(entries, { installed, query, site, jailbreak })   [{ key, header, rows }]: Not Installed, then
//                                          Installed, A-Z, empty groups left out. `installed`: { bundleId: bool } (or a
//                                          function id -> bool); each row gets `installed` and `line`
//   priceButton(row, { armed, busy, site, jailbreak })   the row's price button: { kind, label, green } or null
//                                          kind "sign" (grey SIGN, or INSTALL when signed: a first tap arms it),
//                                          "confirm" (green INSTALL: the second tap), "install" (one tap: the jailbreak
//                                          app, a website link), "open" (installed), "busy" (SIGNING / INSTALLING, filling)
//   priceTap(state, row, opts)             -> { state, act: "arm" | "install" | "open" | null }; state { armed: file | null }
//   priceProgress(label, prev)             a HUD label ("Signing 40%") -> { label, fill 0..1 } for the filling button
//   IPA_PRESETS, ipaPresetFiles(rows, p), ipaSelectSheet(rows), ipaSelectLabel(rows, selected)   Manage's Select…
//   ipaCounts(rows, selected, opts)        -> { n, sign, unsign, del, installed }
//   ipaSummary(rows, selected)             "2 selected · 5 IPAs · 1 signed · 3 installed"
//   ipaToolbar(counts, opts)               [{ kind, label, disabled }]: Sign (n), Unsign (n), Delete (n)
//   ipaSheet(kind, picked, opts)           the confirm sheet: { title, button, destructive }
//   unsignEntries(entries, { call })       library.unsign for each picked IPA with a signed copy -> { done, failed, ipas }

export const installedIdOf = (e) => e?.signed?.bundleId || e?.options?.bundleId || e?.bundleId || null;

export function ipaLine(entry, { site = false, jailbreak = false } = {}) {
  let status = null;
  if (site) status = entry?.stored ? "Not signed" : "Link";
  else if (entry?.error) status = STATE_LABELS.broken;
  else if (!jailbreak) status = entry?.signed ? "Signed" : "Not signed";
  return [entry?.version ? `Version ${entry.version}` : null, formatBytes(entry?.size) || null, status].filter(Boolean).join(" · ");
}

export function matchIpa(entry, q) {
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) return true;
  return [entry?.name, entry?.title, entry?.bundleId, entry?.file].some((v) => String(v ?? "").toLowerCase().includes(s));
}

export function ipaSections(entries, { installed = {}, query = "", site = false, jailbreak = false } = {}) {
  const has = typeof installed === "function" ? installed : (id) => Boolean(id && installed?.[id] === true);
  const rows = libraryRows(entries, { site, jailbreak })
    .map((r) => ({ ...r, installed: !r.error && Boolean(has(installedIdOf(r))), line: ipaLine(r, { site, jailbreak }) }))
    .filter((r) => matchIpa(r, query));
  return [
    { key: "notInstalled", header: "Not Installed", rows: rows.filter((r) => !r.installed) },
    { key: "installed", header: "Installed", rows: rows.filter((r) => r.installed) },
  ].filter((s) => s.rows.length);
}

export const PRICE = { SIGN: "SIGN", INSTALL: "INSTALL", OPEN: "OPEN", SIGNING: "SIGNING", INSTALLING: "INSTALLING" };

export function priceButton(row, { armed = null, busy = null, site = false, jailbreak = false } = {}) {
  if (!row?.file || row.error) return null;
  if (busy) return { kind: "busy", label: busy.label || PRICE.INSTALLING, fill: busy.fill ?? 0, green: false };
  if (row.installed) return { kind: "open", label: PRICE.OPEN, green: false };
  if (jailbreak || (site && !row.stored)) return { kind: "install", label: PRICE.INSTALL, green: false };
  if (armed === row.file) return { kind: "confirm", label: PRICE.INSTALL, green: true };
  return { kind: "sign", label: row.signed ? PRICE.INSTALL : PRICE.SIGN, green: false };
}

// A tap on a row's price button. A first tap on SIGN arms it (green INSTALL); the second installs. Tapping another
// row's button moves the armed one; a tap anywhere else is { type: "away" } (priceAway).
export function priceTap(state, row, opts = {}) {
  const b = priceButton(row, { ...opts, armed: state?.armed ?? null });
  if (!b || b.kind === "busy") return { state, act: null };
  if (b.kind === "sign") return { state: { ...state, armed: row.file }, act: "arm" };
  if (b.kind === "open") return { state: { ...state, armed: null }, act: "open" };
  return { state: { ...state, armed: null }, act: "install" };
}
export const priceAway = (state) => (state?.armed ? { ...state, armed: null } : state);

// The library's phases on the button: reading and signing fill the first 60%, installing the rest; it never goes back.
export function priceProgress(text, prev = null) {
  const s = String(text ?? "").trim();
  const m = s.match(/^(.*?)\s*\(?(\d{1,3}(?:\.\d+)?)\s?%\)?$/);
  const word = (m ? m[1] : s).toLowerCase();
  const pct = m ? Math.max(0, Math.min(100, Number(m[2]))) / 100 : null;
  let label = prev?.label ?? PRICE.SIGNING, fill = prev?.fill ?? 0;
  if (/^(reading|downloading|looking)/.test(word)) { label = PRICE.SIGNING; fill = 0.1 * (pct ?? 0.5); }
  else if (/^sign/.test(word)) { label = PRICE.SIGNING; fill = 0.1 + 0.5 * (pct ?? 0); }
  else if (/^(install|upload|serv)/.test(word)) { label = PRICE.INSTALLING; fill = 0.6 + 0.35 * (pct ?? 0.5); }
  else if (/^done/.test(word)) fill = 1;
  return { label, fill: Math.max(prev?.fill ?? 0, Math.min(1, fill)) };
}

// ---- Manage (Installed's pattern, F222: core/installed.js's Select… / Deselect words) --------------------------------

export const IPA_PRESETS = ["all", "notInstalled", "signed"];
const IPA_PRESET_LABEL = { all: "All IPAs", notInstalled: "Not Installed", signed: "Signed" };
export const IPA_SELECT = SELECT;
export const IPA_DESELECT = DESELECT;

export function ipaPresetFiles(rows, preset) {
  const pick = { all: () => true, notInstalled: (r) => !r.installed, signed: (r) => Boolean(r.signed) }[preset];
  return pick ? (rows ?? []).filter((r) => r?.file && pick(r)).map((r) => r.file) : [];
}

export function ipaSelectSheet(rows) {
  return IPA_PRESETS.map((preset) => ({ preset,
    label: preset === "all" ? IPA_PRESET_LABEL.all : `${IPA_PRESET_LABEL[preset]} (${ipaPresetFiles(rows, preset).length})` }));
}

export function ipaSelectLabel(rows, selected) {
  const files = (rows ?? []).map((r) => r.file);
  const sel = new Set(selected ?? []);
  return files.length && files.every((f) => sel.has(f)) ? IPA_DESELECT : IPA_SELECT;
}

// Sign counts what can be signed here (not a broken file; on the website a kept file, not a link); Unsign only picked
// IPAs with a signed copy; Delete every picked one.
export function ipaCounts(rows, selected, { site = false, jailbreak = false } = {}) {
  const sel = new Set(selected ?? []);
  const out = { n: 0, sign: 0, unsign: 0, del: 0, installed: 0 };
  for (const r of rows ?? []) {
    if (!sel.has(r.file)) continue;
    out.n++;
    out.del++;
    if (r.installed) out.installed++;
    if (!jailbreak && !r.error && (!site || r.stored)) out.sign++;
    if (!site && !jailbreak && r.signed) out.unsign++;
  }
  return out;
}

export function ipaSummary(rows, selected) {
  const all = rows ?? [];
  const sel = new Set(selected ?? []);
  const n = all.filter((r) => sel.has(r.file)).length;
  return [`${n} selected`, all.length === 1 ? "1 IPA" : `${all.length} IPAs`, `${all.filter((r) => r.signed).length} signed`,
    `${all.filter((r) => r.installed).length} installed`].join(" · ");
}

const withCount = (label, n) => (n > 0 ? `${label} (${n})` : label);
export function ipaToolbar(c, { site = false, jailbreak = false } = {}) {
  const out = [];
  if (!jailbreak) out.push({ kind: "sign", label: withCount("Sign", c.sign), disabled: !c.sign });
  if (!jailbreak && !site) out.push({ kind: "unsign", label: withCount("Unsign", c.unsign), disabled: !c.unsign });
  out.push({ kind: "delete", label: withCount("Delete", c.del), disabled: !c.del });
  return out;
}

export function ipaSheet(kind, picked, { site = false, jailbreak = false } = {}) {
  const list = picked ?? [];
  if (kind === "sign") {
    const n = list.filter((r) => !r.error && (!site || r.stored)).length;
    return { title: site ? "Each IPA is signed in this browser with your certificate, then iOS installs it."
      : "Each IPA is signed with your certificate and installed.", button: n === 1 ? "Sign and Install IPA" : `Sign and Install ${n} IPAs`, destructive: false };
  }
  if (kind === "unsign") {
    const n = list.filter((r) => r.signed).length;
    return { title: n === 1 ? "The signed copy is deleted. The IPA file stays." : `${n} signed copies are deleted. The IPA files stay.`,
      button: n === 1 ? "Unsign IPA" : `Unsign ${n} IPAs`, destructive: true };
  }
  const n = list.length;
  const inst = list.filter((r) => r.installed).length;
  const stay = !inst ? "" : inst === 1 ? " The installed app stays on your iPhone: manage it in Installed."
    : ` ${inst} installed apps stay on your iPhone: manage them in Installed.`;
  return { title: deleteSheetTitle(n, { site, jailbreak, stored: list.some((r) => r.stored) }) + stay, button: deleteButtonText(n), destructive: true };
}

export async function unsignEntries(entries, { call } = {}) {
  const done = [], failed = [];
  let ipas = null;
  for (const e of entries ?? []) {
    if (!e?.file || !e.signed) continue;
    try {
      const r = await call("unsign", { file: e.file });
      if (Array.isArray(r?.ipas)) ipas = r.ipas;
      done.push(e.file);
    } catch (err) {
      failed.push({ file: e.file, message: String(err?.message ?? err), error: err });
    }
  }
  return { done, failed, ipas };
}
