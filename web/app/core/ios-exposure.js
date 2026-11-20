// Exploitable iOS versions (F291, concept K2 option B, step 1): the iOS versions a public kernel exploit works on.
// On one of them a single bad IPA can take over the phone, so before the first install from a source the user hasn't
// trusted (core/trust.js), the sideload app and the website say so once, plainly, with Software Update when Apple has
// shipped a fix. Never a block. The jailbreak build says nothing about the version (people stay on these versions to
// jailbreak); instead, when an entry lists a security patch package for the phone's version and it isn't installed,
// it offers that package (patchesFor, patchAlert, patchRow), never installing it by itself.
//
// The list ships in the app like core/piracy-list.js: nothing is fetched. Each entry is one public exploit (or a
// family of them) with the versions it works on, the first version that fixes it, and a public page that backs it up
// (the CVE's NVD page). To add one, give those three; a patch package needs its package ID, its repo and a link.
//
//   EXPLOITABLE_IOS                         the list
//   exposureOf(ios)                         -> { ios, entries, fixed } for a listed version, else null. `fixed`: the
//                                              newest first-fixed version among its entries (update to at least that)
//   exposureDue({ mode, ios, untrusted, seen }) -> whether the alert shows now
//   exposureAlert(exposure, { canOpenSettings }) -> the alert { title, message, buttons, cancel }
//   loadSeen(storage), markSeen(storage, ios)   the iOS version the alert was last shown for
//   patchesFor(ios)                         -> the patch packages listed for that version
//   duePatch(patches, installed, snoozed)   -> the first patch not installed and not snoozed at its version, or null
//   patchAlert(patch)                       -> the launch alert (Install Patch / Later)
//   patchRow(patch, key)                    -> Changes' "Security Patch Available" row
//   loadSnooze(storage), snoozePatch(storage, patch)   Later: until the next launch or a newer patch version
import { compareVersions, parseVersion } from "./selfupdate.js";

const NVD = (cve) => `https://nvd.nist.gov/vuln/detail/${cve}`;

// `from` .. `through` inclusive. `patches`: [{ id, name, repo, link, version? }] (none known yet; the jailbreak build
// offers one as soon as it is listed here).
export const EXPLOITABLE_IOS = [
  { id: "multicast-bytecopy", name: "multicast_bytecopy", cve: "CVE-2021-30937", from: "14.0", through: "15.1.1", fixed: "15.2",
    link: NVD("CVE-2021-30937"), patches: [] },
  { id: "kfd-smith", name: "kfd (smith)", cve: "CVE-2023-32434", from: "15.0", through: "15.7.6", fixed: "15.7.7",
    link: NVD("CVE-2023-32434"), patches: [] },
  { id: "kfd-smith-16", name: "kfd (smith)", cve: "CVE-2023-32434", from: "16.0", through: "16.5", fixed: "16.5.1",
    link: NVD("CVE-2023-32434"), patches: [] },
  { id: "kfd-landa", name: "kfd (landa)", cve: "CVE-2023-41974", from: "16.0", through: "16.6.1", fixed: "16.7",
    link: NVD("CVE-2023-41974"), patches: [] },
];

const clean = (v) => {
  const p = parseVersion(v);
  return p ? p.join(".") : null;
};

const inRange = (ios, e) => compareVersions(ios, e.from) >= 0 && compareVersions(ios, e.through) <= 0;

export function exposureOf(ios, list = EXPLOITABLE_IOS) {
  const v = clean(ios);
  if (!v) return null;
  const entries = list.filter((e) => inRange(v, e));
  if (!entries.length) return null;
  const fixed = entries.map((e) => e.fixed).filter(Boolean).reduce((a, b) => (!a || compareVersions(b, a) > 0 ? b : a), null);
  return { ios: String(ios).trim(), entries, fixed };
}

// The alert shows in the sideload app and on the website (never the jailbreak build), on a listed version, when the
// install comes from a source the user hasn't trusted, and once per iOS version.
export function exposureDue({ mode, ios, untrusted, seen = null, list = EXPLOITABLE_IOS }) {
  if (mode === "jailbreak" || !untrusted) return false;
  const ex = exposureOf(ios, list);
  return Boolean(ex) && seen !== ex.ios;
}

// Plain, not scary. Software Update only where the page can open Settings (the app) and a fix exists.
export const EXPOSURE_TITLE = "Check Before You Install";
export const SOFTWARE_UPDATE = "Software Update";
export const UNDERSTOOD = "I Understand";
export function exposureAlert(ex, { canOpenSettings = false } = {}) {
  const fix = ex.fixed ? ` iOS ${ex.fixed} fixes it${canOpenSettings ? "" : " (Settings > General > Software Update)"}.` : "";
  const button = canOpenSettings && ex.fixed;
  return {
    title: EXPOSURE_TITLE,
    message: `iOS ${ex.ios} has a known flaw that lets an app take over the phone. Only install apps you trust, from sources you know.${fix}`,
    buttons: button ? [SOFTWARE_UPDATE, UNDERSTOOD] : [UNDERSTOOD],
    cancel: button ? 1 : 0,
  };
}

// The Settings app's Software Update page (the sideload shell's app.openURL hands it to iOS).
export const SOFTWARE_UPDATE_URL = "App-prefs:General&path=SOFTWARE_UPDATE_LINK";

export const SEEN_KEY = "ifizbox.exposureSeen";
export function loadSeen(storage) {
  try { return storage?.getItem(SEEN_KEY) ?? null; } catch { return null; }
}
export function markSeen(storage, ios) {
  try { storage?.setItem(SEEN_KEY, String(ios)); } catch { /* private mode: it may show again */ }
}

// ---- the jailbreak build: security patch packages ---------------------------------------------------------------

export function patchesFor(ios, list = EXPLOITABLE_IOS) {
  const ex = exposureOf(ios, list);
  if (!ex) return [];
  const seen = new Set();
  const out = [];
  for (const e of ex.entries) {
    for (const p of e.patches ?? []) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ ...p, exploit: e.name, cve: e.cve });
    }
  }
  return out;
}

// installed: Map | object of package id -> installed version. snoozed: { [id]: version } from Later.
export function duePatch(patches, installed, snoozed = {}) {
  const has = (id) => (installed instanceof Map ? installed.has(id) : Boolean(installed && Object.hasOwn(installed, id)));
  return (patches ?? []).find((p) => !has(p.id) && snoozed?.[p.id] !== (p.version ?? "")) ?? null;
}

export const PATCH_TITLE = "Security Patch Available";
export const INSTALL_PATCH = "Install Patch";
export const LATER = "Later";
export function patchAlert(p) {
  return {
    title: PATCH_TITLE,
    message: `${p.name} closes the ${p.exploit} hole (${p.cve}) on this iOS version, so an app can't use it. Install it now?`,
    buttons: [LATER, INSTALL_PATCH],
    cancel: 0,
  };
}

// Changes' row (kept beside the alert): opens the package's page, where Install is.
export function patchRow(p, key = null) {
  return { id: p.id, name: p.name, version: p.version ?? "", installed: null, key, section: PATCH_TITLE,
    short: `Closes ${p.exploit} (${p.cve}) on this iOS version.`, security: true, link: p.link ?? null, repo: p.repo ?? null };
}

// Later: snoozed until the next launch (the session) or a newer patch version (kept per id).
export const SNOOZE_KEY = "ifizbox.patchSnoozed";
export function loadSnooze(storage) {
  try {
    const v = JSON.parse(storage?.getItem(SNOOZE_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
export function snoozePatch(storage, p) {
  try { storage?.setItem(SNOOZE_KEY, JSON.stringify({ ...loadSnooze(storage), [p.id]: p.version ?? "" })); } catch { /* private mode */ }
}
