// Exploitable iOS versions (F291, concept K2 option B, step 1): the iOS versions a public kernel exploit works on.
// On one of them a single bad IPA can take over the phone, so before the first install from a source the user hasn't
// trusted (core/trust.js), the sideload app and the website say so once, plainly, with Software Update when Apple has
// shipped a fix. Never a block. The jailbreak build says nothing about the version (people stay on these versions to
// jailbreak); instead, when an entry lists a security patch package for the phone's version and it isn't installed,
// it offers that package (patchesFor, patchAlert, patchRow), never installing it by itself.
//
// The list ships in the app like core/piracy-list.js: nothing is fetched. Each entry is one public exploit (or a
// family of them) with the versions it works on, the first version that fixes it, and a public page that backs it up
// (the CVE's NVD page, or the write-up when there is no CVE). To add one, give those three; a patch package needs its
// package ID, its repo and a link.
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
const CORUNA = "https://cloud.google.com/blog/topics/threat-intelligence/coruna-powerful-ios-exploit-kit";

// `from` .. `through` inclusive; `fixed` is the first version on that line that closes it (from the CVE's NVD entry
// and Apple's security notes; checked 2026-11-20). "Public" means the exploit is out in the open: published code
// (kfd, MacDirtyCow, multicast_bytecopy) or a kit served from public websites and taken apart in a public write-up
// (Coruna, DarkSword); an in-the-wild bug with no exploit anyone can pick up is not listed. `cve` is null where the
// write-up names none, and `link` is then that write-up. A bug Apple fixed on two lines gets one entry per line, so
// each has its own fix.
// `patches`: [{ id, name, repo, link, version? }] (no public patch package is known for any of these; the jailbreak
// build offers one as soon as it is listed here).
export const EXPLOITABLE_IOS = [
  { id: "multicast-bytecopy", name: "multicast_bytecopy", cve: "CVE-2021-30937", from: "14.0", through: "15.1.1", fixed: "15.2",
    link: NVD("CVE-2021-30937"), patches: [] },
  // MacDirtyCow: a file overwrite in practice, though Apple rates the bug as kernel code execution.
  { id: "macdirtycow", name: "MacDirtyCow", cve: "CVE-2022-46689", from: "15.0", through: "15.7.1", fixed: "15.7.2",
    link: NVD("CVE-2022-46689"), patches: [] },
  { id: "macdirtycow-16", name: "MacDirtyCow", cve: "CVE-2022-46689", from: "16.0", through: "16.1.2", fixed: "16.2",
    link: NVD("CVE-2022-46689"), patches: [] },
  { id: "kfd-physpuppet", name: "kfd (physpuppet)", cve: "CVE-2023-23536", from: "15.0", through: "15.7.3", fixed: "15.7.4",
    link: NVD("CVE-2023-23536"), patches: [] },
  { id: "kfd-physpuppet-16", name: "kfd (physpuppet)", cve: "CVE-2023-23536", from: "16.0", through: "16.3.1", fixed: "16.4",
    link: NVD("CVE-2023-23536"), patches: [] },
  // smith is also Coruna's "Photon", which reaches back to iOS 14.5.
  { id: "kfd-smith", name: "kfd (smith)", cve: "CVE-2023-32434", from: "14.5", through: "15.7.6", fixed: "15.7.7",
    link: NVD("CVE-2023-32434"), patches: [] },
  { id: "kfd-smith-16", name: "kfd (smith)", cve: "CVE-2023-32434", from: "16.0", through: "16.5", fixed: "16.5.1",
    link: NVD("CVE-2023-32434"), patches: [] },
  // landa (Coruna's "Parallax"): fixed in iOS 17.0, and on iOS 15 only in 15.8.7 (March 2026, for the phones stuck on
  // 15). Coruna runs it through 16.7; Apple's notes name no 16.7.x fix, so 17.0 stands as the fix for that line.
  { id: "kfd-landa-15", name: "kfd (landa)", cve: "CVE-2023-41974", from: "15.0", through: "15.8.6", fixed: "15.8.7",
    link: NVD("CVE-2023-41974"), patches: [] },
  { id: "kfd-landa", name: "kfd (landa)", cve: "CVE-2023-41974", from: "16.0", through: "16.7", fixed: "17.0",
    link: NVD("CVE-2023-41974"), patches: [] },
  // Coruna's "Gruber" kernel exploit: 15.2 through 17.2.1, fixed in 16.7.6 and 17.3 (no CVE given). On iOS 15 the
  // kit's kernel step is the one 15.8.7 closes (kfd-landa-15 above).
  { id: "coruna-gruber-16", name: "Coruna (Gruber)", cve: null, from: "16.0", through: "16.7.5", fixed: "16.7.6",
    link: CORUNA, patches: [] },
  { id: "coruna-gruber-17", name: "Coruna (Gruber)", cve: null, from: "17.0", through: "17.2.1", fixed: "17.3",
    link: CORUNA, patches: [] },
  // DarkSword's kernel step (a VFS race giving kernel memory read/write): the kit runs on 18.4 through 18.7; Apple
  // fixed it in 18.7.2 (and 26.1, which the kit doesn't target).
  { id: "darksword", name: "DarkSword", cve: "CVE-2025-43520", from: "18.4", through: "18.7.1", fixed: "18.7.2",
    link: NVD("CVE-2025-43520"), patches: [] },
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
    message: `${p.name} closes the ${p.exploit} hole${p.cve ? ` (${p.cve})` : ""} on this iOS version, so an app can't use it. Install it now?`,
    buttons: [LATER, INSTALL_PATCH],
    cancel: 0,
  };
}

// Changes' row (kept beside the alert): opens the package's page, where Install is.
export function patchRow(p, key = null) {
  return { id: p.id, name: p.name, version: p.version ?? "", installed: null, key, section: PATCH_TITLE,
    short: `Closes ${p.exploit}${p.cve ? ` (${p.cve})` : ""} on this iOS version.`, security: true, link: p.link ?? null, repo: p.repo ?? null };
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
