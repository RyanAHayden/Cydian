// The package catalog: every source's packages for this device's architecture, grouped into Cydia's sections,
// merged across sources ("All Sources") and searchable. Pure JS, no DOM, no I/O: core/worker.js holds one
// catalog and answers the UI's questions (core/parser.js `catalog(op, args)`), so parsing, grouping and search
// stay off the UI thread. Cydia's rules followed here: docs/cydia.md "Sections and section icons".
//
//   const c = createCatalog();
//   c.load(key, packagesText, root, arch)  -> number of packages kept
//   c.sections(key | "*")                  -> { total, sections: [{ name, count }] }
//   c.sections(key, { hidden: true })      -> every section, hidden ones too, each with `hidden` (edit mode)
//   c.setHidden(names)                     -> Section Visibility: these sections drop out of sections, list,
//                                             search and author (and so Changes); package() and has() still see them
//   c.list(key | "*", section | "*")       -> [row], sorted by name ("*": All Sources / All Packages)
//   c.search(query)                        -> [row], best matches first
//   c.author(name)                         -> [row]: every package whose Author or Maintainer is `name`
//   c.package(id, key | "*")               -> { stanza, key, others: [{ key, version }] } or null; a package
//                                             no source carries but dpkg has installed comes from its status
//                                             stanza: { stanza, key: null, row, others: [], installedOnly: true }
//   c.versions()                           -> [[key, id, version]] for every source (Changes, core/changes.js)
//   c.setInstalled(statusText)             -> number of installed packages (dpkg's status file, core/installed.js)
//   c.installed()                          -> [row] installed, sorted by name, each with `installed` (its version)
//   c.upgrades(holds, { dpkgHolds })       -> { available: [row], ignored: [row] } (Changes, core/installed.js)
//   c.setDevice(device, { filter })        -> "Works on my phone" (F17, core/compat.js): every row gets `compat`,
//                                             its code for `device`; with filter on (the default) rows that can't
//                                             work drop out of sections, list, search and author like hidden ones
//
// A row is the slim record lists draw: { id, name, short, version, section, icon, key, author, compat }.
import { parseControl, description, resolveFilename, resolveIcon, matchesArch, compareVersions, DEFAULT_ARCH } from "./apt.js";
import { parseStatus, installedStanzas, findUpgrades } from "./installed.js";
import { compat, compatCode, isIncompatible, normalizeDevice, needText } from "./compat.js";

export const ALL = "*";
export const NO_SECTION = "(No Section)";

// Cydia.app/Sections.plist: typo and alias fixes applied to `Section:` before it is shown (Cydia, GPLv3).
export const SECTION_FIXES = {
  "Hunspell Dictionaries": "Dictionaries", "Utility": "Utilities", "Utilites": "Utilities", "Developer": "Development",
  "Site-Specific": "Site-Specific Apps", "Themes (Springboard)": "Themes (SpringBoard)",
  "Themes (SummerBoard)": "Themes (SpringBoard)", "Themes (Systen)": "Themes (System)",
  "Themes (Lockcreen)": "Themes (LockScreen)", "Themes (Lockscreens)": "Themes (LockScreen)",
  "Themes (Locksceen)": "Themes (LockScreen)", "Themes (Lockscree)": "Themes (LockScreen)",
  "Themes (Losckscreen)": "Themes (LockScreen)", "Themes (Video)": "Themes (Apps)",
  "Themes (Lockscreen)": "Themes (LockScreen)", "Themes (Widgets)": "Themes (Addons)", "Wallpapers": "Wallpaper",
  "Ringtone": "Ringtones", "Tweak": "Tweaks", "SBSettings Addons": "Addons (SBSettings)",
  "LockInfo Addons": "Addons (LockInfo)", "App Addons": "Addons", "App Addons (Iconoclasm)": "Addons (Iconoclasm)",
  "App Addons (OpenNotifier)": "Addons (OpenNotifier)", "BossPaper Addons": "Addons (BossPaper)",
  "Lockinfo Addons": "Addons (LockInfo)", "Dictionaries (Hunspell)": "Dictionaries",
  "Addons (Bootlogo)": "Addons (BootLogo)", "Addons (BootLogos)": "Addons (BootLogo)", "eBooks": "Books",
  "Themes (Localization)": "Localization", "Themes (APPS)": "Themes (Apps)", "Themes (Weather)": "Themes (Apps)",
  "Themes (Videos)": "Themes (Apps)", "Themes (SMS)": "Themes (Apps)", "Themes (iPad)": "Themes",
  "Themes (Dock)": "Themes (SpringBoard)", "Themes (Dialer)": "Themes (Apps)", "Themes (Battery)": "Themes (LockScreen)",
  "FontSwap": "Addons (FontSwap)", "Cydgets (Lock)": "Addons (Cydget)", "Themes (App Addons)": "Themes (Addons)",
};

// A package's section as Cydia shows it: `_` -> space, then Sections.plist. English Sections.strings maps every
// name to itself, so there is no localisation step yet. No Section -> "(No Section)".
export function sectionName(raw) {
  const s = String(raw ?? "").replace(/_/g, " ").trim();
  if (!s) return NO_SECTION;
  return SECTION_FIXES[s] ?? s;
}

// Cydia's Simplify(): "[X]" -> "X", "(X)" -> "X", "Name (Sub)" -> "Name". For icons and the "from" line.
export function simpleSection(name) {
  const s = String(name ?? "");
  const m = s.match(/^\[(.*)\]$/) || s.match(/^\((.*)\)$/);
  if (m) return m[1];
  return s.replace(/\s*\(.*\)\s*$/, "") || s;
}

// "Jay Freeman (saurik) <saurik@saurik.com>" -> { name: "Jay Freeman (saurik)", email: "saurik@saurik.com" }.
export function parseAuthor(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*<([^>]*)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: s, email: "" };
}

const tagsOf = (st) => String(st.tag ?? "").split(",").map((t) => t.trim()).filter(Boolean);

// Cydia hides packages tagged cydia::obsolete and those whose role:: isn't enduser, hacker or developer.
export function isVisible(st) {
  for (const t of tagsOf(st)) {
    if (t === "cydia::obsolete") return false;
    if (t.startsWith("role::") && !["role::enduser", "role::hacker", "role::developer"].includes(t)) return false;
  }
  return true;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
export const compareNames = (a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id);

// Cydia's package-list index: the uppercased first letter, or "#" for anything else.
export function indexLetter(name) {
  const c = String(name ?? "").trim().charAt(0).toUpperCase();
  return /\p{Lu}/u.test(c) ? c.normalize("NFD").charAt(0) : "#";
}

function makeRow(st, key) {
  const name = st.name || st.package;
  const author = parseAuthor(st.author)?.name ?? "";
  const maint = parseAuthor(st.maintainer)?.name ?? "";
  const desc = description(st);
  return {
    id: st.package, name, short: desc.short, version: st.version ?? "", section: sectionName(st.section),
    icon: st.iconUrl ?? null, key, author: author || maint, paid: tagsOf(st).includes("cydia::commercial"),
    // search fields, lower-cased once at load; dropped before rows leave the worker
    _hay: [name, st.package, desc.short, desc.long, author, maint].join("\n").toLowerCase(),
    _n: name.toLowerCase(), _id: st.package.toLowerCase(), _a: author.toLowerCase(), _m: maint.toLowerCase(),
  };
}

const slim = ({ id, name, short, version, section, icon, key, author, compat, paid }) => ({ id, name, short, version, section, icon, key, author, compat, paid });

// Search's segmented control (F35): a few broad kinds over Cydia's sections. A section belongs to a group by its
// simple name (simpleSection): "Themes (SpringBoard)" is a Theme, "Tweaks" a Tweak.
export const SECTION_GROUPS = ["Tweaks", "Themes", "Apps", "Utilities"];
const GROUP_NAMES = {
  Tweaks: ["tweaks", "tweak"],
  Themes: ["themes", "theme", "wallpaper", "ringtones", "fonts"],
  Apps: ["applications", "apps", "app", "games"],
  Utilities: ["utilities", "system", "terminal support", "networking", "development", "administration", "scripting"],
};
export function sectionGroup(section) {
  const s = simpleSection(section).toLowerCase();
  for (const [g, names] of Object.entries(GROUP_NAMES)) if (names.includes(s)) return g;
  return null;
}

// A section filter value -> a row test: "group:Tweaks" (sectionGroup), a section's name, or null/"*" for any.
function sectionTest(section) {
  if (section == null || section === "" || section === ALL) return null;
  const s = String(section);
  if (s.startsWith("group:")) { const g = s.slice(6); return (r) => sectionGroup(r.section) === g; }
  return (r) => r.section === s;
}

export function createCatalog() {
  const sources = new Map(); // key -> { byId: Map(id -> { row, stanza }) }
  let merged = null;         // "All Sources": id -> { row, stanza, key }, built when first asked, dropped on load
  const sorted = new Map();  // key -> rows sorted by name (cache)
  let hidden = new Set();    // Section Visibility (Cydia's CydiaSections Hidden): section names left out of lists
  const shown = new Map();   // key -> sorted rows outside hidden sections (cache)
  let device = null;         // F17: the device rows are judged for (core/compat.js), or null before one is set
  let fitFilter = false;     // and whether rows that can't work on it are left out
  const fitting = new Map(); // key -> sorted rows that can work on the device (cache)
  const judge = (e) => { e.row.compat = device ? compatCode(e.stanza, device) : null; };

  function load(key, text, root, arch = DEFAULT_ARCH) {
    const byId = new Map();
    for (const st of parseControl(text)) {
      if (!st.package || !matchesArch(st, arch) || !isVisible(st)) continue;
      const cur = byId.get(st.package);
      // One source can list several versions of a package: the newest is the candidate, as in apt.
      if (cur && compareVersions(cur.stanza.version, st.version) >= 0) continue;
      st.debUrl = root ? resolveFilename(root, st.filename) : null;
      st.iconUrl = resolveIcon(root, st.icon);
      byId.set(st.package, { stanza: st, row: makeRow(st, key) });
    }
    for (const e of byId.values()) judge(e);
    sources.set(key, { byId });
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return byId.size;
  }

  function remove(key) {
    sources.delete(key);
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
  }

  // F17: judge every row for `device` ({ ios, jailbreak }; null clears it). Returns how many rows can't work on it.
  function setDevice(next, { filter = true } = {}) {
    device = next ? normalizeDevice(next) : null;
    fitFilter = Boolean(device && filter);
    let no = 0;
    for (const { byId } of sources.values()) for (const e of byId.values()) { judge(e); if (isIncompatible(e.row.compat)) no++; }
    shown.clear();
    fitting.clear();
    return no;
  }

  function setHidden(names) {
    hidden = new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === "string"));
    shown.clear();
    return hidden.size;
  }

  // id -> entry for a source, or the merge of all of them: the newest version wins; on a tie, the first source
  // loaded keeps it (apt's default: equal pins, first listed).
  function entries(key) {
    if (key !== ALL) return sources.get(key)?.byId ?? new Map();
    if (merged) return merged;
    merged = new Map();
    for (const { byId } of sources.values()) {
      for (const [id, e] of byId) {
        const cur = merged.get(id);
        if (!cur || compareVersions(cur.stanza.version, e.stanza.version) < 0) merged.set(id, e);
      }
    }
    return merged;
  }

  function rowsOf(key) {
    let rows = sorted.get(key);
    if (!rows) {
      rows = [...entries(key).values()].map((e) => e.row).sort(compareNames);
      sorted.set(key, rows);
    }
    return rows;
  }

  // rowsOf without what can't work on the device (F17), when that filter is on.
  function fitOf(key) {
    if (!fitFilter) return rowsOf(key);
    let rows = fitting.get(key);
    if (!rows) {
      rows = rowsOf(key).filter((r) => !isIncompatible(r.compat));
      fitting.set(key, rows);
    }
    return rows;
  }

  // fitOf without the hidden sections: what every list, Search and Changes draw from.
  function visibleOf(key) {
    if (!hidden.size) return fitOf(key);
    let rows = shown.get(key);
    if (!rows) {
      rows = fitOf(key).filter((r) => !hidden.has(r.section));
      shown.set(key, rows);
    }
    return rows;
  }

  // `total` counts visible packages only. With { hidden: true } (Section Visibility's edit mode) hidden sections
  // are listed too, each marked; without it they are left out.
  function sections(key = ALL, { hidden: withHidden = false } = {}) {
    const counts = new Map();
    for (const r of fitOf(key)) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
    const list = [...counts].filter(([name]) => withHidden || !hidden.has(name))
      .map(([name, count]) => (withHidden ? { name, count, hidden: hidden.has(name) } : { name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    return { total: visibleOf(key).length, sections: list };
  }

  function list(key = ALL, section = ALL) {
    const rows = visibleOf(key);
    return (section === ALL ? rows : rows.filter((r) => r.section === section)).map(slim);
  }

  // Every word must appear somewhere (name, id, description, author or maintainer). Ranked: exact name or id,
  // then name or id starting with the query, then the query inside the name or id, then the rest; by name within.
  // Search's filters (F35, all optional): `section` a section name or a SECTION_GROUPS group ("group:Tweaks"),
  // `source` a source key, `installed` "installed" | "not", `price` "free" | "paid". With the Works on My Phone
  // filter on, what can't work drops out, except an exact name or id match: that one stays, marked `exact`, with
  // `why` ("Needs iOS 15 or earlier") for the row's subtitle.
  function search(query, { limit = 2000, section = null, source = null, installed = null, price = null } = {}) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    const key = source && sources.has(source) ? source : ALL;
    if (source && key === ALL) return []; // a source that isn't loaded has nothing
    const inSection = sectionTest(section);
    const hits = [];
    for (const r of rowsOf(key)) {
      if (hidden.has(r.section)) continue;
      if (!words.every((w) => r._hay.includes(w))) continue;
      if (inSection && !inSection(r)) continue;
      if (installed === "installed" && !statusById.has(r.id)) continue;
      if (installed === "not" && statusById.has(r.id)) continue;
      if (price === "paid" && !r.paid) continue;
      if (price === "free" && r.paid) continue;
      let rank = 4;
      if (r._n === q || r._id === q) rank = 0;
      else if (r._n.startsWith(q) || r._id.startsWith(q)) rank = 1;
      else if (r._n.includes(q) || r._id.includes(q)) rank = 2;
      else if (r._a.includes(q) || r._m.includes(q)) rank = 3;
      if (fitFilter && rank !== 0 && isIncompatible(r.compat)) continue;
      hits.push([rank, r]);
    }
    hits.sort((a, b) => a[0] - b[0] || compareNames(a[1], b[1]));
    return hits.slice(0, limit).map(([rank, r]) => {
      const out = slim(r);
      if (rank === 0 && isIncompatible(r.compat)) {
        out.exact = true;
        out.why = needText(compat(entries(key).get(r.id).stanza, device));
      }
      return out;
    });
  }

  function author(name) {
    const n = String(name ?? "").trim().toLowerCase();
    if (!n) return [];
    return visibleOf(ALL).filter((r) => r._a === n || r._m === n).map(slim);
  }

  function pkg(id, key = ALL) {
    const e = entries(key).get(id);
    if (!e) return installedOnly(id);
    const others = [];
    for (const [k, { byId }] of sources) {
      const o = byId.get(id);
      if (o) others.push({ key: k, version: o.stanza.version });
    }
    return { stanza: e.stanza, key: e.row.key, row: slim(e.row), others };
  }

  // Which of `names` the catalog has (for linking Depends on the package page): on a source, or installed (its
  // page then comes from the status stanza).
  const has = (names) => names.filter((n) => entries(ALL).has(n) || statusById.has(n));

  // Every (source, id, candidate version) loaded: what the Changes tab files on a refresh (core/changes.js).
  function versions() {
    const out = [];
    for (const [k, { byId }] of sources) for (const [id, e] of byId) out.push([k, id, e.stanza.version ?? ""]);
    return out;
  }

  // ---- installed packages (F7): dpkg's status file, matched against every source's candidate ----
  let installedPkgs = null; // parseStatus rows, or null before a status file came
  let statusById = new Map(); // id -> status stanza, for the package page of packages no source carries (F27)

  function setInstalled(text) {
    if (text == null) {
      installedPkgs = null;
      statusById = new Map();
      return -1;
    }
    const stanzas = installedStanzas(text);
    statusById = new Map(stanzas.map((st) => [st.package, st]));
    installedPkgs = parseStatus(text, stanzas);
    return installedPkgs.length;
  }

  // The package page's answer for an installed package no source carries: the status stanza itself (name,
  // version, description, Author, Depends...), with no source, no other versions and nothing to download.
  function installedOnly(id) {
    const st = statusById.get(id);
    if (!st) return null;
    const p = installedPkgs.find((r) => r.id === id);
    const row = { id: p.id, name: p.name, short: p.short, version: p.version, section: p.section, icon: null, key: null, author: p.author,
      compat: device ? compatCode(st, device) : null };
    return { stanza: st, key: null, row, others: [], installedOnly: true };
  }

  // The installed list as rows: the status file's own fields (name, version, description), with the source's
  // icon and key where a source carries the package, so the row's icon and package page work.
  function installed() {
    if (!installedPkgs) return null;
    const all = entries(ALL);
    return installedPkgs.map((p) => {
      const e = all.get(p.id);
      return { id: p.id, name: p.name, short: p.short, version: p.version, section: p.section,
        icon: e?.row.icon ?? null, key: e?.row.key ?? null, author: p.author, installed: p.version, held: p.held,
        compat: e ? e.row.compat : (device && statusById.has(p.id) ? compatCode(statusById.get(p.id), device) : null) };
    });
  }

  // Every source counts (not just visible sections): an upgrade in a hidden section is still an upgrade.
  function upgrades(holds = [], opts = {}) {
    if (!installedPkgs) return { available: [], ignored: [] };
    const all = entries(ALL);
    return findUpgrades(installedPkgs, (id) => { const e = all.get(id); return e ? slim(e.row) : null; }, holds, opts);
  }

  return { load, remove, setHidden, sections, list, search, author, package: pkg, has, versions, keys: () => [...sources.keys()],
    setInstalled, installed, upgrades, setDevice };
}

// Runs a catalog operation by name: the worker's entry point. Unknown ops throw.
export function runCatalog(catalog, op, args = []) {
  const f = { load: catalog.load, remove: catalog.remove, sections: catalog.sections, list: catalog.list,
    search: catalog.search, author: catalog.author, package: catalog.package, has: catalog.has, keys: catalog.keys,
    versions: catalog.versions, setHidden: catalog.setHidden, setInstalled: catalog.setInstalled,
    installed: catalog.installed, upgrades: catalog.upgrades, setDevice: catalog.setDevice }[op];
  if (!f) throw new Error(`unknown catalog op ${op}`);
  return f(...args);
}
