// Import & Export for the source list (F45, Sources > Manage). Pure JS, no DOM, so node tests cover it.
//
//   exportText(sources, { date })   -> the list as text: one source per line, which parseImport reads back
//   exportLine(source)              -> one source's line: its URL, or `deb <uri> <dist> <components>` for a dist repo
//   parseImport(text)               -> { format, entries: [entry] }: our export, plain URLs, AltStore/SideStore/
//                                      Feather links and JSON lists, Sileo's deb822 .sources, Cydia's one-line .list
//   reviewImport(entries, sources)  -> each entry with `status`: "new" | "listed" | "unsupported"
//   orderSources(list, order)       -> the list in the user's order (Manage > Sources), else as given
//
// entry: { kind: "altstore" | "apt" | "any", uri, dist, components, input }. `input` is what Add Source gets
// (backend.addSource); `kind` "any" is a bare URL that could be either (Add Source tries APT, then AltStore).
// A dist repo (`deb uri 1800 main`) gets `{ uri, dist, components }` as its input (F48): addSource checks its
// Release under dists/<dist>/ (core/sources.js verifyDistSource). "unsupported" is left for an entry with no input.
import { parseListFile, parseDeb822File } from "./aptsources.js";
import { normalizeSourceUrl, sourceKey, sourceIcons, sourceSubtitle } from "./sources.js";
import { altKey, isAltKey, normalizeAltUrl, looksLikeAltUrl, seedRecord } from "./altstore.js";

export const EXPORT_FILENAME = "cydian-sources.txt";

const isFlat = (dist) => !dist || String(dist).endsWith("/");

export function exportLine(source) {
  if (isAltKey(source?.key) || isFlat(source?.dist)) return source.uri;
  return ["deb", source.uri, source.dist, ...(source.components ?? [])].join(" ");
}

// A header comment (parseImport skips it), then the lines in the list's order, each source once.
export function exportText(sources, { date = new Date() } = {}) {
  const lines = [...new Set((sources ?? []).filter((s) => s?.uri).map(exportLine))];
  const day = date.toISOString().slice(0, 10);
  return [`# Cydian sources (${lines.length}), ${day}`, ...lines].join("\n") + "\n";
}

// F52: Export > Copy to Clipboard: the same lines without the header comment, one URL (or deb line) per line, for
// pasting into another package manager or a note.
export function clipboardText(sources) {
  return [...new Set((sources ?? []).filter((s) => s?.uri).map(exportLine))].join("\n");
}

// ---- import ------------------------------------------------------------------------------------------------

function aptEntry({ uri, dist, components }) {
  let u;
  try { u = normalizeSourceUrl(uri); } catch { return null; }
  const flat = isFlat(dist);
  const comps = flat ? [] : [...(components ?? [])];
  return { kind: "apt", uri: u, dist: flat ? "./" : dist, components: comps, input: flat ? u : { uri: u, dist, components: comps } };
}

// An AltStore source. Its `input` is a sideloader link, so Add Source goes straight to AltStore even for a URL
// without .json (apps.altstore.io/), instead of asking for an APT repo there first.
export const altLink = (uri) => "altstore://source?url=" + encodeURIComponent(uri);
const altEntry = (uri) => ({ kind: "altstore", uri, dist: null, components: [], input: altLink(uri) });

// A bare URL or a sideloader link. A .json file or a link is AltStore; anything else could be either.
function urlEntry(text) {
  const s = String(text ?? "").trim().replace(/[),.;]+$/, "");
  if (!s) return null;
  if (looksLikeAltUrl(s)) {
    const uri = normalizeAltUrl(s);
    return uri ? altEntry(uri) : null;
  }
  if (!/^https?:\/\//i.test(s)) return null;
  const uri = normalizeAltUrl(s);
  return uri ? { kind: "any", uri, dist: null, components: [], input: uri } : null;
}

// The URL in a JSON list item: a string, or an object as AltStore, SideStore and Feather keep them.
function jsonItem(item) {
  if (typeof item === "string") return urlEntry(item);
  if (!item || typeof item !== "object") return null;
  for (const k of ["url", "sourceURL", "sourceUrl", "source", "URL", "uri", "repository", "repo"]) {
    if (typeof item[k] === "string") {
      const e = urlEntry(item[k]);
      if (e && e.kind === "any" && !/repo/i.test(k)) return altEntry(e.uri); // a JSON source list
      if (e) return e;
    }
  }
  return null;
}

function fromJson(json) {
  // An AltStore source itself: one entry, when it names its own URL.
  if (json && !Array.isArray(json) && Array.isArray(json.apps)) return json.sourceURL ? [jsonItem({ url: json.sourceURL })] : [];
  const list = Array.isArray(json) ? json
    : json && typeof json === "object" ? json.sources ?? json.repos ?? json.repositories ?? json.urls ?? [] : [];
  return Array.isArray(list) ? list.map(jsonItem) : [];
}

function tryJson(text) {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

// Lines: `deb ...` (Cydia's .list, our export's dist repos), URLs and links (one per line, or several in a line of
// pasted prose); `#` starts a comment.
function fromLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*/, "").trim();
    if (!line) continue;
    if (/^deb(\s|\[)/.test(line)) { out.push(...parseListFile(line).map(aptEntry)); continue; }
    if (/^deb-src\s/.test(line)) continue;
    for (const word of line.split(/\s+/)) out.push(urlEntry(word));
  }
  return out;
}

export function parseImport(text) {
  const s = String(text ?? "").replace(/^﻿/, "");
  let format;
  let entries;
  const json = tryJson(s);
  if (json !== undefined) {
    format = "json";
    entries = fromJson(json);
  } else if (/^\s*(Types|URIs)\s*:/im.test(s)) {
    format = "deb822";
    entries = parseDeb822File(s).map(aptEntry);
  } else {
    format = /^\s*deb\s/m.test(s) && !/^\s*(https?|altstore|sidestore|feather):/im.test(s) ? "list" : "lines";
    entries = fromLines(s);
  }
  const seen = new Set();
  entries = entries.filter((e) => {
    if (!e) return false;
    const id = `${e.uri} ${e.dist ?? ""}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { format, entries };
}

// The keys a source would be stored under: AltStore's `alt:<url>`, APT's `deb:<uri>:<dist>`.
export function entryKeys(e) {
  const keys = [];
  if (e.kind !== "apt") keys.push(altKey(e.uri));
  if (e.kind !== "altstore") {
    try {
      const uri = e.kind === "apt" ? e.uri : normalizeSourceUrl(e.uri);
      keys.push(sourceKey({ uri, dist: e.dist || "./" }));
    } catch { /* not an APT URL */ }
  }
  return keys;
}

// Which entries the list already has. A source in the list under an AltStore key also matches a trailing-slash
// twin, since a pasted list may carry either.
export function reviewImport(entries, sources) {
  const have = new Set((sources ?? []).map((s) => s.key));
  const slashless = (k) => k.replace(/\/$/, "");
  const haveLoose = new Set([...have].map(slashless));
  return (entries ?? []).map((e) => {
    const keys = entryKeys(e);
    const listed = keys.some((k) => have.has(k) || haveLoose.has(slashless(k)));
    return { ...e, status: listed ? "listed" : e.input ? "new" : "unsupported" };
  });
}

// ---- order -------------------------------------------------------------------------------------------------

// Keys in `order` first, in that order; sources it doesn't name (added since) after, in the list's own order.
export function orderSources(list, order) {
  const all = Array.isArray(list) ? list : [];
  if (!Array.isArray(order) || !order.length) return all;
  const at = new Map(order.map((k, i) => [k, i]));
  const known = all.filter((s) => at.has(s.key)).sort((a, b) => at.get(a.key) - at.get(b.key));
  return [...known, ...all.filter((s) => !at.has(s.key))];
}

export const ORDER_KEY = "cydian.sourceOrder";

export function loadOrder(storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(ORDER_KEY) ?? "null");
    return Array.isArray(v) ? v.filter((k) => typeof k === "string") : null;
  } catch {
    return null;
  }
}

// null (Sort by Name) forgets the order.
export function saveOrder(keys, storage = globalThis.localStorage) {
  try {
    if (keys) storage?.setItem(ORDER_KEY, JSON.stringify(keys));
    else storage?.removeItem(ORDER_KEY);
  } catch { /* private mode: the order lasts this visit */ }
}

// ---- Recommended (F52) ---------------------------------------------------------------------------------------
//
//   recommendedRows(recs, sources, { jailbroken, previews }) -> one row per entry, as Sources draws its rows:
//     { rec, key, record, label, subtitle, icons, count, added, input }
//   `previews` (Map key -> record) holds what a fetch read before adding (an AltStore source's name, iconURL and
//   app count). The record a row draws from: the listed source if added, else the preview, else a seed (the URL
//   alone), so the icon falls back as Sources' does (core/sources.js sourceIcons): the source's own icon, then for a
//   GitHub-hosted source its owner's avatar (F44), then the letter.

// The record a recommended entry would be stored as before anything is read from it.
export function recommendedSeed(rec) {
  if (!rec.jailbreak) return seedRecord(normalizeAltUrl(rec.url));
  const uri = normalizeSourceUrl(rec.url);
  return { key: sourceKey({ uri, dist: "./" }), uri, dist: "./", components: [] };
}

// What Add Source gets: an APT URL, or an AltStore link so it isn't tried as an APT repo first.
export const recommendedInput = (rec) => (rec.jailbreak ? rec.url : altLink(normalizeAltUrl(rec.url)));

// The listed source an entry already is, or null (a trailing-slash twin counts, as in reviewImport).
export function listedSource(rec, sources) {
  const seed = recommendedSeed(rec);
  const entry = rec.jailbreak ? parseImport(rec.url).entries[0] : null;
  const keys = entry ? entryKeys(entry) : [seed.key];
  const slashless = (k) => String(k).replace(/\/$/, "");
  const want = new Set(keys.map(slashless));
  return (sources ?? []).find((s) => want.has(slashless(s.key))) ?? null;
}

export function recommendedRows(recs, sources, { jailbroken = true, previews = new Map() } = {}) {
  return (recs ?? []).filter((r) => jailbroken || !r.jailbreak).map((rec) => {
    const seed = recommendedSeed(rec);
    const listed = listedSource(rec, sources);
    const record = listed ? { ...seed, ...listed } : { ...seed, ...(previews.get(seed.key) ?? {}) };
    return {
      rec, key: record.key, record, label: rec.name, subtitle: sourceSubtitle(record), icons: sourceIcons(record),
      count: typeof record.count === "number" ? record.count : null, added: Boolean(listed), input: recommendedInput(rec),
    };
  });
}
