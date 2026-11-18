// F160: compatibility for apps whose source gives no iOS range (AppTesters gives none for its 10,000 apps): the IPA's
// own Info.plist says it (MinimumOSVersion, UIDeviceFamily). Only an app page that is opened asks (never a list or a
// feed): the Worker's /api/ipainfo reads the IPA with Range requests and caches the answer at the edge; the result is
// kept on this device keyed by the IPA's downloadURL, and the catalog judges the row with it from then on (a green
// check or a red X instead of the grey outlined "not checked" mark). Pure JS, no DOM. SPDX-License-Identifier: GPL-3.0-or-later
//
//   needsCheck(version)          -> true when the version gives no minOSVersion and has an http(s) downloadURL
//   ipaInfoUrl(url, base)        -> "/api/ipainfo?url=…" (null: not an http(s) URL)
//   textMinOS(text)              -> "15.0" from "iOS 15+", "Requires iOS 15", "iOS 15.0 or later"…; null when none
//   withIpaInfo(target, info)    -> the stanza or version with the IPA's minOSVersion and deviceFamily filled in where
//                                   the source gives none (the source's fields win), and ipaChecked: true; `target`
//                                   itself when there is no info
//   savedInfo(store, url, now)   -> the info kept for that IPA, or null (none, or expired)
//   allSaved(store, now)         -> { url: info } for every kept IPA (the catalog gets these: catalog.setIpaInfo)
//   checkIpa(url, { get, store, fallback, text, now, queue }) -> Promise<info>, asked once per IPA on this device:
//                                   1) get(url) -> the Worker's answer ({ minOSVersion, deviceFamily, … } or { code })
//                                   2) the App Store's minimumOsVersion (fallback() -> Promise<string | null>, F161)
//                                   3) textMinOS(text) (the subtitle and descriptions)
//                                   The IPA's own value wins. Network failures are not kept (asked again next time)
//                                   unless 2 or 3 found something, which is kept a day.
//   createQueue(n)               -> run(fn): at most n checks at a time, the rest wait their turn
//
// info: { minOSVersion: "15.0" | null, deviceFamily: [1, 2] | null, from: "ipa" | "appstore" | "text" | null, at, until? }
// from null with ipaChecked means "checked, still unknown" (today's grey ?): the Range was refused, no Info.plist.

const PREFIX = "ifizbox.ipainfo.";
const DAY = 86400000;
export const UNKNOWN_TTL = 30 * DAY; // the IPA couldn't be read for good (no Range, no Info.plist): ask again in a month
export const GUESS_TTL = DAY;         // the Worker didn't answer, a fallback did: try the IPA again tomorrow
// The Worker's codes for an IPA that won't read however often it's asked (worker/src/index.js PERMANENT).
const LASTING = new Set(["no_range", "not_zip", "no_plist", "bad_plist", "too_large", "not_found"]);

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const httpUrl = (u) => (/^https?:\/\/[^\s]+$/i.test(str(u)) ? str(u) : null);
const osVersion = (v) => {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/.exec(str(v));
  if (!m || Number(m[1]) < 2 || Number(m[1]) > 40) return null;
  return [m[1], m[2] ?? "0", ...(m[3] ? [m[3]] : [])].join(".");
};
const families = (v) => {
  const list = (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : null;
};

export const needsCheck = (v) => Boolean(v && !str(v.minOSVersion) && httpUrl(v.downloadURL));

export function ipaInfoUrl(url, base = "") {
  const u = httpUrl(url);
  return u ? `${base}/api/ipainfo?${new URLSearchParams({ url: u })}` : null;
}

// The first "needs iOS N" a description states. A bare "iOS 17" (a feature list, "now on iOS 17") says nothing.
const TEXT = [
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*\+/i,                                                      // iOS 15+
  /\brequires?\s+(?:at\s+least\s+)?iOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\b/i,                          // Requires iOS 14.0
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*(?:or|and)\s*(?:later|newer|above|up|higher|greater)\b/i,  // iOS 15 or later
  /\b(?:minimum|min\.?)\s*(?:iOS|OS|system)?\s*(?:version)?\s*[:=-]?\s*(?:iOS\s*)?(\d{1,2}(?:\.\d{1,2}){0,2})\b/i, // Minimum iOS: 13
  /\biOS\s*(\d{1,2}(?:\.\d{1,2}){0,2})\s*(?:-|–|to)\s*(?:latest|now|current)\b/i,                   // iOS 14 - latest
];
export function textMinOS(text) {
  const t = str(text);
  if (!t) return null;
  for (const re of TEXT) {
    const v = osVersion(re.exec(t)?.[1]);
    if (v) return v;
  }
  return null;
}

export function withIpaInfo(target, info) {
  if (!target || !info) return target;
  const min = str(target.minOSVersion) || info.minOSVersion || undefined;
  const fam = families(target.deviceFamily) ?? info.deviceFamily ?? undefined;
  return { ...target, minOSVersion: min, deviceFamily: fam, ipaChecked: true, ipaFrom: str(target.minOSVersion) ? "source" : info.from ?? null };
}

// ---- Kept on the device ----------------------------------------------------------------------------------------

function parse(raw, now) {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object" || typeof v.at !== "number") return null;
    if (typeof v.until === "number" && v.until < now) return null;
    return { minOSVersion: osVersion(v.minOSVersion), deviceFamily: families(v.deviceFamily), from: v.from ?? null, at: v.at,
      ...(typeof v.until === "number" ? { until: v.until } : {}) };
  } catch { return null; }
}

export function savedInfo(store, url, now = Date.now()) {
  const u = httpUrl(url);
  if (!u || !store) return null;
  try { return parse(store.getItem(PREFIX + u), now); } catch { return null; }
}

export function allSaved(store, now = Date.now()) {
  const out = {};
  if (!store) return out;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const v = parse(store.getItem(k), now);
      if (v) out[k.slice(PREFIX.length)] = v;
    }
  } catch { /* unreadable storage: nothing kept */ }
  return out;
}

function save(store, url, info) {
  try { store?.setItem(PREFIX + url, JSON.stringify(info)); } catch { /* full or private: this visit only */ }
}

// ---- Asking ----------------------------------------------------------------------------------------------------

export function createQueue(n = 2) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= n || !waiting.length) return;
    const { fn, resolve, reject } = waiting.shift();
    running++;
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { running--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
}

const inflight = new Map();
const defaultQueue = createQueue(2);
export function clearIpaMemory() { inflight.clear(); }

export function checkIpa(url, { get, store = null, fallback = null, text = "", now = Date.now(), queue = defaultQueue } = {}) {
  const u = httpUrl(url);
  if (!u || typeof get !== "function") return Promise.resolve(null);
  const kept = savedInfo(store, u, now);
  if (kept) return Promise.resolve(kept);
  if (inflight.has(u)) return inflight.get(u);
  const p = queue(async () => {
    let ipa = null, lasting = false;
    try {
      const j = await get(u);
      if (j && typeof j === "object" && !j.code && !j.error) { ipa = j; lasting = true; }
      else if (LASTING.has(j?.code)) lasting = true;
    } catch { /* the Worker or the network: not kept */ }
    let min = osVersion(ipa?.minOSVersion), from = min ? "ipa" : null;
    if (!min && fallback) {
      min = osVersion(await Promise.resolve().then(fallback).catch(() => null));
      if (min) from = "appstore";
    }
    if (!min) { min = textMinOS(text); if (min) from = "text"; }
    const fam = families(ipa?.deviceFamily);
    const info = { minOSVersion: min, deviceFamily: fam, from: from ?? (fam ? "ipa" : null), at: now };
    if (lasting && !min && !fam) info.until = now + UNKNOWN_TTL;
    else if (!lasting) info.until = now + GUESS_TTL;
    if (lasting || min) save(store, u, info);
    return info;
  }).finally(() => inflight.delete(u));
  inflight.set(u, p);
  return p;
}
