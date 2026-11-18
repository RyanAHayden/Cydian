// Installed tab (F7): the packages dpkg has on the device, from its status file (core/installed.js, parsed in the
// worker's catalog). In the app the native backend reads the file; on the site the visitor chooses it here, and it
// stays on the device (catalog.js setStatus). A plain list with Cydia's A–Z headers, like every package list;
// rows open the package page (screens/browse.js tokens below the root, as on the Changes tab).
//
// F30: without a jailbreak (the site, the sideload build) the root lists the apps the user installed from an app
// page instead (core/installed.js apps(), recorded on the device), newest first, with an Upgrade badge when a
// source has a newer version; Edit or a left swipe deletes one the user removed from the phone. On the site the
// dpkg list above stays for jailbroken phones, one row down at #installed/dpkg. Jailbreak mode is F7 unchanged.
//
// F77: a My IPAs row under the apps opens the user's own IPAs (screens/myipas.js, #installed/myipas/...).
//
// F87: in the jailbreak app, apps iFizBox remembers (core/installed.js) are on an Apps page one row down
// (#installed/apps, the row above dpkg's packages, there only when it has any), listed at the version on the phone
// (app-updates.js rememberedApps, I4) with the note where it differs from what iFizBox remembered.
//
// F91: in the sideload app every app iFizBox signed (signing.installed) shows its signature's days left on the right,
// a small pill (core/signing.js signatureState; packages.css .sig-pill): green outside the re-sign window (Settings >
// Signing > Re-sign Reminder), amber inside it, red once expired. Signed apps the list doesn't remember (My IPAs,
// Custom Install as another ID) are listed under them, without Delete (Signed Apps in Settings forgets those).
//
// F104: the dpkg list has a scope bar as on iOS 6's Usage screen: Name (A–Z, as before), Recent (newest install
// first, by the mtime of dpkg's info/<pkg>.list, which the jailbreak app reads: apt.installDates in Apt.swift;
// the site's uploaded status file has no dates, so no Recent there) and Size (Installed-Size, largest first).
//
// F127: Installed as Cydia's (user 2026-11-18). Cydia 1.1's segmented control in the nav bar, User | Expert | Recent
// (core/installed.js modeRows: User leaves out Essential packages and dependencies, Expert lists everything, Recent
// newest install first in day sections), replaces F104's Name/Recent/Size bar; Recent needs the jailbreak app's
// install dates, so the site's dpkg page has User | Expert. Under the Apps and Wish List rows, a search bar narrows
// the list as it is typed and Search's scope segments filter by kind (All, Tweaks, Themes, Apps). Without a jailbreak
// the apps list gets User (A–Z) | Recent (newest first, by day) and the search bar, no kinds (it is all apps).
//
// F130: User mode from apt's own marks: in the jailbreak app apt.autoInstalled (Apt.swift, /var/lib/apt/
// extended_states) names the packages apt installed only for another's dependency, and core/installed.js markedRows
// hides those instead of F127's guess (anything another installed package needs), which hid tweaks the user chose
// that others also need. Where the marks can't be read (the site's uploaded status file) the guess stays.
//
// F125: the Wish List lives here (it was a row on Home): a Wish List row with its count (a grey count badge) on the
// root, under the installed lists (beside Apps above dpkg's packages in the jailbreak app, so it isn't hundreds of rows
// down; a Packages section under the apps elsewhere), opens #installed/wishlist: the wished packages as a package
// list, Edit (the red minus, then Delete) or a left swipe removes one, as on the apps list.
//
// F147: the Wish List moved off the page into the nav bar (user 2026-11-18: "the wishlist should go in the top left
// instead of as an entry in installed"): a bordered "Wish List" bar button in the left slot of Installed's root (the
// apps list without a jailbreak, dpkg's list in the jailbreak app), with the count as Mail's "Inbox (3)" does,
// opening the same #installed/wishlist page. Edit was already on the right, so nothing had to move.
import * as browse from "./browse.js";
import * as myipas from "./myipas.js";
import { grouped, plain, placeholder, segments } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { showAlert } from "../nav/alert.js";
import { detectMode } from "../core/settings.js";
import { apps, appRows, appUpgrades, removeInstall, onAppsChange, MODES, MODE_LABEL, TYPES, modeRows, typeRows, queryRows,
  dayHeaders, dayLabel, markedRows } from "../core/installed.js";
import { mediaUrl } from "./depiction.js";
import { rememberedApps } from "../app-updates.js";
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { settings } from "./settings.js";
import { wishRows, wishCount, WISH_EMPTY } from "../core/wishlist.js";
import { compareNames, indexLetter } from "../core/catalog.js";
import { NAME } from "../brand.js";

export const title = "Installed";

export const DPKG = "dpkg"; // the site's path segment for the status file's packages
export const APPS = "apps"; // F87: the jailbreak app's path segment for the remembered apps
export const WISH = "wishlist"; // F125: the Wish List page's path segment

const state = { body: null, route: null, list: null, seq: 0, dates: null, auto: null, mode: "user", type: "All", query: "", tail: [] };

// ---- F127: modes, kinds and search -----------------------------------------------------------------------------

// Whether install dates can be read (the jailbreak app: apt.installDates), so Recent can be offered.
export function canReadDates(native = globalThis.ifizboxNative) {
  return typeof native?.call === "function" && typeof native?.dpkgStatus === "function";
}

// The modes the dpkg list offers.
export const dpkgModes = (hasDates) => MODES.filter((m) => m !== "recent" || hasDates);
// The apps list's: User (A–Z) and Recent; there are no dependencies or Essential apps to leave out.
export const APP_MODES = ["user", "recent"];

// What the dpkg list shows: the mode's rows of the kind, narrowed by the search; Recent with its day headers.
// F130: `auto` is apt's Auto-Installed set (autoInstalled), or null to keep the dependency guess.
export function dpkgItems(rows, { mode = "user", type = "All", query = "", dates = null, auto = null, locale } = {}) {
  const shown = queryRows(typeRows(modeRows(markedRows(rows, auto), mode, dates), type), query);
  return mode === "recent" ? dayHeaders(shown, dates, locale) : shown;
}

// The apps list's sections (nav/ui.js plain): User by name under A–Z headers, Recent newest first under day headers
// (r.date is in milliseconds), both narrowed by the search.
export function appSections(rows, { mode = "user", query = "", locale } = {}) {
  const shown = queryRows(rows, query);
  const out = [];
  if (mode === "recent") {
    for (const r of appRows(shown)) {
      const label = r.date > 0 ? dayLabel(r.date / 1000, locale) : NAME;
      if (out.at(-1)?.header !== label) out.push({ header: label, rows: [] });
      out.at(-1).rows.push(r);
    }
  } else {
    for (const r of [...shown].sort(compareNames)) {
      const label = indexLetter(r.name);
      if (out.at(-1)?.header !== label) out.push({ header: label, rows: [] });
      out.at(-1).rows.push(r);
    }
  }
  return out;
}

// { package: seconds } from apt.installDates (the jailbreak app), or null where it can't be read.
export async function installDates(native = globalThis.ifizboxNative) {
  if (!canReadDates(native)) return null;
  try {
    const d = await native.call("apt.installDates", {});
    return d && typeof d === "object" && Object.keys(d).length ? d : null;
  } catch { return null; }
}

// F130: a Set of the packages apt marked Auto-Installed (apt.autoInstalled, the jailbreak app), or null where the
// marks can't be read: no dpkg (the site, the sideload build), an older shell, or no extended_states file.
export async function autoInstalled(native = globalThis.ifizboxNative) {
  if (!canReadDates(native)) return null;
  try {
    const list = await native.call("apt.autoInstalled", {});
    return Array.isArray(list) ? new Set(list.filter((p) => typeof p === "string")) : null;
  } catch { return null; }
}


// Cydia's User | Expert | Recent, in the nav bar in place of the title (app.js titleView).
function modeControl(modes, current, onPick) {
  const wrap = Object.assign(document.createElement("div"), { className: "nav-segments" });
  wrap.append(segments(modes, MODE_LABEL, current, onPick));
  return wrap;
}

// The search bar (Search's look) that narrows `view`'s list as it is typed; with `types`, Search's kinds under it.
function filterControls(view, { types = false, onChange }) {
  const bar = Object.assign(document.createElement("form"), { className: "search-bar installed-search" + (types ? " has-scope" : "") });
  bar.setAttribute("role", "search");
  const field = Object.assign(document.createElement("label"), { className: "search-field" });
  const input = Object.assign(document.createElement("input"), { type: "search", placeholder: "Search", autocomplete: "off", spellcheck: false });
  input.autocapitalize = "off";
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search installed packages");
  input.enterKeyHint = "search";
  input.value = view.query ?? "";
  const changed = () => { if (input.value !== view.query) { view.query = input.value; onChange(); } };
  input.addEventListener("input", changed);
  input.addEventListener("search", changed); // the field's clear button
  bar.addEventListener("submit", (e) => { e.preventDefault(); input.blur(); });
  field.append(input);
  bar.append(field);
  if (!types) return [bar];
  const scope = Object.assign(document.createElement("div"), { className: "search-scope installed-scope" });
  scope.append(segments(TYPES, {}, view.type, (t) => { view.type = t; onChange(); }));
  return [bar, scope];
}
const appView = { body: null, route: null, seq: 0, editing: false, right: null, mode: "user", query: "", tail: [], last: null };

// Records apps (F30) rather than reading dpkg: everywhere but the jailbreak app.
export const recordsApps = (mode = detectMode()) => mode !== "jailbreak";

// Which page a route is: "apps" (F30's list), "dpkg" (the status file's packages), "myipas" (F77) or a browse.js page.
export function pageKind(route, mode = detectMode()) {
  if (route.path.length === 1 && route.path[0] === WISH) return "wishlist"; // F125, in every mode
  if (!recordsApps(mode)) return !route.path.length ? "dpkg" : route.path.length === 1 && route.path[0] === APPS ? "apps" : "browse";
  if (!route.path.length) return "apps";
  if (route.path[0] === myipas.MYIPAS) return "myipas";
  return route.path.length === 1 && route.path[0] === DPKG && mode === "site" ? "dpkg" : "browse";
}

export function init() {
  catalog.onChange(() => {
    if (state.body) load();
    if (appView.body) loadApps();
  });
  onAppsChange(() => { if (appView.body) loadApps(); });
  // F125/F147: the count on the Wish List button, and the Wish List page, follow the list (the package page's sheet, a Delete).
  browse.wishlist().onChange(() => {
    if (wishView.body) loadWish();
    updateWishButton();
  });
  // F134: Settings > Signing > Show Expiry Dates puts the pills back or takes them away.
  settings.onChange((key) => { if (key === "showExpiry") redrawApps(); });
}

export function nav(route, ctx) {
  const info = navInfo(route);
  // F147: the Wish List button, top left of Installed's root (no back button there).
  if (isRoot(route)) info.left = wishButton(route, wishCount(browse.wishlist().list(), knownInstalled()), { go: ctx?.go, ref: (b) => { wishBar.el = b; b.classList.add("wish-button"); updateWishButton(); } });
  return info;
}

function navInfo(route) {
  const kind = pageKind(route);
  if (kind === "browse") return browse.nav(route);
  if (kind === "myipas") return myipas.nav(route);
  if (kind === "wishlist") {
    return { title: "Wish List", style: "plain",
      right: { label: wishView.editing ? "Done" : "Edit", onClick: (e) => setWishEditing(!wishView.editing, e.currentTarget) } };
  }
  if (kind === "apps") {
    return { title: recordsApps() ? "Installed" : "Apps", style: "plain", // F87: "Apps" one row down in the jailbreak app
      // F127: User | Recent on the apps list's root (the jailbreak app's Apps page stays newest first).
      titleView: recordsApps() ? modeControl(APP_MODES, appView.mode, (m) => { appView.mode = m; redrawApps(); }) : undefined,
      right: { label: appView.editing ? "Done" : "Edit", onClick: (e) => setEditing(!appView.editing, e.currentTarget) } };
  }
  const info = { title: recordsApps() ? "dpkg Status" : "Installed", style: "plain" };
  // F127: Cydia's User | Expert | Recent in place of the title.
  const modes = dpkgModes(canReadDates());
  if (!modes.includes(state.mode)) state.mode = "user";
  info.titleView = modeControl(modes, state.mode, (m) => { state.mode = m; if (state.body) drawList(); });
  // The site: pick a newer status file whenever the phone's packages changed.
  if (catalog.statusSource() === "upload") info.right = { label: "Load", onClick: () => chooseStatus() };
  return info;
}

export function render(body, route, ctx) {
  const kind = pageKind(route);
  if (kind === "browse") {
    browse.render(body, route, ctx);
    return;
  }
  if (kind === "myipas") {
    myipas.render(body, route, ctx);
    return;
  }
  if (kind === "wishlist") {
    wishView.body = body;
    wishView.route = route;
    body.append(placeholder("list"));
    loadWish();
    return;
  }
  if (kind === "apps") {
    appView.body = body;
    appView.route = route;
    appView.last = null;
    body.append(placeholder("list", 6));
    loadApps();
    return;
  }
  state.body = body;
  state.route = route;
  body.append(placeholder("list"));
  load();
}

function note(text) {
  return Object.assign(document.createElement("p"), { className: "empty", textContent: text });
}

export function emptyText(source) {
  return source === "native"
    ? { label: "No packages", footer: "Couldn't read dpkg's status file." }
    : { label: "Choose Status File",
      footer: "Copy /var/jb/var/lib/dpkg/status (rootless) or /var/lib/dpkg/status off your iPhone, then choose it " +
        "here to see what's installed and which packages have upgrades. It stays on this device." };
}

async function load() {
  const seq = ++state.seq;
  let rows;
  let appCount = 0;
  let dates = null;
  let auto = null;
  try {
    // F87: the Apps row has to be there before the list measures where it starts (vlist.js caches the offset).
    [rows, appCount, dates, auto] = await Promise.all([catalog.installed(), recordsApps() ? 0 : jailbreakAppCount(), installDates(),
      autoInstalled()]);
  } catch (e) {
    if (seq === state.seq) state.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== state.seq) return;
  Object.assign(state, { rows, appCount, dates, auto });
  draw();
}

// Draws the list from what load() read (F104: again when the sort changes, without asking the worker).
function draw() {
  const { rows, body } = state;
  const appCount = state.appCount ?? 0;
  browse.dropList(body, state.list);
  state.list = null;
  if (!rows) {
    const t = emptyText(catalog.statusSource());
    body.classList.replace("plain", "grouped");
    body.replaceChildren(grouped([{
      rows: [{ label: t.label, onClick: catalog.statusSource() === "upload" ? () => chooseStatus() : null, chevron: false }],
      footer: t.footer,
    }]));
    return;
  }
  body.classList.replace("grouped", "plain");
  updateWishButton(); // F147: dpkg's list is in, so the count leaves installed packages out
  // F87's Apps row (F147: F125's Wish List row is a nav-bar button now).
  const top = [appCount ? appsRow(state.route, appCount) : null].filter(Boolean);
  if (!rows.length) {
    body.replaceChildren(...(top.length ? [grouped([{ rows: top }])] : []), note("No packages."));
    return;
  }
  body.replaceChildren();
  if (top.length) {
    const g = grouped([{ rows: top }]);
    g.firstElementChild?.classList.add("installed-top"); // F127: stops short of the A–Z index (packages.css)
    body.append(g);
  }
  // F127: the search bar and kinds go in before the list measures where it starts.
  body.append(...filterControls(state, { types: true, onChange: drawList }));
  state.tail = [];
  drawList();
}

// The list under the controls, again whenever the mode, the kind or the search changes (the field keeps its focus).
function drawList() {
  const { rows, body } = state;
  if (!rows?.length || !body) return;
  browse.dropList(body, state.list);
  state.list = null;
  for (const n of state.tail) n.remove();
  const { mode, dates, auto } = state;
  const items = dpkgItems(rows, { mode, type: state.type, query: state.query, dates, auto });
  if (!items.length) {
    state.tail = [note(state.query.trim() ? "No matches." : mode === "recent" ? "No install dates." : "No packages.")];
    body.append(...state.tail);
    return;
  }
  // Cydia: A–Z headers and the index for User and Expert, day headers for Recent.
  state.list = browse.packageList(body, state.route, items, { letters: mode !== "recent" });
  state.tail = [state.list.el];
  body.append(state.list.el);
}

// F87: how many apps (not iFizBox itself) the jailbreak app remembers; 0 when the store can't be read.
async function jailbreakAppCount() {
  try { return (await (await apps()).all()).filter((r) => r?.id && !r.self).length; } catch { return 0; }
}

function appsRow(route, n) {
  return { label: "Apps", subtitle: n === 1 ? "1 app installed from an app page" : `${n} apps installed from an app page`,
    href: format({ tab: route.tab, path: [...route.path, APPS] }) };
}

// ---- F147: the Wish List bar button ---------------------------------------------------------------------------

const wishBar = { el: null }; // the root's button, while it is drawn

// Installed's root: the page whose left slot is free (every other Installed page has a back button there).
export const isRoot = (route) => route.path.length === 0;

// The button's label: `n` (wished, not installed) in brackets as Mail's "Inbox (3)", none at 0.
export const wishButtonLabel = (n) => (n > 0 ? `Wish List (${n})` : "Wish List");

// The Wish List page's route, under Installed's root whatever page asks.
export const wishRoute = (route) => ({ tab: route.tab, path: [WISH] });

// The nav bar spec for the button (app.js `left`): a tap opens the Wish List page; `ref` gets the drawn button.
export function wishButton(route, n, { go, ref } = {}) {
  const to = wishRoute(route);
  return { label: wishButtonLabel(n), ref,
    onClick: () => (go ? go(to) : (location.hash = format(to).replace(/^#/, ""))) };
}

// The installed package ids known so far (the count leaves them out): dpkg's rows, or the apps page's ids.
function knownInstalled() {
  return (state.rows ?? appView.installedIds ?? []).map((r) => (typeof r === "string" ? r : r.id));
}

// The name may end in "…" on a narrow phone (the segmented title takes the middle); the count never does.
function updateWishButton() {
  const b = wishBar.el;
  if (!b || (b.parentNode && !b.isConnected)) return; // not drawn, or drawn and since dropped
  const n = wishCount(browse.wishlist().list(), knownInstalled());
  const name = Object.assign(document.createElement("span"), { className: "wish-name", textContent: "Wish List" });
  const count = n > 0 ? [Object.assign(document.createElement("span"), { className: "wish-count", textContent: `(${n})` })] : [];
  b.replaceChildren(name, ...count);
  b.setAttribute("aria-label", wishButtonLabel(n));
}

// A file picker for the status file; the read stays in the browser.
function chooseStatus() {
  const input = Object.assign(document.createElement("input"), { type: "file" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await catalog.setStatus(await file.text());
    } catch (e) {
      await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    }
  });
  input.click();
}

// ---- F30: the apps recorded on this device -------------------------------------------------------------------

// The newest version of each app on any source, from the catalog (null where no source has it any more).
async function candidates(rows) {
  const out = new Map();
  await Promise.all(rows.map(async (r) => {
    const p = await catalog.package(r.id, ALL).catch(() => null);
    if (p?.key && p.stanza?.version) out.set(r.id, { version: p.stanza.version, key: p.key });
  }));
  return out;
}

export function appSubtitle(r, locale) {
  const date = r.date ? new Date(r.date).toLocaleDateString(locale, { dateStyle: "medium" }) : null;
  // F87: I4's note, where the phone's version isn't the one iFizBox remembered, comes first.
  return [r.note || null, r.upgrade ? `Upgrade to ${r.upgrade}` : null, r.sourceName || r.source, date].filter(Boolean).join(" · ");
}

// F87: the remembered apps for the list; an app the phone doesn't have (I4's `actual` null) offers no upgrade.
export function appListRows(records, candidateOf) {
  return appUpgrades(appRows(records), candidateOf).map((r) => (r.actual === null ? { ...r, upgrade: null } : r));
}

// F91: each row's signature ({ state, text, long } or none) from signing.installed, by bundle ID (installed or
// original), and the signed apps no row stands for, as rows of their own (`signedOnly`). -> { rows, extra }
// F134: `show` false (Show Expiry Dates off) leaves the days out; Expired still shows, since that app won't open.
export function withSignatures(rows, installed, { now = new Date(), window, show = true } = {}) {
  const shown = (sig) => (sig && (show || sig.state === "expired") ? sig : null);
  const index = signedIndex(installed);
  const used = new Set();
  const out = rows.map((r) => {
    const a = index.get(r.id);
    if (!a) return r;
    used.add(a.bundleId);
    const sig = shown(signatureState(a.expires, { now, window }));
    return sig ? { ...r, sig } : r;
  });
  const extra = [];
  for (const a of Array.isArray(installed?.apps) ? installed.apps : []) {
    if (!a?.bundleId || used.has(a.bundleId)) continue;
    used.add(a.bundleId);
    extra.push({ id: a.bundleId, name: a.name || a.bundleId, version: a.version || "", signedOnly: true,
      sig: shown(signatureState(a.expires, { now, window })) ?? undefined });
  }
  return { rows: out, extra };
}

// signing.installed in the sideload app; null anywhere else or when the call fails.
async function signedApps(native = globalThis.ifizboxNative) {
  if (detectMode() !== "sideload" || typeof native?.call !== "function") return null;
  try { return await native.call("signing.installed", {}); } catch { return null; }
}

async function loadApps() {
  const seq = ++appView.seq;
  let rows;
  try {
    rows = await rememberedApps(); // F87: the phone's versions and I4's notes in the jailbreak app
  } catch (e) {
    if (seq === appView.seq) appView.body.replaceChildren(note(e.message));
    return;
  }
  const site = detectMode() === "site";
  // F125: the Wish List count leaves out what dpkg has; the worker answers once the sources are in, so the list
  // doesn't wait on it (the row is drawn again when it does).
  const installedIds = catalog.installed().then((x) => (x ?? []).map((r) => r.id), () => []);
  const [hasStatus, signed] = await Promise.all([site ? catalog.hasStatus() : false, signedApps()]);
  if (seq !== appView.seq) return;
  if (!recordsApps()) rows = rows.filter((r) => !r?.self); // iFizBox's own row is dpkg's there
  appView.signed = signed; // F91
  drawApps(appListRows(rows, () => null), new Map(), site, hasStatus);
  const ids = await installedIds;
  if (seq !== appView.seq) return;
  if (ids.length) {
    appView.installedIds = ids;
    drawApps(appListRows(rows, () => null), new Map(), site, hasStatus);
  }
  // The upgrade badges wait on the sources; the list doesn't.
  if (!rows.length) return;
  let cands;
  try { cands = await candidates(rows); } catch { return; }
  if (seq !== appView.seq) return;
  drawApps(appListRows(rows, (id) => cands.get(id) ?? null), cands, site, hasStatus);
}

function drawApps(listRows, cands, site, hasStatus) {
  const body = appView.body;
  const route = appView.route;
  appView.last = { listRows, cands, site, hasStatus };
  body.classList.replace("grouped", "plain");
  // F87: no Install IPAs tile on the jailbreak app's Apps page (My IPAs is a sideload page). F127: the search bar under
  // it, on the root, once there are apps to search.
  const head = recordsApps() ? [myIpasTile(route, site)] : [];
  if (recordsApps() && listRows.length) head.push(...filterControls(appView, { onChange: drawAppList }));
  body.replaceChildren(...head);
  appView.tail = [];
  drawAppList();
}

// F127: the mode or the search changed: the list again, under the tile and the field (which keeps its focus).
function redrawApps() {
  if (appView.body && appView.last) drawAppList();
}

function drawAppList() {
  const body = appView.body;
  const route = appView.route;
  const { listRows, cands, site, hasStatus } = appView.last;
  for (const n of appView.tail ?? []) n.remove();
  // F91: the signature pill in place of the version (the version stays in the subtitle).
  const signed = appView.signed ? withSignatures(listRows, appView.signed, { window: resignWindow((k) => settings.get(k)), show: settings.get("showExpiry") }) : { rows: listRows, extra: [] };
  // F127: User (A–Z) or Recent (by day) on the root, narrowed by the search; the jailbreak app's Apps page as before.
  const appSecs = recordsApps() ? appSections(signed.rows, { mode: appView.mode, query: appView.query }) : [{ rows: signed.rows }];
  const extra = recordsApps() ? queryRows(signed.extra, appView.query) : signed.extra;
  const rows = appSecs.flatMap((sec) => sec.rows);
  const appRow = (r) => ({
    label: r.name, subtitle: r.sig && !r.upgrade && r.version ? [`Version ${r.version}`, appSubtitle(r)].filter(Boolean).join(" · ") : appSubtitle(r),
    detail: r.sig && !r.upgrade ? r.sig.text : r.upgrade || r.actual === null ? undefined : r.version,
    badge: r.upgrade ? "Upgrade" : undefined, icon: { text: r.name.charAt(0).toUpperCase() },
    // The app page, while a source still has the app.
    href: cands.has(r.id) ? format({ tab: route.tab, path: [...route.path, `package:${r.id}`] }) : null,
  });
  const sections = appSecs.map((sec) => ({ header: sec.header, rows: sec.rows.map(appRow) }));
  sections.push({ rows: extra.map((r) => ({ label: r.name, subtitle: [r.version ? `Version ${r.version}` : null, `Signed by ${NAME}`].filter(Boolean).join(" · "),
    detail: r.sig?.text, icon: { text: r.name.charAt(0).toUpperCase() } })) });
  if (site) {
    sections.push({ header: "Jailbroken iPhone", rows: [hasStatus
      ? { label: "dpkg Status File", subtitle: "Packages installed with apt", href: format({ tab: route.tab, path: [DPKG] }) }
      : { label: "Choose Status File", subtitle: "See the packages a jailbroken iPhone has", onClick: () => chooseStatus() }] });
  }
  updateWishButton(); // F147 (F125's Packages section with the Wish List row is gone)
  const ul = plain(sections);
  ul.classList.toggle("editing", appView.editing);
  const cells = ul.querySelectorAll(":scope > .cell");
  rows.forEach((r, i) => decorateApp(cells[i], r));
  [...rows, ...extra].forEach((r, i) => { if (r.sig && !r.upgrade) sigPill(cells[i], r.sig); });
  attachRowGestures(ul);
  appView.tail = [ul];
  if (!listRows.length) {
    appView.tail.unshift(note("No apps yet. Apps you install from an app's page are listed here, on this device.")); // under My IPAs
  } else if (!rows.length && !extra.length) {
    appView.tail.unshift(note("No matches."));
  }
  body.append(...appView.tail);
}

// F91: the row's detail drawn as the signature pill.
function sigPill(li, sig) {
  const d = li?.querySelector(".cell-detail");
  if (!d) return;
  d.classList.add("sig-pill");
  d.dataset.sig = sig.state;
  d.title = sig.long;
}

// F77: the row that opens My IPAs; F79: the page is Install IPAs (Browse, then My IPAs).
export function myIpasRow(route, site) {
  return { label: myipas.PAGE_TITLE, subtitle: site ? "Browse apps, or add links to IPAs" : "Browse apps, or sign your own IPAs",
    href: format({ tab: route.tab, path: [myipas.MYIPAS] }) };
}

// Install IPAs as a button above the list, Home's tile look (home.css), not a row like an installed app (user 2026-11-17).
function myIpasTile(route, site) {
  const r = myIpasRow(route, site);
  const row = document.createElement("div");
  row.className = "home-row installed-myipas";
  row.innerHTML = `<ul class="table grouped home-tiles"><li class="cell"><a class="cell-inner chevron home-tile">
    <span class="cell-icon home-glyph glyph-install"></span><span class="home-tile-text"><span class="cell-label"></span>
    <span class="cell-subtitle"></span></span></a></li></ul>`;
  row.querySelector("a").href = r.href;
  row.querySelector(".cell-label").textContent = r.label;
  row.querySelector(".cell-subtitle").textContent = r.subtitle;
  return row;
}

// Delete controls as on the Sources tab (sources.css styles .source-row: the red minus, Delete, the swipe).
function decorateApp(li, r) {
  li.classList.add("source-row", "installed-app");
  li.dataset.id = r.id;
  const src = mediaUrl(r.icon);
  if (src) {
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    li.querySelector(".cell-icon").append(img);
  }
  const toggle = Object.assign(document.createElement("button"), { type: "button", className: "del-toggle" });
  toggle.setAttribute("aria-label", "Delete " + r.name);
  toggle.addEventListener("click", () => arm(li, !li.classList.contains("armed")));
  const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm", textContent: "Delete" });
  confirm.addEventListener("click", () => removeApp(li, r));
  li.append(toggle, confirm);
}

function arm(li, on) {
  for (const other of li.parentNode.querySelectorAll(".installed-app.armed")) if (other !== li) other.classList.remove("armed");
  li.classList.toggle("armed", on);
}

// While editing, or while a row shows Delete, a tap on a row only puts the Delete away. A left swipe shows it.
function attachRowGestures(ul) {
  let start = null;
  let swiped = false;
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = ul.querySelector(".installed-app.armed");
    if (!(appView.editing && e.target.closest(".installed-app")) && !armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);
  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".installed-app");
    swiped = false;
    start = li && !appView.editing && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
  });
  ul.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    arm(start.li, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  ul.addEventListener("pointerup", stop);
  ul.addEventListener("pointercancel", stop);
}

function setEditing(on, button) {
  appView.editing = on;
  appView.body?.querySelector(":scope > .table")?.classList.toggle("editing", on); // the apps, not My IPAs' tile (inside .home-row)
  for (const li of appView.body?.querySelectorAll(".installed-app.armed") ?? []) li.classList.remove("armed");
  if (button) {
    button.textContent = on ? "Done" : "Edit";
    button.classList.toggle("done", on);
  }
}

// Forgets an app the user deleted from the phone: the row fades, then the list redraws (onAppsChange).
function removeApp(li, r) {
  li.classList.add("removing");
  setTimeout(async () => {
    try {
      await removeInstall(await apps(), r.id);
    } catch (e) {
      li.classList.remove("removing");
      await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    }
  }, 250);
}

// ---- F125: the Wish List page --------------------------------------------------------------------------------

const wishView = { body: null, route: null, list: null, seq: 0, editing: false };

// The wished packages the sources carry, as a plain package list; installed ones drop off the list for good (as
// browse.js renderWishlist, F102).
async function loadWish() {
  const seq = ++wishView.seq;
  let rows;
  try {
    await catalog.ensure();
    const installed = ((await catalog.installed().catch(() => null)) ?? []).map((r) => r.id);
    browse.wishlist().prune(installed);
    const ids = browse.wishlist().list();
    const found = await Promise.all(ids.map((id) => catalog.package(id).then((p) => (p && !p.installedOnly ? p.row : null), () => null)));
    rows = wishRows(ids, found, installed);
  } catch (e) {
    if (seq === wishView.seq) wishView.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== wishView.seq) return;
  drawWish(rows);
}

function drawWish(rows) {
  const body = wishView.body;
  browse.dropList(body, wishView.list);
  wishView.list = null;
  body.classList.replace("grouped", "plain");
  if (!rows.length) { body.replaceChildren(note(WISH_EMPTY)); return; }
  body.replaceChildren();
  const list = browse.packageList(body, wishView.route, rows, { letters: false, decorate: decorateWish });
  list.el.classList.add("wish-list");
  list.el.classList.toggle("editing", wishView.editing);
  attachWishGestures(list.el);
  wishView.list = list;
  body.append(list.el);
}

// The list's rows are pooled (vlist.js): the Delete controls go in once per row and act on whatever it shows now.
function decorateWish(row, item) {
  if (!row._wish) {
    row._wish = true;
    row.classList.add("source-row", "wish-row");
    const toggle = Object.assign(document.createElement("button"), { type: "button", className: "del-toggle" });
    toggle.addEventListener("click", (e) => { e.preventDefault(); armWish(row, !row.classList.contains("armed")); });
    const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm", textContent: "Delete" });
    confirm.addEventListener("click", (e) => { e.preventDefault(); removeWish(row, row._item.id); });
    row.append(toggle, confirm);
    row._wishToggle = toggle;
  }
  row.classList.remove("armed", "removing");
  row._wishToggle.setAttribute("aria-label", "Remove " + item.name);
}

function armWish(row, on) {
  for (const other of row.parentNode?.querySelectorAll(".wish-row.armed") ?? []) if (other !== row) other.classList.remove("armed");
  row.classList.toggle("armed", on);
}

// As the apps list's attachRowGestures: while editing, or while a row shows Delete, a tap only puts the Delete away;
// a left swipe shows it, a right one hides it.
function attachWishGestures(el) {
  let start = null;
  let swiped = false;
  el.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = el.querySelector(".wish-row.armed");
    if (!(wishView.editing && e.target.closest(".wish-row")) && !armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);
  el.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".wish-row");
    swiped = false;
    start = row && !wishView.editing && !e.target.closest(".del-confirm") ? { row, x: e.clientX, y: e.clientY } : null;
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    armWish(start.row, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
}

function setWishEditing(on, button) {
  wishView.editing = on;
  wishView.list?.el.classList.toggle("editing", on);
  for (const row of wishView.body?.querySelectorAll(".wish-row.armed") ?? []) row.classList.remove("armed");
  if (button) {
    button.textContent = on ? "Done" : "Edit";
    button.classList.toggle("done", on);
  }
}

// The row fades, then leaves the list; the page redraws from the list's change (init).
function removeWish(row, id) {
  row.classList.add("removing");
  setTimeout(() => browse.wishlist().set(id, false), 250);
}
