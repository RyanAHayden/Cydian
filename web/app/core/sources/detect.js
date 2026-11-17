// Source format detection (F16): one `detect(url, body)` that says what kind of source a URL served, so the user
// never picks the kind when adding a source. Pure JS, no DOM, no network: core/sources/add.js does the fetching.
//
//   detect(url, body)       -> { format, name, kind: "apt" | "ipa", parsable, reason?, json?, apt? }  or throws
//                              SourceFormatError. `body` is a string, ArrayBuffer or Uint8Array.
//   unwrapLink(input)       -> { url, via } the http(s) URL inside a package-manager or sideloader link
//                              (altstore://source?url=…, scarlet://repo=…, sileo://source/…), or a bare host with
//                              https:// in front; null when there is no http(s) URL in it.
//   aptLayoutFromUrl(url, release?) -> { uri, dist, components, file, compression } for a URL that points into an
//                              APT repo: a Packages index at any of the paths Cydia reads (flat, or
//                              dists/<dist>/<component>/binary-<arch>/), a Release/InRelease, or a dists/<dist>/ dir.
//   detectJson(json)        -> { format, parsable, reason? } for parsed JSON, or null when it is no source we know.
//
// The formats (fixtures in core/fixtures/sources/, journal/2026-11-17-f16-source-formats for where each came from):
//   apt       Release + Packages (plain, .gz, .bz2, .xz, .lzma, .zst), dist or flat.
//   altstore  AltStore source JSON: AltStore Classic and PAL, SideStore, Feather, LiveContainer, StikStore, KSign and
//             TrollApps all read it (TrollApps' docs: "a json structure extremely similar to AltStore").
//   esign     ESign's JSON: AltStore 1.x fields plus sourceicon, message, payURL/unlockURL, and per app type,
//             lock, isLanZouCloud; bundleIdentifier is often missing or not a real id.
//   scarlet   Scarlet's repo JSON: { META: { repoName, repoIcon }, <group>: [{ name, version, down, bundleID, … }] }.
//             Scylla's repos are the same shape with `Info` for META and `ipa`/`developer` for `down`/`dev`.
//   gbox      GBox's JSON: { sourceName, appCategories, appRepositories: [{ appName, appVersion, appPackage, … }] }.
//             GBox can encrypt appRepositories into a string; that is detected but can't be read (parsable false),
//             so the source still gets the "Open in" row (F8) for GBox.
import { parseControl, parseRelease } from "../apt.js";
import { SourceError } from "../sources.js";

// Who reads each format: the apps an "Open in" row (F8) can hand a source of this format to.
export const FORMATS = {
  apt: { name: "APT repository", kind: "apt", readers: ["Cydia", "Sileo", "Zebra", "Installer"] },
  altstore: {
    name: "AltStore source", kind: "ipa",
    readers: ["AltStore Classic", "AltStore PAL", "SideStore", "Feather", "LiveContainer", "StikStore", "KSign", "TrollApps"],
  },
  esign: { name: "ESign source", kind: "ipa", readers: ["ESign"] },
  scarlet: { name: "Scarlet repo", kind: "ipa", readers: ["Scarlet"] },
  gbox: { name: "GBox source", kind: "ipa", readers: ["GBox"] },
};

export class SourceFormatError extends SourceError {
  constructor(message, reason = "not_source") {
    super("not_source", message);
    this.name = "SourceFormatError";
    this.title = "Did not Find Source";
    this.reason = reason; // web_page, empty, bad_json, unknown_json, unknown_text
  }
}

// ---- links ---------------------------------------------------------------------------------------------------

// Which format a link's scheme suggests. Only a hint: detect() decides from the body.
const SCHEME_FORMAT = {
  altstore: "altstore", "altstore-classic": "altstore", sidestore: "altstore", feather: "altstore",
  livecontainer: "altstore", stikstore: "altstore", trollapps: "altstore", ksign: "altstore",
  esign: "esign", scarlet: "scarlet", gbox: "gbox",
  cydia: "apt", sileo: "apt", zbra: "apt", installer: "apt",
};

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function httpHref(s) {
  if (!/^https?:\/\/[^#\s/?]+[^\s]*$/i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

export function unwrapLink(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (/^https?:/i.test(s)) {
    const url = httpHref(s);
    return url ? { url, via: null, hint: null } : null;
  }
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) {
    const url = httpHref("https://" + s);
    return url ? { url, via: null, hint: null } : null;
  }
  // The URL is a query value (url=, source=, repo=: altstore://source?url=, cydia's share#?source=,
  // scarlet://repo=…), else the first http(s) URL written into the link (feather://source/<url>,
  // sileo://source/<url>, zbra://sources/add/<url>, installer://add/<url>).
  let found = null;
  const param = s.match(/[?&#/](?:url|source|repo)=([^&#]+)/i);
  if (param) found = decode(param[1]);
  if (!found || !/^https?:/i.test(found)) {
    const raw = s.slice(scheme.length + 1);
    const at = raw.search(/https?(:|%3A)/i);
    // cydia://url/https://cydia.saurik.com/api/share#?source=… names the share page first: take the source.
    if (at >= 0) found = decode(raw.slice(at));
  }
  if (found && !/^https?:/i.test(found)) found = "https://" + found;
  const url = found ? httpHref(found.trim()) : null;
  return url ? { url, via: scheme, hint: SCHEME_FORMAT[scheme] ?? null } : null;
}

// ---- APT -----------------------------------------------------------------------------------------------------

const COMPRESSED = /\.(gz|bz2|xz|lzma|zst)$/;

// Compression by magic number, so a Packages.xz served as octet-stream (or under any name) is known.
export function compressionOf(bytes) {
  const b = bytes;
  if (!b || b.length < 3) return null;
  if (b[0] === 0x1f && b[1] === 0x8b) return "gz";
  if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68) return "bz2";
  if (b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a && b[5] === 0x00) return "xz";
  if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return "zst";
  // .lzma (LZMA alone): properties byte 0x5d, then a little-endian dictionary size that is a power of two.
  if (b[0] === 0x5d && b[1] === 0x00 && b[2] === 0x00) return "lzma";
  return null;
}

export function aptLayoutFromUrl(url, release = null) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  const href = u.href;
  const comps = (fallback) => (release?.components?.length ? release.components : fallback);
  // .../dists/<dist>/<component>/binary-<arch>/Packages[.ext]  (a dist may hold slashes: Telesphoreo's ios/1800.00)
  let m = href.match(/^(.*?\/)dists\/(.+)\/([^/]+)\/binary-[^/]+\/(Packages(?:\.\w+)?)?$/);
  if (m) return { uri: m[1], dist: decode(m[2]), components: [decode(m[3])], file: m[4] || "Packages", compression: compOf(m[4]) };
  // .../dists/<dist>/Release, InRelease, or the directory itself
  m = href.match(/^(.*?\/)dists\/(.+?)\/((?:In)?Release)?$/);
  if (m) return { uri: m[1], dist: decode(m[2]), components: comps(["main"]), file: m[3] || null, compression: null };
  // flat: the file's directory is the repo
  m = href.match(/^(.*\/)((?:In)?Release|Packages(?:\.\w+)?)$/);
  if (m) return { uri: m[1], dist: "./", components: [], file: m[2], compression: compOf(m[2]) };
  return { uri: href.replace(/[^/]*$/, ""), dist: "./", components: [], file: null, compression: null };
}

const compOf = (file) => file?.match(COMPRESSED)?.[1] ?? null;

// A Release or InRelease: the fields a Release has, and no Package field.
function releaseOf(text) {
  const first = parseControl(text.replace(/^-----BEGIN PGP SIGNED MESSAGE-----[\s\S]*?\n\n/, ""))[0];
  if (!first || first.package) return null;
  const r = parseRelease(text);
  const known = r.origin || r.label || r.suite || r.codename || r.architectures.length || Object.keys(r.hashes).length;
  return known ? r : null;
}

// A Packages index: control stanzas, the first with Package and Version (or Filename).
function looksLikePackages(text) {
  const first = parseControl(text.slice(0, 64 * 1024))[0];
  return Boolean(first?.package && (first.version || first.filename));
}

// ---- JSON formats --------------------------------------------------------------------------------------------

const isObj = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
const ESIGN_SOURCE_KEYS = ["sourceicon", "payURL", "unlockURL", "message"];
const ESIGN_APP_KEYS = ["isLanZouCloud", "lock", "type"];

// Scarlet: META (Scylla: Info) with repoName, and app groups: arrays of objects with a name and a download.
export function scarletGroups(json) {
  return Object.entries(json).filter(([k, v]) => k !== "META" && k !== "Info" && Array.isArray(v)
    && v.some((a) => isObj(a) && (a.down || a.ipa || a.downloadURL)));
}

export function detectJson(json) {
  if (!isObj(json)) return null;
  if ("appRepositories" in json && (json.sourceName !== undefined || Array.isArray(json.appCategories))) {
    if (typeof json.appRepositories === "string") {
      return { format: "gbox", parsable: false, reason: "This GBox source is encrypted, so only GBox can read it." };
    }
    if (Array.isArray(json.appRepositories)) return { format: "gbox", parsable: true };
  }
  if (Array.isArray(json.apps)) {
    const esign = ESIGN_SOURCE_KEYS.some((k) => k in json)
      || json.apps.some((a) => isObj(a) && ESIGN_APP_KEYS.some((k) => k in a));
    return { format: esign ? "esign" : "altstore", parsable: true };
  }
  const meta = json.META ?? json.Info;
  if (isObj(meta) && (meta.repoName !== undefined || meta.repoIcon !== undefined) && scarletGroups(json).length) {
    return { format: "scarlet", parsable: true };
  }
  return null;
}

// ---- detect --------------------------------------------------------------------------------------------------

const host = (url) => { try { return new URL(url).host; } catch { return String(url); } };

function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return null;
}

function result(format, extra) {
  const f = FORMATS[format];
  return { format, name: f.name, kind: f.kind, parsable: true, ...extra };
}

export function detect(url, body) {
  const bytes = toBytes(body);
  if (bytes) {
    const compression = compressionOf(bytes);
    // The only compressed file a source URL serves is a Packages index.
    if (compression) return result("apt", { apt: { ...aptLayoutFromUrl(url), compression }, compressed: true });
  }
  let text = bytes ? new TextDecoder("utf-8").decode(bytes) : String(body ?? "");
  text = text.replace(/^﻿/, "");
  const trimmed = text.trim();
  if (!trimmed) throw new SourceFormatError(`${host(url)} sent an empty page, not a source.`, "empty");
  if (/^[{[]/.test(trimmed)) {
    let json;
    try { json = JSON.parse(trimmed); } catch (e) {
      throw new SourceFormatError(`${host(url)} sent broken JSON, so it can't be read as a source (${e.message}).`, "bad_json");
    }
    const d = detectJson(json);
    if (!d) {
      throw new SourceFormatError(`${host(url)} sent JSON that is no source format Cydian knows: not AltStore, ESign, `
        + "Scarlet or GBox (it has no list of apps).", "unknown_json");
    }
    return result(d.format, { parsable: d.parsable, ...(d.reason ? { reason: d.reason } : {}), json });
  }
  if (/^</.test(trimmed)) {
    throw new SourceFormatError(`${host(url)} sent a web page, not a source.`, "web_page");
  }
  const release = releaseOf(trimmed);
  if (release) return result("apt", { apt: aptLayoutFromUrl(url, release), release });
  if (looksLikePackages(trimmed)) return result("apt", { apt: aptLayoutFromUrl(url), text });
  throw new SourceFormatError(`${host(url)} sent something that is not a source: no APT Release or Packages, `
    + "and no app source JSON.", "unknown_text");
}
