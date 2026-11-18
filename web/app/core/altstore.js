// AltStore sources (F9): the JSON source format AltStore, SideStore, Feather and LiveContainer read, listing IPA
// apps for phones without a jailbreak. Pure JS, no DOM: the parse runs in the worker beside the APT catalog
// (core/catalog.js loadAlt), so an app is a catalog row like any package, in lists, Search and Changes.
//
//   parseAltSource(json | text)          -> { name, identifier, subtitle, description, iconURL, headerURL, website,
//                                            tintColor, featuredApps, news: [...], apps: [app] }  or throws
//   app: { id, bundleIdentifier, name, developerName, subtitle, localizedDescription, iconURL, tintColor, category,
//          screenshots: [{ url, width, height }], permissions: { entitlements: [{ name, description }],
//          privacy: [{ name, description }] }, versions: [version] }   (versions newest first, as the source lists them)
//          id: the catalog key, the bundle id; a variant sharing it gets <bundle id>~<name slug> (F42, see variantId)
//   version: { version, buildVersion, date, localizedDescription, downloadURL, size, minOSVersion, maxOSVersion }
//   runsOn(version, ios)                 -> false when the phone's iOS is outside min/maxOSVersion (ios null: true)
//   runnableVersions(app, ios)           -> the versions this phone can run: the only ones shown or filed in Changes
//   appStanza(app, source, ios)          -> the catalog's record for an app (null when no version runs here)
//   installOptions(version, sourceUrl)   -> { itms, download, open: [{ name, url }] }
//   newsToNotify(source, sentIds)        -> news items with notify: true not sent yet (for the push job, F10)
//   withAltSources(calls, backend, opts) -> a backend's source calls with AltStore sources kept beside the APT ones
//
// The format: https://faq.altstore.io/developers/make-a-source (2.0 with `versions`; 1.x apps carry version,
// versionDate, versionDescription, downloadURL and size on the app itself, and `screenshotURLs`/`permissions`).
// Anything optional that is missing or the wrong type is dropped, never thrown: sources are hand-written JSON.
//
// F16a: the list keeps every IPA source format (core/sources/detect.js FORMATS: altstore, esign, scarlet, gbox) as a
// record with `format`; parseSource(format, json) reads any of them into parseAltSource's shape (plus `extra`) through
// core/sources/ipa.js parseIpaSource. A record with `unsupported` (an encrypted GBox source) has a reason and no
// apps: its page shows the reason and the Open in row (F8).
import { pool, withTimeout, healthFields, REFRESH_TIMEOUT, REFRESH_CONCURRENCY } from "./health.js";
import { parseIpaSource } from "./sources/ipa.js";

export const ALT_PREFIX = "alt:";
export const isAltKey = (key) => String(key ?? "").startsWith(ALT_PREFIX);
export const altKey = (url) => ALT_PREFIX + url;

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const httpUrl = (v) => { const s = str(v); return /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// "#8A28F7", "8A28F7", "#abc" -> "#8a28f7"; anything else null (it goes into CSS, so only hex gets through).
export function tintOf(v) {
  const s = str(v).replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return "#" + s;
  if (/^[0-9a-f]{3}$/.test(s)) return "#" + [...s].map((c) => c + c).join("");
  return null;
}

// A date as epoch ms, or null. AltStore writes ISO 8601 ("2023-03-30T13:20:00-05:00" or "2023-03-30"). A bare
// date is that day on the phone (local midnight), not UTC midnight, which shows as the day before west of UTC.
export function dateOf(v) {
  const s = str(v);
  if (!s) return null;
  const day = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// "16.4.1" vs "16.4": by number, part by part; missing parts are 0.
export function compareOS(a, b) {
  const pa = str(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = str(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function runsOn(version, ios) {
  if (!ios) return true;
  if (version.minOSVersion && compareOS(ios, version.minOSVersion) < 0) return false;
  // maxOSVersion "16" means any 16.x (as core/compat.js reads it): compare on as many parts as the bound has.
  const max = version.maxOSVersion;
  if (max && compareOS(str(ios).split(".").slice(0, str(max).split(".").length).join("."), max) > 0) return false;
  return true;
}

export const runnableVersions = (app, ios) => app.versions.filter((v) => runsOn(v, ios));

function parseVersion(v, legacy = false) {
  if (!v || typeof v !== "object") return null;
  const version = str(v.version) || str(v.marketingVersion);
  const downloadURL = str(v.downloadURL);
  if (!version && !downloadURL) return null;
  return {
    version: version || "0", buildVersion: str(v.buildVersion) || null,
    date: dateOf(v.date ?? v.versionDate), localizedDescription: str(legacy ? v.versionDescription : v.localizedDescription ?? v.versionDescription),
    downloadURL: downloadURL || null, size: num(v.size),
    minOSVersion: str(v.minOSVersion) || null, maxOSVersion: str(v.maxOSVersion) || null,
    // Not AltStore's: a signed install manifest some sources add (see installOptions).
    manifestURL: httpUrl(v.manifestURL ?? v.installURL ?? v.itmsManifestURL),
  };
}

// screenshots: [url], [{ imageURL, width, height }], or { iphone: [...], ipad: [...] } (iPhone ones first);
// 1.x: screenshotURLs.
function parseScreenshots(app) {
  let list = app.screenshots ?? app.screenshotURLs;
  if (list && !Array.isArray(list) && typeof list === "object") list = [...(list.iphone ?? []), ...(list.ipad ?? [])];
  if (!Array.isArray(list)) return [];
  return list.map((s) => {
    if (typeof s === "string") return httpUrl(s) ? { url: s.trim(), width: null, height: null } : null;
    const url = httpUrl(s?.imageURL ?? s?.url);
    return url ? { url, width: num(s.width), height: num(s.height) } : null;
  }).filter(Boolean);
}

// The usage-description keys AltStore shows by name (NSCameraUsageDescription -> Camera).
const PRIVACY_NAMES = {
  NSCameraUsageDescription: "Camera", NSMicrophoneUsageDescription: "Microphone",
  NSPhotoLibraryUsageDescription: "Photos", NSPhotoLibraryAddUsageDescription: "Add to Photos",
  NSLocationWhenInUseUsageDescription: "Location", NSLocationAlwaysAndWhenInUseUsageDescription: "Location (Always)",
  NSLocationAlwaysUsageDescription: "Location (Always)", NSContactsUsageDescription: "Contacts",
  NSCalendarsUsageDescription: "Calendars", NSRemindersUsageDescription: "Reminders",
  NSBluetoothAlwaysUsageDescription: "Bluetooth", NSBluetoothPeripheralUsageDescription: "Bluetooth",
  NSLocalNetworkUsageDescription: "Local Network", NSFaceIDUsageDescription: "Face ID",
  NSMotionUsageDescription: "Motion", NSSpeechRecognitionUsageDescription: "Speech Recognition",
  NSAppleMusicUsageDescription: "Media Library", NSHealthShareUsageDescription: "Health",
  NSHealthUpdateUsageDescription: "Health (Write)", NSHomeKitUsageDescription: "Home",
  NSUserTrackingUsageDescription: "Tracking", NSSiriUsageDescription: "Siri",
};
export const privacyName = (key) => PRIVACY_NAMES[key] ?? str(key).replace(/^NS/, "").replace(/UsageDescription$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");

// appPermissions (2.0): { entitlements: ["com.apple..."] | [{ name }], privacy: { NSKey: text } | [{ name, usageDescription }] }.
// 1.x: permissions: [{ type: "photos", usageDescription }].
function parsePermissions(app) {
  const out = { entitlements: [], privacy: [] };
  const ap = app.appPermissions;
  if (ap && typeof ap === "object") {
    for (const e of Array.isArray(ap.entitlements) ? ap.entitlements : []) {
      const name = typeof e === "string" ? e.trim() : str(e?.name);
      if (name) out.entitlements.push({ name, description: typeof e === "object" ? str(e.usageDescription) : "" });
    }
    const pv = ap.privacy;
    if (Array.isArray(pv)) {
      for (const p of pv) if (str(p?.name)) out.privacy.push({ name: privacyName(str(p.name)), key: str(p.name), description: str(p.usageDescription) });
    } else if (pv && typeof pv === "object") {
      for (const [k, d] of Object.entries(pv)) out.privacy.push({ name: privacyName(k), key: k, description: str(d) });
    }
  }
  for (const p of Array.isArray(app.permissions) ? app.permissions : []) {
    const t = str(p?.type);
    if (t) out.privacy.push({ name: t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, " "), key: t, description: str(p.usageDescription) });
  }
  // Sources often list one permission twice (2.0's NSCameraUsageDescription and 1.x's type "camera", or a key
  // repeated): one row per name, keeping a description where either has one.
  const once = (list) => {
    const seen = new Map();
    for (const x of list) {
      const k = x.name.toLowerCase();
      const had = seen.get(k);
      if (!had) seen.set(k, x);
      else if (!had.description && x.description) seen.set(k, { ...had, description: x.description });
    }
    return [...seen.values()];
  };
  return { entitlements: once(out.entitlements), privacy: once(out.privacy) };
}

function parseApp(a) {
  if (!a || typeof a !== "object") return null;
  const bundleIdentifier = str(a.bundleIdentifier);
  if (!bundleIdentifier) return null;
  let versions = (Array.isArray(a.versions) ? a.versions : []).map((v) => parseVersion(v)).filter(Boolean);
  if (!versions.length) {
    const legacy = parseVersion(a, true); // 1.x: the one version on the app itself
    if (legacy) versions = [legacy];
  }
  if (!versions.length) return null;
  return {
    bundleIdentifier, name: str(a.name) || bundleIdentifier, developerName: str(a.developerName),
    subtitle: str(a.subtitle), localizedDescription: str(a.localizedDescription), iconURL: httpUrl(a.iconURL),
    tintColor: tintOf(a.tintColor), category: str(a.category).toLowerCase() || null, beta: a.beta === true,
    screenshots: parseScreenshots(a), permissions: parsePermissions(a), versions,
  };
}

function parseNews(n) {
  if (!n || typeof n !== "object") return null;
  const title = str(n.title);
  if (!title) return null;
  return {
    identifier: str(n.identifier) || `${title}|${str(n.date)}`, title, caption: str(n.caption), date: dateOf(n.date),
    tintColor: tintOf(n.tintColor), imageURL: httpUrl(n.imageURL), url: httpUrl(n.url), appID: str(n.appID) || null,
    notify: n.notify === true,
  };
}

// F42: sources that list a bundle id more than once. AppTesters (ESign-style) lists one entry per version under
// the same name (10,279 entries for 789 ids): those merge into one app, the versions in the order the source
// lists them (newest first), sorted by date when every one has a date. RyukSign lists variants of one app under
// one bundle id with different names ("RyukGram (Duplicate)", "... (Duplicate, iOS 15)"): each stays its own app
// and row. The first keeps the bundle id as its `id` (the catalog key); a later variant gets
// `<bundle id>~<name slug>` (~2, ~3 if that is taken too). `bundleIdentifier` stays the real one on every app.
const nameSlug = (s) => str(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "app";
const entryKey = (app) => `${app.bundleIdentifier}\n${app.name.toLowerCase()}`;

function variantId(app, seen) {
  if (!seen.has(app.bundleIdentifier)) return app.bundleIdentifier;
  const base = `${app.bundleIdentifier}~${nameSlug(app.name)}`;
  let id = base;
  for (let n = 2; seen.has(id); n++) id = `${base}~${n}`;
  return id;
}

// Adds the versions an app doesn't have yet (same version and IPA: the same build listed twice).
function mergeVersions(app, versions) {
  const have = new Set(app.versions.map((v) => `${v.version}\n${v.downloadURL}`));
  for (const v of versions) {
    const k = `${v.version}\n${v.downloadURL}`;
    if (have.has(k)) continue;
    have.add(k);
    app.versions.push(v);
    app.merged = true;
  }
}

// Newest first by date, only when every version has one (an undated entry has no place in the order); stable.
function sortByDate(versions) {
  if (versions.every((v) => v.date != null)) versions.sort((a, b) => b.date - a.date);
}

// Does this parsed JSON look like an AltStore source? An object with an apps array (empty counts: a new source).
export const looksLikeAltSource = (json) => Boolean(json && typeof json === "object" && !Array.isArray(json) && Array.isArray(json.apps));

export function parseAltSource(input) {
  let json = input;
  if (typeof input === "string") {
    try { json = JSON.parse(input.replace(/^﻿/, "")); } catch { throw new Error("The source is not valid JSON."); }
  }
  if (!looksLikeAltSource(json)) throw new Error("This JSON is not an AltStore source (it has no apps list).");
  const apps = [];
  const seen = new Set(); // app ids (catalog keys): the bundle id, or a variant's bundleid~name
  const byName = new Map(); // bundle id + name -> app, for repeated entries (F42)
  for (const a of json.apps) {
    const app = parseApp(a);
    if (!app) continue;
    const same = byName.get(entryKey(app));
    if (same) { mergeVersions(same, app.versions); continue; }
    app.id = variantId(app, seen);
    seen.add(app.id);
    byName.set(entryKey(app), app);
    apps.push(app);
  }
  for (const app of apps) if (app.merged) { sortByDate(app.versions); delete app.merged; }
  const news = (Array.isArray(json.news) ? json.news : []).map(parseNews).filter(Boolean)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return {
    name: str(json.name), identifier: str(json.identifier), subtitle: str(json.subtitle), description: str(json.description),
    iconURL: httpUrl(json.iconURL), headerURL: httpUrl(json.headerURL), website: httpUrl(json.website),
    tintColor: tintOf(json.tintColor),
    featuredApps: (Array.isArray(json.featuredApps) ? json.featuredApps : []).map(str).filter((id) => seen.has(id)),
    news, apps,
  };
}

// AltStore's categories -> Cydian sections, under "Apps" so Search's Apps scope finds them (core/catalog.js
// SECTION_GROUPS): "Apps (Games)", "Apps (Photo & Video)"; none: "Apps".
const CATEGORY = { developer: "Developer", entertainment: "Entertainment", games: "Games", lifestyle: "Lifestyle",
  other: "Other", "photo-video": "Photo & Video", social: "Social", utilities: "Utilities" };
export function appSection(category) {
  if (!category) return "Apps";
  const c = CATEGORY[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
  return `Apps (${c})`;
}

// The catalog's record for an app: shaped like a control stanza where the catalog reads one (package, name,
// version, section, description, author, size, iconUrl) plus `ipa`, the whole app with only the versions this
// phone runs. The newest of those is the candidate. Null when no version runs on `ios` (hidden everywhere, and
// never filed in Changes or notified).
export function appStanza(app, source, ios = null) {
  const versions = runnableVersions(app, ios);
  if (!versions.length) return null;
  const v = versions[0];
  const short = app.subtitle || app.localizedDescription.split("\n")[0].slice(0, 120);
  const long = app.localizedDescription || app.subtitle;
  return {
    package: app.id ?? app.bundleIdentifier, name: app.name, version: v.version, section: appSection(app.category),
    // "Description: short\n long" is how core/apt.js description() splits it.
    description: long && long !== short ? `${short}\n ${long.replace(/\n/g, "\n ")}` : short,
    author: app.developerName, size: v.size ?? undefined, iconUrl: app.iconURL,
    minOSVersion: v.minOSVersion ?? undefined, maxOSVersion: v.maxOSVersion ?? undefined,
    kind: "ipa",
    ipa: { ...app, versions, sourceUrl: source?.url ?? null, sourceName: source?.name ?? "" },
  };
}

// How an app gets onto the phone. iOS installs an IPA over the air only from an itms-services link to a signed
// manifest, so that is offered only where the source gives one: a downloadURL that already is itms-services://,
// or a manifestURL (an https .plist). Otherwise the app opens in a sideloader that signs on the phone (AltStore,
// SideStore, Feather) by adding the source there; `download` is the raw IPA for doing it by hand.
// AltStore and SideStore take <scheme>://source?url=<encoded url>; Feather takes feather://source/<url>, the URL
// unencoded after the path (FeatherApp.swift, `validatedScheme(after: "/source/")`), as for /install/ (B6).
const sourceQuery = (scheme) => (u) => `${scheme}://source?url=${encodeURIComponent(u)}`;
export const SIDELOADERS = [
  { name: "AltStore", scheme: "altstore", source: sourceQuery("altstore") },
  { name: "SideStore", scheme: "sidestore", source: sourceQuery("sidestore") },
  { name: "Feather", scheme: "feather", source: (u) => `feather://source/${u}` },
];

export function installOptions(version, sourceUrl) {
  let itms = null;
  const dl = str(version?.downloadURL);
  if (/^itms-services:\/\//i.test(dl)) itms = dl;
  else if (version?.manifestURL) itms = `itms-services://?action=download-manifest&url=${encodeURIComponent(version.manifestURL)}`;
  const download = httpUrl(dl);
  const url = httpUrl(sourceUrl);
  const open = url ? SIDELOADERS.map(({ name, source }) => ({ name, url: source(url) })) : [];
  return { itms, download, open };
}

// F37: GET on a phone without a jailbreak: the IPA handed to the sideloader Settings > Sideloader picks, straight
// from the source's own URL (never through a server of ours). Feather takes feather://install/<url> (FeatherApp.swift,
// `validatedScheme(after: "/install/")`); AltStore and SideStore take <scheme>://install?url=<encoded url>.
// "download" is the IPA itself. Returns { name, url } or null when the version has no http(s) IPA.
export const SIDELOADER_INSTALL = {
  feather: { name: "Feather", link: (u) => `feather://install/${u}` },
  altstore: { name: "AltStore", link: (u) => `altstore://install?url=${encodeURIComponent(u)}` },
  sidestore: { name: "SideStore", link: (u) => `sidestore://install?url=${encodeURIComponent(u)}` },
  download: { name: null, link: (u) => u },
};
export function sideloaderLink(version, sideloader = "feather") {
  const ipa = httpUrl(version?.downloadURL);
  if (!ipa) return null;
  const s = SIDELOADER_INSTALL[sideloader] ?? SIDELOADER_INSTALL.feather;
  return { name: s.name, url: s.link(ipa) };
}

// News items flagged notify: true that haven't been pushed (sentIds: identifiers already sent), newest first.
export function newsToNotify(source, sentIds = []) {
  const sent = new Set(sentIds);
  return (source?.news ?? []).filter((n) => n.notify && !sent.has(n.identifier));
}

// ---- adding and refreshing -----------------------------------------------------------------------------------

// What the user typed -> the source URL, or null when it isn't an http(s) URL. A sideloader link
// (altstore://source?url=..., sidestore://, feather://) gives its url. No trailing slash is added: a source is a file.
export function normalizeAltUrl(input) {
  let s = str(input);
  const link = s.match(/^[a-z][a-z0-9+.-]*:\/\/source\/?\?(.*)$/i);
  if (link && !/^https?:/i.test(s)) s = new URLSearchParams(link[1]).get("url") ?? "";
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  if (!/^https?:\/\/[^#\s/?]+[^#\s]*$/i.test(s)) return null;
  try { return new URL(s).href; } catch { return null; }
}

// Worth trying as AltStore before APT: a .json file, or a sideloader link.
export const looksLikeAltUrl = (input) => /^(altstore|sidestore|feather):\/\//i.test(str(input)) || /\.json([?#]|$)/i.test(str(input));

// The record the source list keeps: { key, kind: "altstore", uri, name, iconURL, tintColor, count, updated, error }.
export function altRecord(url, parsed) {
  return { key: altKey(url), kind: "altstore", uri: url, name: parsed.name || null, iconURL: parsed.iconURL,
    tintColor: parsed.tintColor, count: parsed.apps.length, updated: Date.now(), error: null };
}

// Fetches and parses a source; throws an Error with a `kind` (invalid_url, not_altstore) or the backend's code.
export async function verifyAltSource(backend, input) {
  const url = normalizeAltUrl(input);
  if (!url) throw Object.assign(new Error("That is not a valid source URL. Please check it and try again."), { kind: "invalid_url", title: "Invalid URL" });
  const text = await backend.text(url);
  let parsed;
  try { parsed = parseAltSource(text); } catch (e) {
    throw Object.assign(new Error(e.message), { kind: "not_altstore", title: "Did not Find Source" });
  }
  return altRecord(url, parsed);
}

// F16a: an IPA source's JSON (text or parsed) by its record's `format` (none: AltStore, the records from before
// F16a) -> parseAltSource's result with `format` and `extra` (core/sources/ipa.js parseIpaSource), so the rows and
// extras are the same whether the source was just added, refreshed, or loaded into the catalog. Throws.
export function parseSource(format, input) {
  const fmt = format || "altstore";
  let json = input;
  if (typeof input === "string") {
    try { json = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("The source is not valid JSON."); }
  }
  if (fmt === "altstore" && !looksLikeAltSource(json)) throw new Error("This JSON is not an AltStore source (it has no apps list).");
  return parseIpaSource(fmt, json);
}

// An encrypted GBox source (appRepositories is a string): known, but only GBox can read it (detect.js detectJson).
export const GBOX_ENCRYPTED = "This GBox source is encrypted, so only GBox can read it.";
const unreadable = (format, input) => {
  if (format !== "gbox") return null;
  try {
    const json = typeof input === "string" ? JSON.parse(input.replace(/^\uFEFF/, "")) : input;
    return typeof json?.appRepositories === "string" ? GBOX_ENCRYPTED : null;
  } catch { return null; }
};

export async function refreshAltSource(backend, source) {
  try {
    const text = await backend.text(source.uri);
    const reason = unreadable(source.format, text);
    // Still encrypted: nothing to read, and no error either (the page says why and offers Open in).
    if (reason) return { updated: Date.now(), error: null, count: null, unsupported: reason };
    const parsed = parseSource(source.format, text);
    const { key, kind, uri, ...fields } = altRecord(source.uri, parsed);
    if (source.format) fields.format = source.format;
    // A source that was unsupported and now reads (GBox dropped the encryption) loses the mark.
    if (source.unsupported) fields.unsupported = null;
    return fields;
  } catch (e) {
    return { updated: Date.now(), error: e?.message || String(e) };
  }
}

// F16a: Telesphoreo's suite for this phone, as Cydia writes it: ios/<kCFCoreFoundationVersionNumber %.2f>
// (docs/cydia.md, ios/793.00 on the 4S), or null without a number.
export function coreFoundationDist(cf) {
  const n = Number(cf);
  return Number.isFinite(n) && n > 0 ? `ios/${n.toFixed(2)}` : null;
}

// A default source's record before its first refresh: the URL and nothing read from it yet (F28).
export function seedRecord(url) {
  return { key: altKey(url), kind: "altstore", uri: url, name: null, iconURL: null, tintColor: null, count: null,
    updated: null, error: null };
}

// F43: a source nothing has been read from yet (a seedRecord: no refresh, not even a failed one, has saved
// `updated`), so its row would show the bare host and a letter icon.
export const neverLoaded = (source) => Boolean(source) && source.updated == null && !source.error;

// The AltStore source list: its own IndexedDB database, so the APT list, apt's sources.list in the app (F33) and
// its helper never see these. `defaults` (URLs, core/sources.js DEFAULT_ALT_SOURCES on the site) go in once, the
// first time a store with a "meta" store opens (version 2), so a default the user deletes stays deleted.
export function openAltStore({ indexedDB: idb = globalThis.indexedDB, name = "cydian-altsources", defaults = [] } = {}) {
  if (!idb) return Promise.reject(new Error("IndexedDB is not available"));
  return new Promise((resolve, reject) => {
    const req = idb.open(name, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, f) => new Promise((res, rej) => {
        const tx = db.transaction("sources", mode);
        const r = f(tx.objectStore("sources"));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error ?? r?.error);
        tx.onabort = () => rej(tx.error ?? new Error("transaction aborted"));
      });
      const meta = (mode, f) => new Promise((res, rej) => {
        const tx = db.transaction("meta", mode);
        const r = f(tx.objectStore("meta"));
        tx.oncomplete = () => res(r?.result);
        tx.onerror = () => rej(tx.error ?? r?.error);
        tx.onabort = () => rej(tx.error ?? new Error("transaction aborted"));
      });
      const store = {
        list: () => run("readonly", (s) => s.getAll()),
        get: (key) => run("readonly", (s) => s.get(key)),
        put: (rec) => run("readwrite", (s) => s.put(rec)).then(() => rec),
        remove: (key) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
      };
      const seed = async () => {
        if (!defaults.length || await meta("readonly", (s) => s.get("seeded"))) return;
        for (const url of defaults) if (!(await store.get(altKey(url)))) await store.put(seedRecord(url));
        await meta("readwrite", (s) => s.put({ key: "seeded", at: Date.now() }));
      };
      seed().then(() => resolve(store), reject);
    };
  });
}

// Wraps a backend's source calls (core/sources.js sourceCalls, or backend-native's) so AltStore sources live
// beside the APT ones: listed together (`sort`: the list's order), added from the same Add Source alert, removed
// and refreshed by key. F16a: Add Source asks core/sources/add.js detectSource what the URL is: an IPA source of
// any format (AltStore, ESign, Scarlet, GBox; an encrypted GBox one saved with `unsupported`) goes in this list
// with its `format`; an APT repo (flat, or dist under dists/<d>/ for each `dists` candidate) goes to the wrapped
// calls, which save it their own way (apt's sources in the app). A dist repo given as { uri, dist, components }
// (F48) goes straight to the wrapped calls.
// opts: { indexedDB, altName, sort, altDefaults: URLs seeded once (F28), arch: () => string, count,
//         dists: [suite] or () => [suite] (add.js DEFAULT_DISTS when none; give it coreFoundationDist's suite),
//         coreFoundation: () => number, the phone's kCFCoreFoundationVersionNumber (adds its Telesphoreo suite) }.
export function withAltSources(calls, backend, opts = {}) {
  let opened = null;
  const store = () => (opened ??= openAltStore({ indexedDB: opts.indexedDB, name: opts.altName, defaults: opts.altDefaults }));
  const sort = opts.sort ?? ((l) => l);
  const value = (v) => (typeof v === "function" ? v() : v);
  async function saveAlt(rec) {
    const db = await store();
    const cur = await db.get(rec.key);
    const next = { ...cur, ...rec };
    if (!rec.unsupported) delete next.unsupported;
    return db.put(next);
  }
  // Loaded when first needed: add.js imports core/sources.js, which imports this file.
  async function detectOpts() {
    const { DEFAULT_DISTS } = await import("./sources/add.js");
    const dists = [...(value(opts.dists) ?? DEFAULT_DISTS)];
    const cf = coreFoundationDist(value(opts.coreFoundation));
    if (cf && !dists.includes(cf)) dists.push(cf);
    const arch = value(opts.arch);
    return { ...(arch ? { arch } : {}), ...(opts.count ? { count: opts.count } : {}), dists };
  }
  return {
    async sources() {
      const [apt, alt] = await Promise.all([calls.sources(), store().then((db) => db.list()).catch(() => [])]);
      return sort([...apt, ...alt]);
    },
    async addSource(input) {
      if (input && typeof input === "object") return calls.addSource(input);
      const { detectSource } = await import("./sources/add.js");
      const found = await detectSource(backend, input, await detectOpts());
      if (found.kind === "ipa") return saveAlt(found.source);
      const s = found.source;
      // The wrapped calls check it again on their own terms (and the app writes it into apt's sources).
      return calls.addSource(!s.dist || s.dist.endsWith("/") ? s.uri : { uri: s.uri, dist: s.dist, components: s.components });
    },
    async removeSource(key) {
      if (isAltKey(key)) return (await store()).remove(key);
      return calls.removeSource(key);
    },
    // `filter` (F41, core/sources.js sourceFilter): only the sources it keeps are fetched. When it keeps no APT
    // source the wrapped calls aren't asked at all (no proxy fetches, no apt-get update in the app).
    async refreshSources(onEach = () => {}, { filter } = {}) {
      const keep = filter ?? (() => true);
      const db = await store().catch(() => null);
      const alt = (db ? await db.list().catch(() => []) : []).filter(keep);
      const aptWanted = !filter || (await calls.sources().catch(() => [])).some(keep);
      const [apt, alts] = await Promise.all([
        aptWanted ? calls.refreshSources(onEach, filter ? { filter } : undefined) : [],
        // F19: in waves, each with a time limit, and the health fields (core/health.js) saved with the result.
        pool(alt, opts.concurrency ?? REFRESH_CONCURRENCY, async (s) => {
          let fields;
          try {
            fields = await withTimeout(refreshAltSource(backend, s), opts.timeout ?? REFRESH_TIMEOUT);
          } catch (e) {
            fields = { updated: Date.now(), error: e?.message || String(e) };
          }
          const next = await db.put({ ...s, ...fields, ...healthFields(s, fields) });
          onEach(next);
          return next;
        }),
      ]);
      return [...(apt ?? []), ...alts];
    },
  };
}
