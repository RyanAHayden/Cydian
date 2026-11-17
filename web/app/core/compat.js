// "Works on my phone" (F17): whether a package suits this iPhone, from what its index says. Pure JS, no DOM: the
// worker's catalog (core/catalog.js setDevice) files a code on every row and filters lists and Search with it;
// the package page asks for the full verdict. No other manager or index does this (Sileo #249, #222, #312).
//
//   const device = { ios: "16.5", jailbreak: "rootless" };  // ios null: not known; jailbreak: JAILBREAKS
//   compat(stanza, device)  -> { status: "works" | "no" | "unknown", reason, need, label, detail }
//   compatCode(stanza, device) -> "works" | "unknown" | "ios" | "rootful" | "rootless" | "roothide" | "jailbreak" | "arch"
//   badge(code, device)     -> the row badge's text: "Works", "Not on iOS 16.5", "Rootful only", "Unknown"
//   iosFromUserAgent(ua)    -> "16.5" | null
//
// What is read, in this order (the first "no" wins):
//   Architecture   iphoneos-arm64 rootless, iphoneos-arm rootful, iphoneos-arm64e roothide, all for any. A stanza
//                  with none is old and rootful (core/apt.js matchesArch). AltStore-format apps (F9) carry no
//                  Architecture and suit every phone, jailbroken or not.
//   firmware       Cydia's virtual package whose version is the iOS version: `Depends`/`Pre-Depends: firmware
//                  (>= 14.0)`, ANDed across groups; an alternative group counts only when every alternative is
//                  firmware. `Conflicts`/`Breaks: firmware (>= 17.0)` rule iOS versions out.
//   min/maxOSVersion  AltStore's app fields (minOSVersion/maxOSVersion, any case).
// A package that says nothing about the iOS version is "unknown", never hidden: most of every repo is like that.
import { parseRelations, satisfies, compareVersions } from "./apt.js";

// The iOS versions the site's picker offers (Settings > iOS Version), newest first: every minor release from 12.0,
// the oldest a checkm8 rootful jailbreak still runs well, to the current 26.x.
const MINORS = { 12: 5, 13: 7, 14: 8, 15: 8, 16: 7, 17: 7, 18: 7, 26: 3 };
export const IOS_VERSIONS = Object.entries(MINORS).flatMap(([major, last]) =>
  Array.from({ length: last + 1 }, (_, i) => `${major}.${i}`)).reverse();

export const JAILBREAKS = ["rootless", "rootful", "roothide", "none"];

// Architecture -> the jailbreak type it installs on.
export const ARCH_JAILBREAK = { "iphoneos-arm64": "rootless", "iphoneos-arm": "rootful", "iphoneos-arm64e": "roothide" };
export const JAILBREAK_ARCH = { rootless: "iphoneos-arm64", rootful: "iphoneos-arm", roothide: "iphoneos-arm64e" };
export const jailbreakOfArch = (arch) => ARCH_JAILBREAK[arch] ?? "rootless";

const ONLY = { rootful: "Rootful only", rootless: "Rootless only", roothide: "Roothide only" };

// A lower-cased (control stanza) or camelCase (AltStore JSON) field.
function field(st, name) {
  const v = st?.[name.toLowerCase()] ?? st?.[name];
  return v == null || v === "" ? null : String(v).trim();
}

// "16.5" from an iPhone's user agent ("iPhone OS 16_5 like Mac OS X"). Safari 26 freezes that part at 18_6 and
// reports the real major in "Version/26.x" (Safari's version is the iOS version there), so a Version of 26 or more
// wins. Not an iPhone/iPad/iPod: null.
export function iosFromUserAgent(ua) {
  const s = String(ua ?? "");
  const os = s.match(/\b(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?[^)]*like Mac OS X/);
  if (!os) return null;
  const safari = s.match(/\bVersion\/(\d+)(?:\.(\d+))?/);
  if (safari && Number(safari[1]) >= 26) return `${safari[1]}.${safari[2] ?? 0}`;
  return `${Number(os[1])}.${Number(os[2])}` + (os[3] && os[3] !== "0" ? `.${Number(os[3])}` : "");
}

// The jailbreak type an Architecture field asks for: "rootless", "rootful", "roothide", "any" or the odd arch
// itself (a Mac or watch build that slipped into a repo).
export function archNeed(st) {
  const a = field(st, "architecture");
  if (a === null) return isApp(st) ? "any" : "rootful";
  if (a === "all") return "any";
  return ARCH_JAILBREAK[a] ?? a;
}

// AltStore-format apps (F9): an app record, not a deb. They carry bundleIdentifier or downloadURL, never Package.
const isApp = (st) => !field(st, "package") && Boolean(field(st, "bundleIdentifier") || field(st, "downloadURL") || field(st, "minOSVersion") || field(st, "maxOSVersion"));

// The iOS constraints a package states: { groups: [[{op, version}]] } where every group must hold and one
// alternative in a group is enough; `conflicts` are ranges it can't be on. An alternative with no version means
// "any iOS". `stated` is false when there is nothing about the iOS version at all.
export function iosRequirement(st) {
  const groups = [];
  for (const g of [...parseRelations(field(st, "pre-depends")), ...parseRelations(field(st, "depends"))]) {
    if (!g.every((r) => r.name === "firmware")) continue; // "firmware (>= 15) | something": can't tell
    groups.push(g.map((r) => (r.op ? { op: r.op, version: r.version } : {})));
  }
  const conflicts = [];
  for (const g of [...parseRelations(field(st, "conflicts")), ...parseRelations(field(st, "breaks"))]) {
    for (const r of g) if (r.name === "firmware") conflicts.push(r.op ? { op: r.op, version: r.version } : {});
  }
  const min = field(st, "minOSVersion");
  const max = field(st, "maxOSVersion");
  if (min) groups.push([{ op: ">=", version: min }]);
  if (max) groups.push([{ op: "<=", version: max }]);
  const stated = groups.some((g) => g.some((r) => r.op)) || conflicts.length > 0;
  return { groups, conflicts, stated };
}

// Whether iOS `ios` meets the requirement: true, false, or null when nothing is stated or ios is unknown.
// maxOSVersion "16" means any 16.x, so a max is compared on as many parts as it has.
export function iosOk(req, ios) {
  if (!req.stated || !ios) return null;
  const ok = (r) => !r.op || satisfies(cut(ios, r), r.op, r.version);
  if (!req.groups.every((g) => g.some(ok))) return false;
  if (req.conflicts.some((r) => !r.op || satisfies(ios, r.op, r.version))) return false;
  return true;
}

// For <= and <<: "16.5.1" against a bound "16" compares as "16", so maxOSVersion 16 lets 16.7 in.
function cut(ios, r) {
  if (r.op !== "<=") return ios;
  const n = String(r.version).split(".").length;
  return String(ios).split(".").slice(0, n).join(".");
}

// "iOS 14.0 – 16.x" style text for the page: the bounds the package states.
export function rangeText(req) {
  let lo = null, hi = null;
  for (const g of req.groups) {
    if (g.length !== 1 || !g[0].op) continue;
    const { op, version } = g[0];
    if (op === ">=" || op === ">>" || op === ">" || op === "=") if (!lo || compareVersions(version, lo.version) > 0) lo = { op, version };
    if (op === "<<" || op === "<=" || op === "<" || op === "=") if (!hi || compareVersions(version, hi.version) < 0) hi = { op, version };
  }
  for (const r of req.conflicts) {
    if ((r.op === ">=" || r.op === ">>") && (!hi || compareVersions(r.version, hi.version) <= 0)) hi = { op: r.op === ">=" ? "<<" : "<=", version: r.version };
  }
  if (!lo && !hi) return req.stated ? "some iOS versions" : null;
  if (lo?.op === "=") return `iOS ${lo.version}`;
  const top = hi && (hi.op === "<<" ? `below ${hi.version}` : `${hi.version} or earlier`);
  if (lo && hi) return hi.op === "<<" ? `iOS ${lo.version} to below ${hi.version}` : `iOS ${lo.version} – ${hi.version}`;
  return lo ? `iOS ${lo.version} or later` : `iOS ${top}`;
}

// The whole verdict for one package on `device`.
export function compat(st, device = {}) {
  const ios = device?.ios || null;
  const jb = JAILBREAKS.includes(device?.jailbreak) ? device.jailbreak : null;
  const need = archNeed(st);
  const req = iosRequirement(st);
  const range = rangeText(req);
  const no = (reason, needs, label, detail) => ({ status: "no", reason, need: needs, label, detail, range });
  if (jb === "none" && !isApp(st)) return no("jailbreak", need, "Jailbreak only", "Needs a jailbroken iPhone.");
  if (jb && jb !== "none" && need !== "any" && need !== jb) {
    if (ONLY[need]) return no(need, need, ONLY[need], `Built for ${need} jailbreaks; this iPhone is ${jb}.`);
    return no("arch", need, "Not for iPhone", `Built for ${need}, not an iPhone.`);
  }
  const ok = iosOk(req, ios);
  if (ok === false) return no("ios", need, `Not on iOS ${ios}`, range ? `Made for ${range}.` : `Not for iOS ${ios}.`);
  if (ok === true) return { status: "works", reason: null, need, label: "Works", detail: `Made for ${range}; this iPhone runs iOS ${ios}.`, range };
  const detail = req.stated ? "This iPhone's iOS version isn't known: set it in Settings." : "The package doesn't say which iOS versions it supports.";
  return { status: "unknown", reason: null, need, label: "Unknown", detail, range };
}

// One short code per row, for the worker to file and the list to draw: "works", "unknown", or why it's no.
export function compatCode(st, device) {
  const v = compat(st, device);
  return v.status === "no" ? v.reason : v.status;
}

export const isIncompatible = (code) => code != null && code !== "works" && code !== "unknown";

// The row badge's text for a code.
export function badge(code, device = {}) {
  switch (code) {
    case "works": return "Works";
    case "ios": return device?.ios ? `Not on iOS ${device.ios}` : "Not on this iOS";
    case "jailbreak": return "Jailbreak only";
    case "arch": return "Not for iPhone";
    case "unknown": case undefined: case null: return "Unknown";
    default: return ONLY[code] ?? "Unknown";
  }
}

// A device record from loose input: unknown jailbreak types read as rootless, an empty iOS as unknown.
export function normalizeDevice(d) {
  const ios = typeof d?.ios === "string" && /^\d+(\.\d+){0,2}$/.test(d.ios.trim()) ? d.ios.trim() : null;
  return { ios, jailbreak: JAILBREAKS.includes(d?.jailbreak) ? d.jailbreak : "rootless" };
}
