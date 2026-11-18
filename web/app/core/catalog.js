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
//   c.setHiddenAuthors(names)              -> Hide by Author (F104, Zebra's filters): packages whose Author or
//                                             Maintainer is one of these drop out like hidden sections' (author()
//                                             still lists them, so the author page can show them again)
//   c.list(key | "*", section | "*")       -> [row], sorted by name ("*": All Sources / All Packages)
//   c.search(query)                        -> [row], best matches first (nothing for one Latin character)
//   c.author(name)                         -> [row]: every package whose Author or Maintainer is `name`
//   c.package(id, key | "*")               -> { stanza, key, others: [{ key, version }] } or null; a package
//                                             no source carries but dpkg has installed comes from its status
//                                             stanza: { stanza, key: null, row, others: [], installedOnly: true }
//   c.history(id, key | "*")               -> Version History (F29): { kind: "apt", id, name, versions:
//                                             aptVersionList } or { kind: "ipa", id, name, key, sourceUrl,
//                                             versions: altVersionList }; null when unknown
//   c.versions()                           -> [[key, id, version]] for every source (Changes, core/changes.js)
//   c.categories()                         -> Browse (F46): [{ name, count }] in BROWSE_CATEGORIES order, empty
//                                             ones and (Not Jailbroken) tweak categories left out
//   c.browse(category)                     -> [row] in that Browse category, sorted by name
//   c.popular({ limit })                   -> [row] ranked by how many sources list it, then newest (rankPopular),
//                                             each with `sources` (that count)
//   c.aptProblems(aptOutput)              -> N4: explainApt over the same index as deps (the Confirm sheet)
//   c.queueInfo([id])                      -> N4: { id: { name, restart } } for the queue's packages
//   c.deps(id, key | "*")                  -> F18 (core/deps.js explain): { ok, problems, targets } for an APT
//                                             package, against every source and the installed list; null if unknown
//   c.setInstalled(statusText)             -> number of installed packages (dpkg's status file, core/installed.js)
//   c.installed()                          -> [row] installed, sorted by name, each with `installed` (its version)
//                                             and `size` (F104: Installed-Size in bytes, or null)
//   c.upgrades(holds, { dpkgHolds })       -> { available: [row], ignored: [row] } (Changes, core/installed.js)
//   c.loadAlt(key, json, ios, format)      -> an AltStore source (F9, core/altstore.js): each app a row, its
//                                             candidate the newest version iOS `ios` runs; apps none runs on left out
//   c.altSource(key)                       -> the AltStore source's page data: { name, tintColor, headerURL, news,
//                                             featured: [row], ... } or null
//   c.setDevice(device, { filter })        -> "Works on my phone" (F17, core/compat.js): every row gets `compat`,
//                                             its code for `device`; with filter on (the default) rows that can't
//                                             work drop out of sections, list, search and author like hidden ones.
//                                             A device with jailbreak "none" (F37, Not Jailbroken) sees AltStore
//                                             sources only: APT sources' packages drop out of everything, filter or
//                                             not (lists, Search, package pages, installed rows and upgrades)
//
// A row is the slim record lists draw: { id, name, short, version, section, icon, key, author, compat, purpose }.
import { parseControl, description, resolveFilename, resolveIcon, matchesArch, compareVersions, DEFAULT_ARCH } from "./apt.js";
import { parseStatus, installedStanzas, findUpgrades } from "./installed.js";
import { compat, compatCode, isIncompatible, normalizeDevice, needText } from "./compat.js";
import { parseSource, appStanza, isAltKey, runsOn, installOptions } from "./altstore.js";
import { depIndex, explain, explainApt } from "./deps.js";
import { needsRestart } from "./queue.js";

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
    kind: st.kind === "ipa" ? "ipa" : undefined, purpose: purposeOf(st),
    // search fields, lower-cased once at load; dropped before rows leave the worker
    _hay: [name, st.package, desc.short, desc.long, author, maint].join("\n").toLowerCase(),
    _n: name.toLowerCase(), _id: st.package.toLowerCase(), _a: author.toLowerCase(), _m: maint.toLowerCase(),
  };
}

// F126: Cydia's primaryPurpose (the first purpose:: tag), for the corner badge (core/sectionicons.js).
const purposeOf = (st) => tagsOf(st).find((t) => t.startsWith("purpose::"))?.slice(9) || null;

const slim = ({ id, name, short, version, section, icon, key, author, compat, paid, kind, purpose }) => ({ id, name, short, version, section, icon, key, author, compat, paid, kind, purpose });

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

// ---- Browse (F46) ------------------------------------------------------------------------------------------

// Home's Browse: AltStore app categories and APT sections merged into one short list. A row's category comes from
// its section: AltStore's "Apps (Games)" by the category inside, an APT section by its full lower-cased name, then
// by its simple name ("Themes (SpringBoard)" -> themes). APT sections with no category here (Libraries, System
// packages, Packaging...) stay out of Browse; All Packages still lists them.
export const BROWSE_CATEGORIES = ["Games", "Emulators", "Entertainment", "Photo & Video", "Social", "Lifestyle",
  "Utilities", "Developer", "Themes", "Tweaks", "Other"];
// Categories only a jailbroken phone can install: hidden while Not Jailbroken (F37).
export const JAILBREAK_CATEGORIES = new Set(["Themes", "Tweaks"]);
const BROWSE_OF = {
  games: "Games", game: "Games", emulators: "Emulators", emulator: "Emulators",
  entertainment: "Entertainment", multimedia: "Entertainment", books: "Entertainment", music: "Entertainment",
  "photo & video": "Photo & Video", social: "Social", messaging: "Social", lifestyle: "Lifestyle",
  utilities: "Utilities", productivity: "Utilities", networking: "Utilities", navigation: "Utilities",
  developer: "Developer", development: "Developer", "terminal support": "Developer", scripting: "Developer",
  administration: "Developer",
  themes: "Themes", theme: "Themes", wallpaper: "Themes", fonts: "Themes", ringtones: "Themes",
  tweaks: "Tweaks", addons: "Tweaks", widgets: "Tweaks", keyboards: "Tweaks",
  other: "Other", apps: "Other",
};
// Neither AltStore nor APT has an emulator category: a game, utility or app whose name or subtitle says
// "emulator" (or "emulation") goes under Emulators instead.
const EMULATED = new Set(["Games", "Utilities", "Entertainment", "Other"]);
const EMULATOR_WORD = /\bemulat(?:or|ors|ion)\b/i;

// A row ({ section, name, short }) -> its Browse category, or null when it has none.
export function browseCategory(row) {
  const s = String(row?.section ?? "").trim().toLowerCase();
  const inner = s.match(/^apps \((.*)\)$/);
  const cat = BROWSE_OF[inner ? inner[1] : s] ?? (inner ? "Other" : BROWSE_OF[simpleSection(s)]) ?? null;
  if (cat && EMULATED.has(cat) && (EMULATOR_WORD.test(row.name ?? "") || EMULATOR_WORD.test(row.short ?? ""))) return "Emulators";
  return cat;
}

// Rows -> the Browse list: [{ name, count }] in BROWSE_CATEGORIES order, empty ones left out, and Themes and
// Tweaks too unless `jailbroken`.
export function mergeCategories(rows, { jailbroken = true } = {}) {
  const counts = new Map();
  for (const r of rows) {
    const c = browseCategory(r);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return BROWSE_CATEGORIES.filter((c) => counts.has(c) && (jailbroken || !JAILBREAK_CATEGORIES.has(c)))
    .map((name) => ({ name, count: counts.get(name) }));
}

// Popular, until real install counts exist: [{ row, sources, date }] -> rows, most sources first (what most
// sources list), then the newest update (`date`, epoch ms; AltStore versions carry one, APT packages don't), then
// by name. At most `limit`.
export function rankPopular(items, limit = 50) {
  return [...items].sort((a, b) => b.sources - a.sources || (b.date ?? 0) - (a.date ?? 0) || compareNames(a.row, b.row))
    .slice(0, limit);
}

// ---- Browse's lists (F124) ----------------------------------------------------------------------------------

// Browse's Cydia-style lists, in the order its page shows them, before the categories. `jailbreak`: only where the
// phone is jailbroken (Settings > Device; Not Jailbroken lists apps only, F37).
export const BROWSE_LISTS = [
  { id: "new", title: "New" },
  { id: "updated", title: "Recently Updated" },
  { id: "popular", title: "Popular" },
  { id: "featured", title: "Featured" },
  { id: "free-apps", title: "Free Apps", free: "apps" },
  { id: "free-tweaks", title: "Free Tweaks", free: "tweaks", jailbreak: true },
  { id: "free-themes", title: "Free Themes", free: "themes", jailbreak: true },
];
export const browseList = (id) => BROWSE_LISTS.find((l) => l.id === id) ?? null;
export const browseListsFor = (jailbroken = true) => BROWSE_LISTS.filter((l) => jailbroken || !l.jailbreak);

// New and Recently Updated: how many days back they reach, and how many rows each keeps.
export const FRESH_DAYS = 30;
export const FRESH_LIMIT = 100;

// The Changes tab's records (core/changes.js: { id, version, first, date? }) and the catalog's rows (All Sources,
// one per id, the candidate version) -> { new: [row], updated: [row] }, each row with `seen` (epoch ms) and
// `change`. Times as the Changes tab counts them (core/changes.js dayGroups): a version's own date where the
// source gives one (AltStore versions[]), else the refresh that first saw it; undated records from the first
// refresh are the archive, never new. A row is new when its candidate is the first version ever seen of it, and
// updated when an older one came before. Newest first (rows keep their order on a tie), the last `days` only.
export function freshLists(records, rows, { now = Date.now(), days = FRESH_DAYS, limit = FRESH_LIMIT } = {}) {
  let baseline = Infinity;
  for (const r of records) if (r.date == null && r.first < baseline) baseline = r.first;
  const times = new Map(); // id -> { first, byVersion: version -> earliest counted time }
  for (const r of records) {
    const t = r.date ?? r.first;
    let p = times.get(r.id);
    if (!p) times.set(r.id, (p = { first: t, byVersion: new Map() }));
    if (t < p.first) p.first = t;
    if (r.date == null && r.first === baseline) continue;
    const v = p.byVersion.get(r.version);
    if (v === undefined || t < v) p.byVersion.set(r.version, t);
  }
  const from = now - days * 86400000;
  const out = { new: [], updated: [] };
  rows.forEach((row, i) => {
    const p = times.get(row.id);
    const at = p?.byVersion.get(row.version ?? "");
    if (at === undefined || at < from) return;
    const change = at > p.first ? "updated" : "new";
    out[change].push([{ ...row, change, seen: Math.min(at, now) }, i]);
  });
  const order = (list) => list.sort((a, b) => b[0].seen - a[0].seen || a[1] - b[1]).slice(0, limit).map(([r]) => r);
  return { new: order(out.new), updated: order(out.updated) };
}

// Free Apps / Tweaks / Themes: a row's kind for those lists. Apps are AltStore apps (IPAs) and APT packages in an
// app section; Tweaks and Themes are Browse's categories of those names.
export function freeKind(row) {
  if (row?.kind === "ipa" || sectionGroup(row?.section ?? "") === "Apps") return "apps";
  const c = browseCategory(row);
  return c === "Tweaks" ? "tweaks" : c === "Themes" ? "themes" : null;
}

// Search (F101, docs/sileo-zebra.md 'Search'). Zebra's short-query rule: one Latin character (code point below
// U+0100) is too broad to search, locally or on Canister; one CJK (or other non-Latin) character is a word.
export function searchable(query) {
  const q = String(query ?? "").trim();
  if (!q) return false;
  const chars = [...q];
  return chars.length > 1 || chars[0].codePointAt(0) >= 0x100;
}

// Does `s` hold `q` at the start of a word (after a character that is not a letter or digit)? "board" starts a
// word in "snow board" and "com.x.board", not in "keyboard". The start of `s` itself is the prefix tier's.
export function wordStart(s, q) {
  for (let i = s.indexOf(q, 1); i > 0; i = s.indexOf(q, i + 1)) {
    if (!/[\p{L}\p{N}]/u.test(s[i - 1])) return true;
  }
  return false;
}

// ---- Version History (F29) ---------------------------------------------------------------------------------

// APT: `offers` [{ key, stanza }] (every version every source lists) -> one entry per version, newest first:
// { version, keys: [source keys carrying it], size, debUrl, filename, candidate, installed }. `candidate` is the
// version the page shows; `installed` dpkg's. An installed version no source still offers is listed too (keys []),
// so Downgrade (N4) sees where the phone stands.
export function aptVersionList(offers, { candidate = null, installed = null } = {}) {
  const byVersion = new Map();
  for (const { key, stanza } of offers) {
    const v = String(stanza?.version ?? "");
    if (!v) continue;
    let o = byVersion.get(v);
    if (!o) {
      o = { version: v, keys: [], size: Number(stanza.size) > 0 ? Number(stanza.size) : null, debUrl: stanza.debUrl ?? null,
        filename: stanza.filename ?? null, candidate: v === candidate, installed: v === installed };
      byVersion.set(v, o);
    }
    if (!o.keys.includes(key)) o.keys.push(key);
    if (!o.debUrl && stanza.debUrl) o.debUrl = stanza.debUrl;
  }
  if (installed && !byVersion.has(installed)) {
    byVersion.set(installed, { version: installed, keys: [], size: null, debUrl: null, filename: null, candidate: installed === candidate, installed: true });
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

// AltStore: every versions[] entry of a parsed app (core/altstore.js parseApp), in the source's order (newest
// first), each with `runs` (this iOS is inside its min/maxOSVersion; ios null: true), `candidate` (the newest
// that runs: the one the page shows) and `installable` (it has an IPA or a signed link to install from).
export function altVersionList(app, ios = null) {
  const list = Array.isArray(app?.versions) ? app.versions : [];
  let candidate = false;
  return list.map((v) => {
    const runs = runsOn(v, ios);
    const isCandidate = runs && !candidate;
    if (isCandidate) candidate = true;
    const o = installOptions(v, null);
    return { ...v, runs, candidate: isCandidate, installable: Boolean(o.itms || o.download) };
  });
}

export function createCatalog() {
  const sources = new Map(); // key -> { byId: Map(id -> { row, stanza }) }
  let merged = null;         // "All Sources": id -> { row, stanza, key }, built when first asked, dropped on load
  const sorted = new Map();  // key -> rows sorted by name (cache)
  let hidden = new Set();    // Section Visibility (Cydia's CydiaSections Hidden): section names left out of lists
  const shown = new Map();   // key -> sorted rows outside hidden sections (cache)
  let hiddenAuthors = new Set(); // F104: lower-cased author/maintainer names whose packages are left out of lists
  let device = null;         // F17: the device rows are judged for (core/compat.js), or null before one is set
  let fitFilter = false;     // and whether rows that can't work on it are left out
  const fitting = new Map(); // key -> sorted rows that can work on the device (cache)
  let appsOnly = false;       // F37: the device isn't jailbroken: only AltStore sources (`alt:` keys) count
  const counts = (key) => !appsOnly || isAltKey(key);
  const judge = (e) => { e.row.compat = device ? compatCode(e.stanza, device) : null; };

  function load(key, text, root, arch = DEFAULT_ARCH) {
    const byId = new Map();
    for (const st of parseControl(text)) {
      if (!st.package || !matchesArch(st, arch) || !isVisible(st)) continue;
      const cur = byId.get(st.package);
      st.debUrl = root ? resolveFilename(root, st.filename) : null;
      // One source can list several versions of a package: the newest is the candidate, as in apt. The others
      // stay in `older` for the Version History page (F29, history()).
      if (cur && compareVersions(cur.stanza.version, st.version) >= 0) { cur.older.push(st); continue; }
      st.iconUrl = resolveIcon(root, st.icon);
      byId.set(st.package, { stanza: st, row: makeRow(st, key), older: cur ? [cur.stanza, ...cur.older] : [] });
    }
    for (const e of byId.values()) judge(e);
    sources.set(key, { byId });
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return byId.size;
  }

  // F9: an AltStore source's JSON (text or parsed). Its apps go in like packages; the rest (news, header, tint,
  // featured apps) is kept for its source page. F16a: `format` (the source record's: altstore, esign, scarlet,
  // gbox; none is AltStore) picks the reader (core/altstore.js parseSource), so each app's `extra` comes along.
  const altMeta = new Map(); // key -> parsed source without apps
  function loadAlt(key, json, ios = null, format = null) {
    const parsed = parseSource(format, json);
    const byId = new Map();
    for (const app of parsed.apps) {
      const st = appStanza(app, { url: key.replace(/^alt:/, ""), name: parsed.name }, ios);
      // `app` keeps every versions[] entry (the stanza only those that run here) for Version History (F29).
      if (st) byId.set(st.package, { stanza: st, row: makeRow(st, key), app, ios });
    }
    for (const e of byId.values()) judge(e);
    const { apps, ...meta } = parsed;
    altMeta.set(key, meta);
    sources.set(key, { byId });
    merged = null;
    sorted.clear();
    shown.clear();
    fitting.clear();
    return byId.size;
  }

  function altSource(key) {
    const meta = altMeta.get(key);
    if (!meta) return null;
    const byId = sources.get(key)?.byId ?? new Map();
    const featured = meta.featuredApps.map((id) => byId.get(id)?.row).filter(Boolean).map(slim);
    return { ...meta, featured, count: byId.size };
  }

  function remove(key) {
    altMeta.delete(key);
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
    const apps = device?.jailbreak === "none";
    if (apps !== appsOnly) { appsOnly = apps; merged = null; sorted.clear(); }
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

  // F104: Hide by Author. Names compare lower-cased, as author() does.
  function setHiddenAuthors(names) {
    hiddenAuthors = new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && n.trim())
      .map((n) => n.trim().toLowerCase()));
    shown.clear();
    return hiddenAuthors.size;
  }
  const byHiddenAuthor = (r) => hiddenAuthors.size > 0 && (hiddenAuthors.has(r._a) || hiddenAuthors.has(r._m));
  const isHidden = (r) => hidden.has(r.section) || byHiddenAuthor(r);

  // id -> entry for a source, or the merge of all of them: the newest version wins; on a tie, the first source
  // loaded keeps it (apt's default: equal pins, first listed).
  function entries(key) {
    if (key !== ALL) return (counts(key) && sources.get(key)?.byId) || new Map();
    if (merged) return merged;
    merged = new Map();
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
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
    if (!hidden.size && !hiddenAuthors.size) return fitOf(key);
    let rows = shown.get(key);
    if (!rows) {
      rows = fitOf(key).filter((r) => !isHidden(r));
      shown.set(key, rows);
    }
    return rows;
  }

  // `total` counts visible packages only. With { hidden: true } (Section Visibility's edit mode) hidden sections
  // are listed too, each marked; without it they are left out.
  function sections(key = ALL, { hidden: withHidden = false } = {}) {
    const counts = new Map();
    for (const r of fitOf(key)) if (!byHiddenAuthor(r)) counts.set(r.section, (counts.get(r.section) ?? 0) + 1);
    const list = [...counts].filter(([name]) => withHidden || !hidden.has(name))
      .map(([name, count]) => (withHidden ? { name, count, hidden: hidden.has(name) } : { name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    return { total: visibleOf(key).length, sections: list };
  }

  function list(key = ALL, section = ALL) {
    const rows = visibleOf(key);
    return (section === ALL ? rows : rows.filter((r) => r.section === section)).map(slim);
  }

  // F101: id -> how many (counted) sources list it, rankPopular's measure; rebuilt when the merge is.
  let spread = null, spreadOf = null;
  function sourceCounts() {
    const all = entries(ALL);
    if (spreadOf === all) return spread;
    spread = new Map();
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
      for (const id of byId.keys()) spread.set(id, (spread.get(id) ?? 0) + 1);
    }
    spreadOf = all;
    return spread;
  }

  // Every word must appear somewhere (name, id, description, author or maintainer). Ranked: exact name or id,
  // then name or id starting with the query, then the query starting a word in the name or id (F101), then the
  // query inside the name or id, then author or maintainer, then the rest. Within a tier (Sileo): the name
  // closest in length to the query, then the most sources listing it, then by name. One Latin character finds
  // nothing (searchable(), Zebra's rule).
  // Search's filters (F35, all optional): `section` a section name or a SECTION_GROUPS group ("group:Tweaks"),
  // `source` a source key, `installed` "installed" | "not", `price` "free" | "paid". With the Works on My Phone
  // filter on, what can't work drops out, except an exact name or id match: that one stays, marked `exact`, with
  // `why` ("Needs iOS 15 or earlier") for the row's subtitle.
  function search(query, { limit = 2000, section = null, source = null, installed = null, price = null } = {}) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!searchable(q)) return [];
    const words = q.split(/\s+/);
    const key = source && sources.has(source) ? source : ALL;
    if (source && key === ALL) return []; // a source that isn't loaded has nothing
    const inSection = sectionTest(section);
    const hits = [];
    const listed = sourceCounts();
    for (const r of rowsOf(key)) {
      if (isHidden(r)) continue;
      if (!words.every((w) => r._hay.includes(w))) continue;
      if (inSection && !inSection(r)) continue;
      if (installed === "installed" && !statusById.has(r.id)) continue;
      if (installed === "not" && statusById.has(r.id)) continue;
      if (price === "paid" && !r.paid) continue;
      if (price === "free" && r.paid) continue;
      let rank = 5;
      if (r._n === q || r._id === q) rank = 0;
      else if (r._n.startsWith(q) || r._id.startsWith(q)) rank = 1;
      else if (r._n.includes(q) || r._id.includes(q)) rank = wordStart(r._n, q) || wordStart(r._id, q) ? 2 : 3;
      else if (r._a.includes(q) || r._m.includes(q)) rank = 4;
      if (fitFilter && rank !== 0 && isIncompatible(r.compat)) continue;
      // One number sorts by tier, then length gap, then sources (most first); rows come in name order (rowsOf)
      // and the sort is stable, so name breaks the last tie without the collator. Twice R12's ~4 ms otherwise.
      const gap = Math.min(Math.abs(r._n.length - q.length), 9999);
      hits.push([rank * 1e8 + gap * 1e4 + (9999 - Math.min(listed.get(r.id) ?? 0, 9999)), rank, r]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    return hits.slice(0, limit).map(([, rank, r]) => {
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
    // F104: a hidden author's own page still lists their packages (hidden sections and misfits stay out).
    return fitOf(ALL).filter((r) => !hidden.has(r.section) && (r._a === n || r._m === n)).map(slim);
  }

  function pkg(id, key = ALL) {
    const e = entries(key).get(id);
    if (!e) return installedOnly(id);
    const others = [];
    for (const [k, { byId }] of sources) {
      if (!counts(k)) continue;
      const o = byId.get(id);
      if (o) others.push({ key: k, version: o.stanza.version });
    }
    return { stanza: e.stanza, key: e.row.key, row: slim(e.row), others };
  }

  // Version History (F29): every version of `id` on offer. APT: each version any source carries (the candidate
  // and the older ones a Packages file also lists), merged by version (aptVersionList); AltStore: every versions[]
  // entry of the app in the source of the page (altVersionList). Null when the package isn't in the catalog.
  function history(id, key = ALL) {
    const e = entries(key).get(id);
    if (!e) {
      const st = statusById.get(id);
      return st ? { kind: "apt", id, name: st.name || id, versions: aptVersionList([], { installed: st.version }) } : null;
    }
    if (e.app) return { kind: "ipa", id, name: e.row.name, key: e.row.key, sourceUrl: e.stanza.ipa?.sourceUrl ?? null,
      versions: altVersionList(e.app, e.ios) };
    const offers = [];
    for (const [k, { byId }] of sources) {
      if (!counts(k) || isAltKey(k)) continue;
      const o = byId.get(id);
      if (o) for (const st of [o.stanza, ...(o.older ?? [])]) offers.push({ key: k, stanza: st });
    }
    return { kind: "apt", id, name: e.row.name, versions: aptVersionList(offers, { candidate: e.stanza.version, installed: statusById.get(id)?.version }) };
  }

  // ---- Browse (F46): over what every list shows (hidden sections and, with the filter on, misfits left out) ----
  function categories() {
    return mergeCategories(visibleOf(ALL), { jailbroken: !appsOnly });
  }

  function browse(category) {
    if (appsOnly && JAILBREAK_CATEGORIES.has(category)) return [];
    return visibleOf(ALL).filter((r) => browseCategory(r) === category).map(slim);
  }

  function popular({ limit = 50 } = {}) {
    const lists = [...sources].filter(([k]) => counts(k)).map(([, { byId }]) => byId);
    const all = entries(ALL);
    const items = visibleOf(ALL).map((row) => ({
      row, sources: lists.reduce((n, byId) => n + (byId.has(row.id) ? 1 : 0), 0),
      date: all.get(row.id)?.stanza.ipa?.versions?.[0]?.date ?? null,
    }));
    return rankPopular(items, limit).map(({ row, sources: n }) => ({ ...slim(row), sources: n }));
  }

  // F124, Browse's Free Apps / Tweaks / Themes: the free rows of that kind (freeKind), by name. Tweaks and Themes
  // are empty while Not Jailbroken.
  function free(kind) {
    if (appsOnly && kind !== "apps") return [];
    return visibleOf(ALL).filter((r) => !r.paid && freeKind(r) === kind).map(slim);
  }

  // F124, Browse's Featured: `refs` ([{ key, id }], the sources' banners and AltStore featured apps, in order) ->
  // their rows, the source's own version (else All Sources'), each package once, hidden and unfit ones left out.
  function featured(refs = []) {
    const seen = new Set();
    const out = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const id = ref?.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      const e = (ref.key !== ALL && counts(ref.key) && sources.get(ref.key)?.byId.get(id)) || entries(ALL).get(id);
      if (!e || isHidden(e.row) || (fitFilter && isIncompatible(e.row.compat))) continue;
      seen.add(id);
      out.push(slim(e.row));
    }
    return out;
  }

  // Which of `names` the catalog has (for linking Depends on the package page): on a source, or installed (its
  // page then comes from the status stanza).
  const has = (names) => names.filter((n) => entries(ALL).has(n) || statusById.has(n));

  // F18: what stops `id` installing, in plain words (core/deps.js explain), resolved against every APT source's
  // packages (older versions too) and dpkg's status. The index is rebuilt when a source or the status file changes.
  let depCache = null; // { all, status, index }
  function deps(id, key = ALL) {
    const e = entries(key).get(id);
    const st = e?.stanza ?? statusById.get(id);
    if (!st || st.kind === "ipa") return null;
    return explain(st, { device, index: currentDepIndex() });
  }

  function currentDepIndex() {
    const all = entries(ALL);
    if (!depCache || depCache.all !== all || depCache.status !== statusById) {
      const available = [];
      for (const [k, { byId }] of sources) {
        if (!counts(k) || isAltKey(k)) continue;
        for (const o of byId.values()) for (const s of [o.stanza, ...(o.older ?? [])]) available.push({ stanza: s, key: k });
      }
      depCache = { all, status: statusById, index: depIndex({ available, installed: [...statusById.values()] }) };
    }
    return depCache.index;
  }

  // N4's Confirm sheet: apt's refusal (apt-get -s output) in F18's plain words, against the same index.
  const aptProblems = (output) => explainApt(output, { device, index: currentDepIndex() });

  // N4: for the queue's package ids, { id: { name, restart } }: the name to show, and whether any version of it
  // (installed, or any a source offers) depends on mobilesubstrate, so the console ends with Restart SpringBoard.
  function queueInfo(ids = []) {
    const all = entries(ALL);
    const out = {};
    for (const id of ids) {
      const e = all.get(id);
      const st = statusById.get(id);
      const stanzas = [st, e?.stanza, ...(e?.older ?? [])];
      for (const [k, { byId }] of sources) {
        if (isAltKey(k)) continue;
        const o = byId.get(id);
        if (o && o !== e) stanzas.push(o.stanza, ...(o.older ?? []));
      }
      out[id] = { name: e?.row.name ?? (st ? installedPkgs?.find((r) => r.id === id)?.name : null) ?? null, restart: needsRestart(stanzas) };
    }
    return out;
  }

  // Every (source, id, candidate version) loaded: what the Changes tab files on a refresh (core/changes.js).
  // F51: AltStore apps add every runnable versions[] entry with its date, [key, id, version, date], so the tab
  // files them under the day they came out (and an app with an older version shows as Updated).
  function versions() {
    const out = [];
    for (const [k, { byId }] of sources) {
      for (const [id, e] of byId) {
        const vs = e.stanza.ipa?.versions;
        if (!Array.isArray(vs) || !vs.length) { out.push([k, id, e.stanza.version ?? ""]); continue; }
        for (const v of vs) out.push([k, id, v.version ?? "", v.date ?? null]);
      }
    }
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
        icon: e?.row.icon ?? null, key: e?.row.key ?? null, author: p.author, installed: p.version, held: p.held, tier: p.tier, // F127
        purpose: e?.row.purpose ?? (statusById.has(p.id) ? purposeOf(statusById.get(p.id)) : null),
        size: installedBytes(statusById.get(p.id)),
        compat: e ? e.row.compat : (device && statusById.has(p.id) ? compatCode(statusById.get(p.id), device) : null) };
    });
  }

  // Every source counts (not just visible sections): an upgrade in a hidden section is still an upgrade.
  function upgrades(holds = [], opts = {}) {
    if (!installedPkgs) return { available: [], ignored: [] };
    const all = entries(ALL);
    return findUpgrades(installedPkgs, (id) => { const e = all.get(id); return e ? slim(e.row) : null; }, holds, opts);
  }

  return { load, loadAlt, altSource, remove, setHidden, setHiddenAuthors, sections, list, search, author, package: pkg, history, has, versions, keys: () => [...sources.keys()],
    categories, browse, popular, free, featured,
    setInstalled, installed, upgrades, setDevice,
    deps, aptProblems, queueInfo };
}

// F104: a status stanza's Installed-Size (dpkg writes KiB) in bytes, or null.
export function installedBytes(st) {
  const n = Number(String(st?.["installed-size"] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1024) : null;
}

// Runs a catalog operation by name: the worker's entry point. Unknown ops throw.
export function runCatalog(catalog, op, args = []) {
  const f = { load: catalog.load, loadAlt: catalog.loadAlt, altSource: catalog.altSource, remove: catalog.remove, sections: catalog.sections, list: catalog.list,
    search: catalog.search, author: catalog.author, package: catalog.package, history: catalog.history, has: catalog.has, keys: catalog.keys,
    versions: catalog.versions, setHidden: catalog.setHidden, setHiddenAuthors: catalog.setHiddenAuthors, setInstalled: catalog.setInstalled,
    installed: catalog.installed, upgrades: catalog.upgrades, setDevice: catalog.setDevice,
    categories: catalog.categories, browse: catalog.browse, popular: catalog.popular, free: catalog.free, featured: catalog.featured,
    deps: catalog.deps, aptProblems: catalog.aptProblems, queueInfo: catalog.queueInfo }[op];
  if (!f) throw new Error(`unknown catalog op ${op}`);
  return f(...args);
}
