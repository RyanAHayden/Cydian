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
//   stateOf(entry, { identity, site })   { kind: "signed" | "unsigned" | "broken" | "link", label }
//   libraryRows(entries, opts)           A to Z, with the subtitle the list shows
//   ipaSubtitle(entry, opts)             "1.2 · 14.3 MB · Signed, ready to install"
//   formatBytes(n)                       "14.3 MB"
//   nameFromUrl(url)                     the file name a link would save as ("My App.ipa"), or ""
//   ipaToken(file) / fileOfToken(seg)    the route segment of an IPA's page: "ipa:<file>"
//   optionsParams(info, edits)           Sign Options for library.options; throws on a bad bundle ID
//   SITE_KEY, siteEntries(storage), addSiteUrl(storage, url, now), removeSiteUrl(storage, file)
// SPDX-License-Identifier: GPL-3.0-or-later
import { validBundleId } from "./signing.js";

export const MYIPAS = "myipas"; // the Installed tab's path segment for the library

export const STATE_LABELS = {
  signed: "Signed, ready to install",
  unsigned: "Not signed yet",
  broken: "Can't be read",
  link: "A link: Install opens it in a sideloader",
};

// `identity`: whether a certificate is in the app (without one nothing counts as signed: the shell already answers
// signed null then). `site`: the website's library, which never holds a signed copy.
export function stateOf(entry, { site = false } = {}) {
  if (site) return { kind: "link", label: STATE_LABELS.link };
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
  return Array.isArray(list) ? list.filter((e) => e && typeof e.url === "string" && typeof e.file === "string") : [];
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
