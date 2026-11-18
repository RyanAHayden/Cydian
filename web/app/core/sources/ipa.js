// IPA source formats -> the AltStore shape (F16), so every format becomes the same catalog rows as F9's AltStore
// sources (core/altstore.js parseAltSource + appStanza): Sources, Changes, Search, upgrades and push need nothing
// per format.
//
//   toAltSource(format, json)         -> AltStore source JSON (what parseAltSource reads) for altstore, esign,
//                                        scarlet or gbox JSON. Throws on a format that has nothing to read.
//   parseIpaSource(format, json)      -> parseAltSource's result plus `format`, and the fields the format has that
//                                        AltStore doesn't read, kept as `extra` on the source, each app and each
//                                        version (SideStore's absoluteVersion, AltStore's sha256 and patreon, ESign's
//                                        lock/type, Scarlet's contact/debs/appstore, GBox's appType…).
//   ipaRows(parsed, source, ios)      -> the catalog rows: appStanza for each app that runs on `ios`.
//
// Apps with no bundle id (ESign often, GBox always) get a stable made-up one: `<format>.<name slug>`, so a refresh
// keeps the same row and Changes sees a version bump, not a new app.
import { parseAltSource, appStanza, str, httpUrl } from "../altstore.js";
import { NAME } from "../../brand.js";

const isObj = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));

export const slug = (s) => str(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "app";

// A bundle id that looks like one: reverse-DNS with at least one dot and no spaces.
const realId = (v) => { const s = str(v); return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(s) ? s : ""; };

// Ids must be unique in a source; Scarlet repos list tweaked builds under the original app's bundle id (two
// Pokémon GO builds), so a repeat gets the app's name after it. An entry with the same id and the same name is the
// same app (AppTesters lists one ESign entry per version, B7): it keeps that id, so parseAltSource merges the
// entries into one version history (F42).
function idMaker(format) {
  const used = new Set();
  const given = new Map(); // id + name -> the id handed out
  return (id, name) => {
    const key = `${id}\n${str(name).toLowerCase()}`;
    if (given.has(key)) return given.get(key);
    let out = id || `${format}.${slug(name)}`;
    if (used.has(out)) out = `${out}.${slug(name)}`;
    for (let n = 2; used.has(out); n++) out = `${out.replace(/~\d+$/, "")}~${n}`;
    used.add(out);
    given.set(key, out);
    return out;
  };
}

// "2019-11-23T08:00:00+0800", "2019-12-27T9:30:00+0800" (GBox) -> ISO 8601 that Date.parse reads.
export function isoDate(v) {
  let s = str(v);
  if (!s) return "";
  s = s.replace(/T(\d)(?=:)/, "T0$1").replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/ (?=\d{2}:)/, "T");
  return s;
}

// "14.0", "14.0 - 16.1.2", "14.0 - 15.7.1 and 16 - 16.1.2" (Scylla's iOS) -> min and max; the gaps between ranges
// are not kept.
export function osRange(v) {
  const nums = str(v).match(/\d+(?:\.\d+)*/g) ?? [];
  if (!nums.length) return {};
  const out = { minOSVersion: nums[0] };
  if (nums.length > 1) out.maxOSVersion = nums[nums.length - 1];
  return out;
}

function pick(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.has(k)) out[k] = obj[k];
  return out;
}

// ---- AltStore family (and ESign) -----------------------------------------------------------------------------

const ALT_SOURCE_KEYS = new Set(["name", "identifier", "subtitle", "description", "iconURL", "headerURL", "website",
  "tintColor", "featuredApps", "news", "apps"]);
const ALT_APP_KEYS = new Set(["bundleIdentifier", "name", "developerName", "subtitle", "localizedDescription", "iconURL",
  "tintColor", "category", "beta", "screenshots", "screenshotURLs", "appPermissions", "permissions", "versions",
  "version", "versionDate", "versionDescription", "downloadURL", "size", "marketingVersion", "buildVersion",
  "minOSVersion", "maxOSVersion", "date", "localizedDescription"]);
const ALT_VERSION_KEYS = new Set(["version", "marketingVersion", "buildVersion", "date", "versionDate",
  "localizedDescription", "versionDescription", "downloadURL", "size", "minOSVersion", "maxOSVersion"]);

// Repeated ids are left as they are (F16a): parseAltSource merges an id listed again under the same name into one
// app's versions and keeps other names as variants (F42, AppTesters lists one entry per version). An app with no
// real id gets esign.<name slug>, the same for each entry of one app, so those merge too.
function esignToAlt(json) {
  const id = (real, name) => real || `esign.${slug(name)}`;
  return {
    ...json,
    name: str(json.name),
    description: str(json.description) || str(json.message),
    iconURL: httpUrl(json.iconURL) ?? httpUrl(json.sourceicon),
    apps: json.apps.filter(isObj).map((a) => ({ ...a, bundleIdentifier: id(realId(a.bundleIdentifier), a.name) })),
  };
}

// ---- Scarlet (and Scylla) ------------------------------------------------------------------------------------

const SCARLET_APP_KEYS = new Set(["name", "version", "icon", "down", "ipa", "dev", "developer", "category",
  "description", "bundleID", "screenshots", "changelog", "color", "iOS"]);

function scarletToAlt(json) {
  const meta = isObj(json.META) ? json.META : isObj(json.Info) ? json.Info : {};
  const id = idMaker("scarlet");
  const apps = [];
  for (const [group, list] of Object.entries(json)) {
    if (group === "META" || group === "Info" || !Array.isArray(list)) continue;
    for (const a of list) {
      if (!isObj(a)) continue;
      const down = str(a.down) || str(a.ipa) || str(a.downloadURL);
      if (!down || !str(a.name)) continue;
      apps.push({
        name: str(a.name),
        bundleIdentifier: id(realId(a.bundleID) || realId(a.appstore), a.name),
        developerName: str(a.dev) || str(a.developer),
        localizedDescription: str(a.description),
        iconURL: a.icon,
        tintColor: a.color,
        category: str(a.category) || group,
        screenshots: Array.isArray(a.screenshots) ? a.screenshots : undefined,
        versions: [{ version: str(a.version) || "0", downloadURL: down, localizedDescription: str(a.changelog), ...osRange(a.iOS) }],
        extra: { group, ...pick(a, SCARLET_APP_KEYS) },
      });
    }
  }
  return {
    name: str(meta.repoName), description: str(meta.repoDescription), iconURL: meta.repoIcon,
    apps, extra: { ...pick(meta, new Set(["repoName", "repoIcon", "repoDescription"])) },
  };
}

// ---- GBox ----------------------------------------------------------------------------------------------------

const GBOX_APP_KEYS = new Set(["appName", "appVersion", "appImage", "appPackage", "appPlist", "appDescription",
  "appUpdateTime", "appCateIndex"]);

function gboxToAlt(json) {
  const cats = Array.isArray(json.appCategories) ? json.appCategories.map(str) : [];
  const id = idMaker("gbox");
  const apps = [];
  const links = [];
  for (const a of json.appRepositories) {
    if (!isObj(a) || a.hide === true) continue;
    // LINK entries are web links (adverts, a home page), not apps.
    if (str(a.appType).toUpperCase() === "LINK") {
      if (httpUrl(a.appLink)) links.push({ title: str(a.appName), url: httpUrl(a.appLink) });
      continue;
    }
    const pkg = str(a.appPackage);
    const plist = httpUrl(a.appPlist);
    if (!str(a.appName) || (!pkg && !plist)) continue;
    apps.push({
      name: str(a.appName),
      bundleIdentifier: id("", a.appName),
      developerName: str(json.sourceAuthor),
      localizedDescription: str(a.appDescription),
      iconURL: a.appImage,
      category: cats[Number(a.appCateIndex)] || undefined,
      versions: [{
        version: str(a.appVersion) || "0", date: isoDate(a.appUpdateTime), downloadURL: pkg || undefined,
        // appPlist is the app's install manifest when it is one (GBox also takes a share-page link there).
        manifestURL: plist && /\.plist([?#]|$)/i.test(plist) ? plist : undefined,
      }],
      extra: pick(a, GBOX_APP_KEYS),
    });
  }
  return {
    name: str(json.sourceName), description: str(json.sourceDescription), iconURL: json.sourceImage,
    website: json.sourceLinkUrl, apps,
    extra: { ...pick(json, new Set(["sourceName", "sourceDescription", "sourceImage", "sourceLinkUrl", "appRepositories"])),
      ...(links.length ? { links } : {}) },
  };
}

// ---- shared --------------------------------------------------------------------------------------------------

export function toAltSource(format, json) {
  if (!isObj(json)) throw new Error("The source is not a JSON object.");
  switch (format) {
    case "altstore": return json;
    case "esign": return esignToAlt(json);
    case "scarlet": return scarletToAlt(json);
    case "gbox":
      if (!Array.isArray(json.appRepositories)) throw new Error("This GBox source is encrypted, so only GBox can read it.");
      return gboxToAlt(json);
    default: throw new Error(`${NAME} can't read ${format} sources as apps.`);
  }
}

const sameVersion = (raw, v) => str(raw?.version ?? raw?.marketingVersion) === v.version && (str(raw?.downloadURL) || null) === v.downloadURL;

const rawKey = (id, name) => `${id}\n${name.toLowerCase()}`;

export function parseIpaSource(format, json) {
  const alt = toAltSource(format, json);
  const parsed = parseAltSource(alt);
  const native = format === "altstore" || format === "esign";
  // The raw entries behind each parsed app, keyed the way parseAltSource groups them (bundle id + name, F42):
  // RyukSign-style variants share a bundle id but not a name, and an AppTesters app is many entries (B7).
  const rawApps = new Map();
  for (const a of alt.apps.filter(isObj)) {
    const k = rawKey(str(a.bundleIdentifier), str(a.name) || str(a.bundleIdentifier));
    if (!rawApps.has(k)) rawApps.set(k, []);
    rawApps.get(k).push(a);
  }
  for (const app of parsed.apps) {
    const raws = rawApps.get(rawKey(app.bundleIdentifier, app.name)) ?? [];
    const raw = raws[0] ?? {};
    app.extra = native ? pick(raw, ALT_APP_KEYS) : { ...(raw.extra ?? {}) };
    delete app.extra.extra;
    const rawVersions = raws.flatMap((r) => (Array.isArray(r.versions) ? r.versions : []));
    for (const v of app.versions) {
      const rv = rawVersions.find((r) => sameVersion(r, v));
      const extra = rv && native ? pick(rv, ALT_VERSION_KEYS) : {};
      if (Object.keys(extra).length) v.extra = extra;
    }
  }
  parsed.format = format;
  parsed.extra = native ? pick(alt, ALT_SOURCE_KEYS) : { ...(alt.extra ?? {}) };
  return parsed;
}

export function ipaRows(parsed, source, ios = null) {
  return parsed.apps.map((app) => appStanza(app, source, ios)).filter(Boolean);
}
