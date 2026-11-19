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
//
// F222: Manage, bulk actions on the apps list without a jailbreak (the sideload app, the site). The root's nav bar is
// Wish List | User/Recent | Manage (Add and the Install IPAs tile left: Install IPAs is Home's tile, linked from the
// list's footer and empty state). Manage: Select… | User/Recent (sorting and headers keep working) | Done; each row
// gets UIKit's multi-select circle (UIRemoveControlMulti*: a faint ring, red with a white tick when picked, the row
// pale blue), a grey line above the list counts what is picked and what there is, and a bottom toolbar in the nav
// bar's colours (myipas.css .myipa-toolbar) has Re-sign (n), Update (n) and Delete (n). Select… opens a sheet of
// presets (core/installed.js selectSheet); with every row picked it reads Deselect. Each toolbar action confirms with
// a sheet, then runs its jobs through the app queue (screens/queue.js runAppQueue) on the progress page, labelled
// "Re-signing Delta (1 of 3)" with the run's progress on its bar; the list (and its pills) loads again at the end.
// Signed apps the list doesn't remember that came from the user's own IPAs say "From My IPAs" (the signature
// record's url is library:..., native MyIPAs.fileOf) and re-sign from that file (signing.resign does).
import * as browse from "./browse.js";
import * as myipas from "./myipas.js";
import { grouped, plain, placeholder, segments, barButton } from "../nav/ui.js";
import { format, mounted, parse } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { showAlert } from "../nav/alert.js";
import { detectMode } from "../core/settings.js";
import { apps, appRows, appUpgrades, removeInstall, onAppsChange, MODES, MODE_LABEL, TYPES, modeRows, typeRows, queryRows,
  dayHeaders, dayLabel, markedRows, manageKinds, manageable, presetIds, selectSheet, selectLabel, manageCounts, manageSummary,
  manageToolbar, pruneSelection, SELECT } from "../core/installed.js";
import { mediaUrl } from "./depiction.js";
import { rememberedApps } from "../app-updates.js";
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { settings } from "./settings.js";
import { wishRows, wishCount, WISH_EMPTY } from "../core/wishlist.js";
import { compareNames, indexLetter } from "../core/catalog.js";
import { NAME } from "../brand.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { longPress } from "../nav/menu.js";
import { libraryCall } from "../signing-client.js";
import { resignJob, appJob, markedResignJob, markedVersionOnSource } from "../core/appqueue.js";
import { hudLine } from "../core/progress.js";
import { deviceError } from "../core/signing.js";
import { getBackend } from "../backend.js";
import { liveHUD } from "../nav/hud.js";
import { onPageOpen } from "../nav/pagestate.js";

// B46: Delete means what it says (user 2026-11-18: "I swiped and deleted an app in Installed and it just got rid of the
// icon, I had to remove it again"). In the jailbreak app, an app the helper sees in installd's containers (`actual`, I4)
// is uninstalled (ifizbox-helper uninstall-app, backend-native.js uninstallApp) behind a HUD, then its record goes.
// Where iFizBox can't uninstall (the sideload app, the site, a record of an app that is gone) the button is Remove from
// List, and the sheet says in one line that deleting the app itself is done from the Home Screen. In the sideload app
// a row the shell reports installed (signing.isInstalled) isn't hidden: iOS's word wins over the record. Every one is
// confirmed by an iOS 6 action sheet first (deleteAction, confirmDelete).

// B36: every row on the apps list opens a page (the source's package page, else an installed-app page for the record,
// #installed/app:<id>), a hold opens an action sheet (Open, Re-sign, Save Signed IPA, Remove: what applies) and a left
// swipe shows Delete on every row but iFizBox's own: Delete on a signed app the list doesn't remember (F91's extra
// rows) forgets it as Settings > Signed Apps does (signing.forget), on a remembered one removeInstall as before.

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
const appView = { body: null, route: null, seq: 0, editing: false, right: null, mode: "user", query: "", tail: [], last: null,
  managing: false, selected: new Set(), manageRows: [] }; // F222

// Records apps (F30) rather than reading dpkg: everywhere but the jailbreak app.
export const recordsApps = (mode = detectMode()) => mode !== "jailbreak";

// Which page a route is: "apps" (F30's list), "dpkg" (the status file's packages), "myipas" (F77) or a browse.js page.
export function pageKind(route, mode = detectMode()) {
  if (route.path.length === 1 && route.path[0] === WISH) return "wishlist"; // F125, in every mode
  if (isAppPage(route, mode)) return "app"; // B36
  if (route.path[0] === myipas.MYIPAS) return "myipas"; // F209: ifizbox://myipas in the jailbreak app too
  if (!recordsApps(mode)) return !route.path.length ? "dpkg" : route.path.length === 1 && route.path[0] === APPS ? "apps" : "browse";
  if (!route.path.length) return "apps";
  return route.path.length === 1 && route.path[0] === DPKG && mode === "site" ? "dpkg" : "browse";
}

// B43: a page pushed onto the stack opens on its defaults (nav/pagestate.js): the apps page on User with an empty
// field and out of Edit (jailbreak: pushed from Installed), the dpkg page on User / All (the site: pushed from
// Installed), the Wish List out of Edit. A tab root is built once, so Installed's own root keeps its choice; Back
// rebuilds nothing, so a page below keeps what it showed.
onPageOpen((r) => r.tab === "installed" && pageKind(r) === "apps", () => Object.assign(appView, { mode: "user", query: "", editing: false,
  managing: false, selected: new Set() }));
onPageOpen((r) => r.tab === "installed" && pageKind(r) === "dpkg", () => Object.assign(state, { mode: "user", type: "All", query: "" }));
onPageOpen((r) => r.tab === "installed" && pageKind(r) === "wishlist", () => { wishView.editing = false; });
// The live state objects, for tests.
export const pageStates = () => ({ apps: appView, dpkg: state, wish: wishView });

export function init() {
  catalog.onChange(() => {
    if (state.body) load();
    if (appView.body) loadApps();
  });
  onAppsChange(() => {
    if (appView.body) loadApps();
    refreshAppCount(); // B52: the root's Apps count, under the Apps page
  });
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
  // F222: while managing, the same button is Select… (or Deselect).
  if (isRoot(route) && pageKind(route) === "apps") {
    const open = info.left.onClick;
    info.left.onClick = () => (appView.managing ? onSelectButton() : open());
  }
  return info;
}

function navInfo(route) {
  const kind = pageKind(route);
  if (kind === "browse") return browse.nav(route);
  if (kind === "myipas") return myipas.nav(route);
  if (kind === "app") return { title: appNames.get(appIdOf(route.path.at(-1))) || appIdOf(route.path.at(-1)) };
  if (kind === "wishlist") {
    return { title: "Wish List", style: "plain",
      right: { label: wishView.editing ? "Done" : "Edit", onClick: (e) => setWishEditing(!wishView.editing, e.currentTarget) } };
  }
  if (kind === "apps") {
    return { title: recordsApps() ? "Installed" : "Apps", style: "plain", // F87: "Apps" one row down in the jailbreak app
      // F127: User | Recent on the apps list's root (the jailbreak app's Apps page stays newest first).
      titleView: recordsApps() ? modeControl(APP_MODES, appView.mode, pickMode) : undefined,
      // F222: Manage (bulk Re-sign, Update, Delete), not Edit or F208's Add: a row still deletes with a swipe.
      right: recordsApps() ? { label: appView.managing ? "Done" : "Manage", onClick: () => setManaging(!appView.managing),
        ref: (b) => { manageBar.right = b; b.classList.add("manage-button"); b.classList.toggle("done", appView.managing); } }
        : { label: appView.editing ? "Done" : "Edit", onClick: (e) => setEditing(!appView.editing, e.currentTarget) } };
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
  if (kind === "app") {
    renderAppPage(body, route, ctx);
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
  return { label: "Apps", subtitle: appsRowSubtitle(n), href: format({ tab: route.tab, path: [...route.path, APPS] }) };
}

export function appsRowSubtitle(n) {
  return n === 1 ? "1 app installed from an app page" : `${n} apps installed from an app page`;
}

// B52: the root stays in the page stack under the Apps page, so a Delete or Remove there (onAppsChange) counts the
// apps again for the root's Apps cell: its subtitle in place while the cell stays, the whole page when the cell
// comes or goes (vlist.js measures where the list starts). Nothing until load() has drawn the root.
export async function refreshAppCount({ view = state, mode = detectMode(), count = jailbreakAppCount, redraw = draw } = {}) {
  if (recordsApps(mode) || !view.body || view.rows === undefined) return;
  const seq = view.seq;
  const n = await count();
  if (seq !== view.seq || n === (view.appCount ?? 0)) return; // load() is reading it afresh, or nothing changed
  const had = view.appCount ?? 0;
  view.appCount = n;
  const sub = had && n ? view.body.querySelector(".installed-top")?.querySelector(".cell-subtitle") : null;
  if (sub) sub.textContent = appsRowSubtitle(n);
  else redraw();
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
  if (appView.managing && recordsApps()) { // F222: Select… / Deselect while managing
    const label = selectLabel(appView.manageRows, appView.selected);
    b.replaceChildren(label);
    b.setAttribute("aria-label", label === SELECT ? "Select" : label);
    return;
  }
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
    if (p?.key && p.stanza?.version) out.set(r.id, { version: p.stanza.version, key: p.key, pkg: p }); // F222: pkg for Manage's jobs
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
// F221: `marked` (the sideload app's list): a row iFizBox holds no signature for was marked as installed, so its pill
// is a grey "?" (no expiry known) and the row says so (`marked: true`); not for iFizBox's own row or one iOS lacks.
export const MARKED_SIG = { state: "unknown", text: "?", long: "Marked as installed: no expiry known" };
export function withSignatures(rows, installed, { now = new Date(), window, show = true, marked = false } = {}) {
  const shown = (sig) => (sig && (show || sig.state === "expired") ? sig : null);
  const index = signedIndex(installed);
  const used = new Set();
  const out = rows.map((r) => {
    const a = index.get(r.id);
    if (!a) return marked && show && !r.self && r.actual !== null ? { ...r, sig: MARKED_SIG, marked: true } : r;
    used.add(a.bundleId);
    const sig = shown(signatureState(a.expires, { now, window }));
    return sig ? { ...r, sig } : r;
  });
  const extra = [];
  for (const a of Array.isArray(installed?.apps) ? installed.apps : []) {
    if (!a?.bundleId || used.has(a.bundleId)) continue;
    used.add(a.bundleId);
    extra.push({ id: a.bundleId, name: a.name || a.bundleId, version: a.version || "", signedOnly: true,
      sig: shown(signatureState(a.expires, { now, window })) ?? undefined, ...(fromMyIpas(a) ? { fromMyIpas: true } : {}) });
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
    rows = await withInstalled(rows); // B46: in the sideload app, whether iOS still has each one
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
  appView.last = { listRows, cands, site, hasStatus };
  body.classList.replace("grouped", "plain");
  // F127: the search bar on the root, once there are apps to search. F222: the Install IPAs tile above it is gone
  // (Home's tile, linked from the list's footer).
  const head = [];
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
  const signed = appView.signed ? withSignatures(listRows, appView.signed, { window: resignWindow((k) => settings.get(k)), show: settings.get("showExpiry"), marked: true }) : { rows: listRows, extra: [] };
  // F127: User (A–Z) or Recent (by day) on the root, narrowed by the search; the jailbreak app's Apps page as before.
  const appSecs = recordsApps() ? appSections(signed.rows, { mode: appView.mode, query: appView.query }) : [{ rows: signed.rows }];
  const extra = recordsApps() ? queryRows(signed.extra, appView.query) : signed.extra;
  const rows = appSecs.flatMap((sec) => sec.rows);
  const more = site ? [{ header: "Jailbroken iPhone", rows: [hasStatus
    ? { label: "dpkg Status File", subtitle: "Packages installed with apt", href: format({ tab: route.tab, path: [DPKG] }) }
    : { label: "Choose Status File", subtitle: "See the packages a jailbroken iPhone has", onClick: () => chooseStatus() }] }] : [];
  updateWishButton(); // F147 (F125's Packages section with the Wish List row is gone)
  // F222: the rows Manage picks from (the whole list, not only the search's), each with its signature record and,
  // for a marked app, whether its installed version is on its source.
  const index = signedIndex(appView.signed);
  if (recordsApps()) {
    appView.manageRows = [...signed.rows, ...signed.extra].map((r) => withManage(withSigned(r, index), cands));
    appView.selected = pruneSelection(appView.selected, appView.manageRows);
  }
  const ul = appListElement(appSecs, extra, { route, cands, signed: appView.signed, more, manage: recordsApps() });
  appView.tail = [ul];
  if (!listRows.length) {
    appView.tail.unshift(installIpasNote(route, "No apps yet. Apps you install from an app's page or from ", ", on this device, are listed here.", "empty"));
  } else if (!rows.length && !extra.length) {
    appView.tail.unshift(note("No matches."));
  }
  if (recordsApps() && listRows.length) appView.tail.push(installIpasNote(route, "Sign and install your own apps from ", ".", "installed-footer"));
  if (recordsApps() && appView.managing) appView.tail.unshift(manageSummaryLine());
  body.append(...appView.tail);
  syncManage();
}

// The apps list's table: the sections' rows, F91's extra rows, then `more` (the site's dpkg row). B36: every app row
// is a link (the package page or the installed-app page, so it highlights on press), carries its signing.installed
// record, swipes to Delete (not iFizBox's own) and holds for the sheet (`hold`: attachRowHold's options).
// F222: `manage` (the root without a jailbreak) gives each row Manage can pick its select circle.
export function appListElement(appSecs, extra, { route, cands = new Map(), signed = null, more = [], editing = appView.editing, hold = {},
  manage = false, managing = appView.managing, selected = appView.selected } = {}) {
  const rows = appSecs.flatMap((sec) => sec.rows);
  const appRow = (r) => ({
    label: r.name, subtitle: r.marked && !r.upgrade ? markedSubtitle(r)
      : r.sig && !r.upgrade && r.version ? [`Version ${r.version}`, appSubtitle(r)].filter(Boolean).join(" · ") : appSubtitle(r),
    detail: r.sig && !r.upgrade ? r.sig.text : r.upgrade || r.actual === null ? undefined : r.version,
    badge: r.upgrade ? "Upgrade" : undefined, icon: { text: r.name.charAt(0).toUpperCase() },
    href: appRowHref(r, cands, route),
  });
  const sections = appSecs.map((sec) => ({ header: sec.header, rows: sec.rows.map(appRow) }));
  sections.push({ rows: extra.map(extraRow(route)) }, ...more);
  const ul = plain(sections);
  ul.classList.toggle("editing", editing);
  ul.classList.toggle("managing", manage && managing);
  const cells = ul.querySelectorAll(":scope > .cell");
  const index = signedIndex(signed);
  [...rows, ...extra].forEach((r, i) => decorateApp(cells[i], withSigned(r, index)));
  [...rows, ...extra].forEach((r, i) => { if (r.sig && !r.upgrade) sigPill(cells[i], r.sig); });
  if (manage) [...rows, ...extra].forEach((r, i) => { if (manageKinds(r)) selectCircle(cells[i], selected.has(r.id)); });
  attachRowGestures(ul);
  attachRowHold(ul, hold);
  return ul;
}

// F221: a marked app's subtitle: "Version x · Marked as installed".
export function markedSubtitle(r) {
  return [r.version ? `Version ${r.version}` : null, "Marked as installed"].filter(Boolean).join(" · ");
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
  li._app = r; // B36: what a hold or Delete acts on
  appNames.set(r.id, r.name);
  if (!canDelete(r)) { li.dataset.self = "1"; return; } // iFizBox's own row: no Delete
  const toggle = Object.assign(document.createElement("button"), { type: "button", className: "del-toggle" });
  toggle.setAttribute("aria-label", "Delete " + r.name);
  toggle.addEventListener("click", () => arm(li, !li.classList.contains("armed")));
  const confirm = Object.assign(document.createElement("button"), { type: "button", className: "del-confirm",
    textContent: deleteAction(r)?.label ?? DELETE }); // B46: Delete only where it uninstalls
  confirm.addEventListener("click", () => confirmDelete(r, { li }));
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
    if (appView.managing && ul.classList.contains("managing")) { // F222: a tap picks the row
      const li = e.target.closest(".installed-app");
      if (!li) return;
      e.preventDefault();
      e.stopPropagation();
      if (li.classList.contains("manage-row")) togglePick(li._app?.id);
      return;
    }
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
    start = li && !li.dataset.self && !appView.editing && !appView.managing && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
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
      await forgetApp(r);
    } catch (e) {
      li.classList.remove("removing");
      await showAlert({ title: "Error", message: r.signedOnly ? deviceError(e).message : e.message, buttons: ["OK"] });
    }
  }, 250);
}

// ---- B36: every row opens, holds and swipes ---------------------------------------------------------------------

const appNames = new Map(); // id -> name, for the installed-app page's title before it loads

// The installed-app page's path segment for an app id, and back.
export const appToken = (id) => `app:${id}`;
export const appIdOf = (seg) => (typeof seg === "string" && seg.startsWith("app:") && seg.length > 4 ? seg.slice(4) : null);

// The page is under the apps list: Installed's root without a jailbreak, the Apps page (#installed/apps) in the app.
export function isAppPage(route, mode = detectMode()) {
  const p = route.path;
  if (appIdOf(p.at(-1)) == null) return false;
  return recordsApps(mode) ? p.length === 1 : p.length === 2 && p[0] === APPS;
}

// Where a row goes: the source's package page when a source still lists the app, else its installed-app page.
export function appRowHref(r, cands, route) {
  const seg = cands?.has?.(r.id) ? `package:${r.id}` : appToken(r.id);
  return format({ tab: route.tab, path: [...route.path, seg] });
}

// F91's extra row (a signed app the list doesn't remember), now with its page.
export function extraRow(route) {
  return (r) => ({ label: r.name, subtitle: [r.version ? `Version ${r.version}` : null, r.fromMyIpas ? "From My IPAs" : `Signed by ${NAME}`].filter(Boolean).join(" · "),
    detail: r.sig?.text, icon: { text: r.name.charAt(0).toUpperCase() }, href: appRowHref(r, null, route) });
}

// The row with its signing.installed record (`signed`, null when iFizBox didn't sign it), by bundle ID.
export const withSigned = (r, index) => ({ ...r, signed: index?.get?.(r.id) ?? null });

// iFizBox's own row is never removed (it is the app showing the list).
export const canDelete = (r) => !r?.self;

export const OPEN = "Open", RESIGN = "Re-sign", SAVE_IPA = "Save Signed IPA", REMOVE = "Remove from List", DELETE = "Delete";

// ---- B46: Delete uninstalls where it can, Remove from List where it can't ------------------------------------------

export const HOME_SCREEN = "Deleting the app itself is done from the Home Screen.";

// What a row's Delete is in this mode, or null (iFizBox's own row):
//   { kind: "uninstall" | "forget" | "installed", label (the swipe's and the hold sheet's button), button (the confirm
//     sheet's red button), note (the confirm sheet's one line, or null) }
// "uninstall": the jailbreak app and the helper sees the app installed (`actual`, I4). "installed": the sideload app's
// shell says iOS still has it (`installed` true, signing.isInstalled), so Remove from List only explains. "forget":
// everything else drops iFizBox's record, saying the app itself is deleted from the Home Screen (or that it's gone).
export function deleteAction(r, { mode = detectMode() } = {}) {
  if (!canDelete(r)) return null;
  if (mode === "jailbreak" && typeof r.actual === "string" && r.actual && !r.signedOnly) {
    return { kind: "uninstall", label: DELETE, button: `Delete ${r.name}`, note: null };
  }
  if (mode === "jailbreak" && r.actual === null) {
    return { kind: "forget", label: REMOVE, button: REMOVE, note: `${r.name} is no longer on your iPhone.` };
  }
  if (mode === "sideload" && r.installed === true && !r.signedOnly) {
    return { kind: "installed", label: REMOVE, button: null, note: `${r.name} is still on your iPhone. ${HOME_SCREEN}` };
  }
  return { kind: "forget", label: REMOVE, button: REMOVE, note: r.signedOnly ? `Forgets the signature record. ${HOME_SCREEN}` : HOME_SCREEN };
}

// The sideload app's rows with `installed` from the shell (signing.isInstalled): true, false or left out where it
// can't say. Anywhere else, or when the call fails, the rows as they were.
export async function withInstalled(rows, { mode = detectMode(), native = globalThis.ifizboxNative } = {}) {
  if (mode !== "sideload" || typeof native?.call !== "function" || !rows?.length) return rows;
  const ids = rows.filter((r) => r?.id && !r.self).map((r) => r.id);
  if (!ids.length) return rows;
  let res;
  try { res = await native.call("signing.isInstalled", { bundleIds: ids }); } catch { return rows; }
  const map = res?.installed && typeof res.installed === "object" ? res.installed : {};
  return rows.map((r) => (typeof map[r?.id] === "boolean" ? { ...r, installed: map[r.id] } : r));
}

// "pmstatus:<id>:<percent>:<text>" (the helper's progress) -> its text, or null for any other line.
export function statusText(line) {
  const m = /^pmstatus:[^:]*:[\d.]+:(.+)$/.exec(String(line ?? "").trim());
  return m ? m[1] : null;
}

// The swipe's or the sheet's Delete: the iOS 6 action sheet ('Delete <App>' red, Cancel; Remove from List with its
// one line), then the action. "installed" only explains (an alert). -> true when it went ahead.
export async function confirmDelete(r, { mode = detectMode(), sheet = showActionSheet, alert = showAlert, run = runDelete, li = null, after = null } = {}) {
  const a = deleteAction(r, { mode });
  if (!a) return false;
  if (a.kind === "installed") {
    li?.classList.remove("armed");
    await alert({ title: "Still Installed", message: a.note, buttons: ["OK"] });
    return false;
  }
  const i = await sheet({ title: a.note ?? "", buttons: [a.button], destructive: 0 });
  if (i !== 0) { li?.classList.remove("armed"); return false; }
  await run(a, r, { li, after });
  return true;
}

// Uninstalls through the helper behind a HUD (its pmstatus text as the label), then drops the record; or forgets.
async function runDelete(a, r, { li = null, after = null } = {}) {
  if (a.kind !== "uninstall") {
    if (li) { removeApp(li, r); return; }
    try { await forgetApp(r); after?.(); } catch (e) { await showAlert({ title: "Error", message: deviceError(e).message, buttons: ["OK"] }); }
    return;
  }
  const hud = liveHUD(`Deleting ${r.name}`);
  try {
    const backend = getBackend();
    if (typeof backend?.uninstallApp !== "function") throw new Error("This build can't delete apps.");
    await backend.uninstallApp(r.id, (ev) => { const t = statusText(ev?.line); if (t) hud.set(t); });
  } catch (e) {
    hud.hide();
    li?.classList.remove("armed");
    await showAlert({ title: `Couldn't Delete ${r.name}`, message: e?.message || String(e), buttons: ["OK"] });
    return;
  }
  hud.done("Deleted");
  li?.classList.add("removing");
  try { await removeInstall(await apps(), r.id); } catch { /* the app is gone; the record goes next time */ }
  if (appView.body) loadApps();
  after?.();
}

// The hold sheet's buttons for a row, in order. Open and Re-sign need the sideload app (signing.openApp,
// signing.resign); Re-sign only for an app iFizBox signed; Save Signed IPA when My IPAs keeps a signed copy (`ipa`).
export function appActions(r, { mode = detectMode(), ipa = null } = {}) {
  const out = [];
  if (mode === "sideload" && !r.self && r.actual !== null) out.push(OPEN);
  if (mode === "sideload" && r.signed) out.push(RESIGN);
  if (ipa) out.push(SAVE_IPA);
  const del = deleteAction(r, { mode }); // B46: Delete where it uninstalls, else Remove from List
  if (del) out.push(del.label);
  return out;
}

const isDelete = (label) => label === REMOVE || label === DELETE;

// My IPAs' entry with a signed copy of this app (by bundle ID, as signed or as in the IPA), or null.
export function keptIpaOf(r, entries) {
  const ids = new Set([r.id, r.signed?.bundleId, r.signed?.originalBundleId].filter(Boolean));
  return (entries ?? []).find((e) => e?.file && e.signed && (ids.has(e.signed.bundleId) || ids.has(e.bundleId))) ?? null;
}

async function keptIpa(r) {
  if (detectMode() !== "sideload" || typeof globalThis.ifizboxNative?.call !== "function") return null;
  try { return keptIpaOf(r, (await libraryCall("list", {}))?.ipas); } catch { return null; }
}

// Forgets the row's app: a signed app the list doesn't remember through signing.forget (it stays installed, as on
// Settings > Signed Apps; the list draws again), a remembered one through removeInstall (onAppsChange redraws).
export async function forgetApp(r, native = globalThis.ifizboxNative, remove = async (id) => removeInstall(await apps(), id)) {
  if (r.signedOnly) {
    await native.call("signing.forget", { bundleId: r.id });
    if (appView.body) loadApps();
    return;
  }
  // A remembered app iFizBox also signed: forget the signature too, or it comes back as a signedOnly row (user
  // 2026-11-18: 'they need to be removed twice').
  if (r.signed && typeof native?.call === "function") await native.call("signing.forget", { bundleId: r.signed.bundleId ?? r.id });
  await remove(r.id);
}

// What a sheet button does. `li`: the row, when the sheet came from the list (Remove fades it out).
async function runAppAction(label, r, { ipa = null, li = null, after = null } = {}) {
  const native = globalThis.ifizboxNative;
  try {
    if (label === OPEN) {
      const res = await native.call("signing.openApp", { bundleId: r.signed?.bundleId ?? r.id });
      if (!res?.opened) await showAlert({ title: "Couldn't Open", message: `iOS didn't open ${r.name}.`, buttons: ["OK"] });
    } else if (label === RESIGN) {
      const job = resignJob(r.signed);
      if (job) (await import("./queue.js")).queueApp(job);
    } else if (label === SAVE_IPA) {
      await libraryCall("export", { file: ipa.file });
    } else if (isDelete(label)) {
      await confirmDelete(r, { li, after }); // B46: confirmed by its own sheet, then uninstalled or forgotten
    }
  } catch (e) {
    await showAlert({ title: "Error", message: deviceError(e).message, buttons: ["OK"] });
  }
}

// The hold's action sheet for a row -> the button chosen, or null (Cancel, or nothing applies).
export async function appSheet(r, { mode = detectMode(), sheet = showActionSheet, findIpa = keptIpa, act = runAppAction, li = null, after = null } = {}) {
  const ipa = mode === "sideload" ? await findIpa(r) : null;
  const buttons = appActions(r, { mode, ipa });
  if (!buttons.length) return null;
  const i = await sheet({ title: r.name, buttons, destructive: buttons.findIndex(isDelete) });
  if (!(i >= 0)) return null;
  await act(buttons[i], r, { ipa, li, after });
  return buttons[i];
}

// A hold on a row (500 ms, nav/menu.js longPress) opens its sheet; not while editing or while it shows Delete.
export function attachRowHold(ul, opts = {}) {
  longPress(ul, ".installed-app", (li) => {
    if (appView.editing || appView.managing || li.classList.contains("armed") || !li._app) return;
    li.querySelector(".cell-inner")?.classList.remove("is-pressed");
    appSheet(li._app, { li, ...opts });
  });
}

// The installed-app page (#installed/app:<id>): what iFizBox knows of an app no source lists any more, or one it
// signed but doesn't remember: version (browse.js installedAppSection, with I4's note in the jailbreak app), bundle ID,
// source, install date and the signature's days left; then the sheet's actions as rows.
async function renderAppPage(body, route, ctx) {
  const id = appIdOf(route.path.at(-1));
  body.append(placeholder("page"));
  let rec = null;
  let signed = null;
  try {
    const [records, installed] = await Promise.all([rememberedApps().catch(() => []), signedApps()]);
    signed = signedIndex(installed).get(id) ?? null;
    rec = (records ?? []).find((x) => x?.id === id) ?? null;
    if (rec) [rec] = await withInstalled([rec]); // B46
  } catch { /* drawn from what there is */ }
  const r = rec ? { ...rec, signed } : signed ? { id, name: signed.name || id, version: signed.version || "", signedOnly: true, signed } : null;
  if (!r) { body.replaceChildren(note("This app isn't installed.")); return; }
  appNames.set(id, r.name);
  const ipa = detectMode() === "sideload" ? await keptIpa(r) : null;
  const back = () => (ctx?.back ? ctx.back() : history.back());
  body.replaceChildren(grouped(appPageSections(r, { ipa, onAction: (label) => runAppAction(label, r, { ipa, after: back }) })));
}

// The page's sections for a row `r` (with `signed`), testable without a page.
export function appPageSections(r, { ipa = null, mode = detectMode(), now = new Date(), window, onAction = () => {} } = {}) {
  const sec = browse.installedAppSection(r);
  const rows = [...sec.rows, { label: "Bundle ID", detail: r.signed?.bundleId || r.id }];
  if (r.signed?.bundleId && r.signed.bundleId !== r.id) rows.push({ label: "Original ID", detail: r.id });
  if (r.sourceName || r.source) rows.push({ label: "Source", detail: r.sourceName || r.source });
  if (r.date) rows.push({ label: "Installed", detail: new Date(r.date).toLocaleDateString(undefined, { dateStyle: "medium" }) });
  if (r.signed) {
    const sig = signatureState(r.signed.expires, { now, window: window ?? resignWindow((k) => settings.get(k)) });
    rows.push({ label: "Signature", detail: sig?.long || "Signed by " + NAME });
  }
  const out = [{ header: sec.header, rows, footer: sec.footer || (r.signedOnly ? `Signed by ${NAME}. No source lists it.` : null) }];
  const acts = appActions(r, { mode, ipa });
  const main = acts.filter((a) => !isDelete(a));
  if (main.length) out.push({ rows: main.map((label) => ({ label, onClick: () => onAction(label) })) });
  const del = acts.find(isDelete);
  if (del) {
    const a = deleteAction(r, { mode });
    out.push({ rows: [{ label: del, onClick: () => onAction(del) }],
      footer: a.kind === "uninstall" ? `Deletes ${r.name} and its data from your iPhone.` : a.note });
  }
  return out;
}

// ---- F222: Manage: pick apps, then Re-sign, Update or Delete them together ----------------------------------------

const manageBar = { right: null, toolbar: null, summary: null };

// A signature record made from the user's own IPA: native MyIPAs.fileOf's library:<file> url (signing.resign signs
// such an app again from that file, not a download).
export const fromMyIpas = (rec) => typeof rec?.url === "string" && rec.url.startsWith("library:");

// A list row with what Manage needs: `pkg` (the catalog package, for Update and a marked app's re-sign) and, for an app
// iFizBox holds no signature for, `onSource`: its installed version is still on its source (F221).
export function withManage(r, cands) {
  const pkg = cands?.get?.(r.id)?.pkg ?? null;
  const onSource = !r.signed && !r.signedOnly && Boolean(markedVersionOnSource(pkg, r.version));
  return { ...r, pkg, onSource };
}

// The row's select circle (packages.css .manage-check), slid in with the row's content while managing.
function selectCircle(li, on) {
  if (!li) return;
  li.classList.add("manage-row");
  li.classList.toggle("picked", on && appView.managing);
  const c = Object.assign(document.createElement("span"), { className: "manage-check" });
  c.setAttribute("aria-hidden", "true");
  li.append(c);
}

// User | Recent's pick: the list again under the same mode, managing or not.
export function pickMode(m) {
  appView.mode = m;
  redrawApps();
}

// Manage on or off: Done (blue) or Manage on the right, Select… or Wish List on the left, the circles slide in or out,
// the grey line and the toolbar come or go. Off drops the selection.
export function setManaging(on) {
  if (!recordsApps()) return;
  appView.managing = Boolean(on);
  if (!on) appView.selected = new Set();
  if (typeof document === "undefined") return;
  for (const li of appView.body?.querySelectorAll(".installed-app.armed") ?? []) li.classList.remove("armed");
  const b = manageBar.right;
  if (b?.isConnected) { b.textContent = on ? "Done" : "Manage"; b.classList.toggle("done", Boolean(on)); }
  const ul = appView.body?.querySelector(":scope > .table");
  ul?.classList.toggle("managing", Boolean(on));
  if (on && ul && !manageBar.summary?.isConnected) {
    const line = manageSummaryLine();
    ul.before(line);
    appView.tail.unshift(line);
  }
  if (!on) manageBar.summary?.remove();
  syncManage();
}

export function togglePick(id, view = appView) {
  if (!id || !view.managing) return;
  const next = new Set(view.selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  view.selected = next;
  if (view === appView) syncManage();
}

// Select…'s sheet (All Apps, Expiring Soon (n), Not Signed Here (n), With Updates (n), Cancel) picks a preset's apps in
// place of the selection; with every row picked the button is Deselect, which drops it. -> the preset, or null.
export async function selectButton({ view = appView, sheet = showActionSheet, sync = syncManage } = {}) {
  if (selectLabel(view.manageRows, view.selected) !== SELECT) {
    view.selected = new Set();
    sync();
    return "none";
  }
  const opts = selectSheet(view.manageRows);
  const i = await sheet({ buttons: opts.map((o) => o.label) });
  if (!(i >= 0)) return null;
  view.selected = new Set(presetIds(view.manageRows, opts[i].preset));
  sync();
  return opts[i].preset;
}
const onSelectButton = () => selectButton();

function manageSummaryLine() {
  const p = Object.assign(document.createElement("p"), { className: "manage-summary" });
  p.textContent = manageSummary(appView.manageRows, appView.selected);
  manageBar.summary = p;
  return p;
}

// "<before>Install IPAs<after>" with a link to Install IPAs (Home's tile): the list's empty state and its footer.
function installIpasNote(route, before, after, cls) {
  const p = Object.assign(document.createElement("p"), { className: cls });
  const a = Object.assign(document.createElement("a"), { textContent: myipas.PAGE_TITLE, href: myIpasRow(route, detectMode() === "site").href });
  p.append(before, a, after);
  return p;
}

// Whether Installed's root is the page on screen (the toolbar shows only over it).
function rootShown() {
  if (!appView.body?.isConnected || typeof location === "undefined") return false;
  const r = mounted(parse(location.hash));
  return r.tab === "installed" && isRoot(r) && pageKind(r) === "apps";
}

// The picked circles, the grey line, Select…/Deselect and the toolbar's counts, from appView.
function syncManage() {
  if (typeof document === "undefined") return;
  for (const li of appView.body?.querySelectorAll(".manage-row") ?? []) {
    const picked = appView.managing && appView.selected.has(li._app?.id);
    li.classList.toggle("picked", picked);
    li.querySelector(".cell-inner")?.setAttribute("aria-selected", String(picked));
  }
  if (manageBar.summary) manageBar.summary.textContent = manageSummary(appView.manageRows, appView.selected);
  updateWishButton();
  const show = appView.managing && recordsApps() && rootShown();
  if (!show && !manageBar.toolbar) return;
  const t = manageToolbarEl();
  if (show) {
    const specs = manageToolbar(manageCounts(appView.manageRows, appView.selected));
    for (const s of specs) {
      t.buttons[s.kind].textContent = s.label;
      t.buttons[s.kind].disabled = s.disabled;
    }
    if (!t.el.isConnected) document.body.append(t.el);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (appView.managing) t.el.classList.add("shown"); }));
  } else {
    t.el.classList.remove("shown");
  }
  document.documentElement.classList.toggle("has-manage-toolbar", show);
}

// The bottom toolbar (packages.css .manage-toolbar, My IPAs' bar): Re-sign (blue, the Done button's look), Update, Delete (red).
function manageToolbarEl() {
  if (manageBar.toolbar) return manageBar.toolbar;
  const el = Object.assign(document.createElement("div"), { className: "manage-toolbar" });
  el.setAttribute("role", "toolbar");
  const buttons = { resign: barButton("Re-sign", "done manage-resign"), update: barButton("Update", "manage-update"),
    delete: barButton("Delete", "manage-delete") };
  for (const [kind, b] of Object.entries(buttons)) b.addEventListener("click", () => runManage(kind));
  el.append(buttons.resign, buttons.update, buttons.delete);
  manageBar.toolbar = { el, buttons };
  return manageBar.toolbar;
}

// Leaving the root (another tab, a pushed page) ends Manage, so the toolbar never shows over another page.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => { if (appView.managing && !rootShown()) setManaging(false); });
}

// The queue jobs for `kind` ("resign" | "update") from the picked rows: Re-sign signs an app iFizBox signed again from
// its record (resignJob; one from My IPAs from the stored file), a marked app from its installed version's IPA on the
// source (markedResignJob); Update queues the newest version (appJob). Rows the kind doesn't apply to are left out.
export function manageJobs(kind, picked) {
  const out = [];
  for (const r of picked ?? []) {
    const k = manageKinds(r);
    if (!k) continue;
    let j = null;
    if (kind === "resign" && k.resign) j = r.signed ? resignJob(r.signed) : markedResignJob(r.pkg, r.version, { source: r.sourceName || null });
    else if (kind === "update" && k.update && r.pkg) j = appJob(r.pkg, { installed: r.version || null, source: r.sourceName || null });
    if (j) out.push(j);
  }
  return out;
}

export const MANAGE_VERB = { resign: "Re-signing", update: "Updating" };

// The confirm sheet's title and its button for Re-sign and Update.
export function manageSheet(kind, n, marked = 0) {
  const apps = n === 1 ? "App" : `${n} Apps`;
  if (kind === "resign") {
    const dl = marked === 0 ? "" : marked === 1 ? " 1 app is downloaded from its source first." : ` ${marked} apps are downloaded from their sources first.`;
    return { title: `Each app keeps its data.${dl}`, button: n === 1 ? "Re-sign App" : `Re-sign ${apps}` };
  }
  return { title: "Each app is updated to its newest version and keeps its data.", button: n === 1 ? "Update App" : `Update ${apps}` };
}

// B46 per app for a bulk Delete: { act: [{ r, a }] (uninstalled or removed from the list), stay: [r] (iOS still has
// them and iFizBox can't delete them: the sideload app) }.
export function bulkDeletePlan(picked, { mode = detectMode() } = {}) {
  const act = [];
  const stay = [];
  for (const r of picked ?? []) {
    const a = deleteAction(r, { mode });
    if (!a) continue;
    if (a.kind === "installed") stay.push(r); else act.push({ r, a });
  }
  return { act, stay };
}

const stayLine = (stay) => (stay.length === 1 ? `${stay[0].name} is still on your iPhone and stays on the list.`
  : `${stay.length} apps are still on your iPhone and stay on the list.`);

// The bulk Delete's sheet: { title, button } (button null: nothing to do but explain, an alert).
export function bulkDeleteSheet(plan) {
  const n = plan.act.length;
  const un = plan.act.filter((x) => x.a.kind === "uninstall").length;
  const lines = [];
  if (un) lines.push(un === 1 ? "Deletes the app and its data from your iPhone." : `Deletes ${un} apps and their data from your iPhone.`);
  if (n > un) lines.push(n - un === 1 ? `Removes 1 app from the list. ${HOME_SCREEN}` : `Removes ${n - un} apps from the list. ${HOME_SCREEN}`);
  if (plan.stay.length) lines.push(stayLine(plan.stay));
  const button = !n ? null : un === n ? (n === 1 ? `Delete ${plan.act[0].r.name}` : `Delete ${n} Apps`)
    : un ? `Delete ${n} Apps` : n === 1 ? REMOVE : `Remove ${n} Apps from List`;
  return { title: lines.join(" "), button };
}

// A toolbar button: the confirm sheet, then the jobs (Re-sign, Update) or the deletes; Manage ends and the list loads
// again (its pills follow). -> true when it went ahead.
export async function runManage(kind, { view = appView, mode = detectMode(), sheet = showActionSheet, alert = showAlert, run = runManageJobs,
  remove = deleteOne, done = () => { setManaging(false); if (appView.body) loadApps(); } } = {}) {
  const picked = manageable(view.manageRows).filter((r) => view.selected.has(r.id));
  if (!picked.length) return false;
  if (kind === "delete") {
    const plan = bulkDeletePlan(picked, { mode });
    const s = bulkDeleteSheet(plan);
    if (!s.button) { await alert({ title: "Still Installed", message: `${s.title} ${HOME_SCREEN}`, buttons: ["OK"] }); return false; }
    if (await sheet({ title: s.title, buttons: [s.button], destructive: 0 }) !== 0) return false;
    const failed = [];
    for (const { r, a } of plan.act) {
      try { await remove(a, r); } catch (e) { failed.push(`${r.name}: ${deviceError(e).message}`); }
    }
    done();
    if (failed.length) await alert({ title: "Couldn't Remove", message: failed.join("\n"), buttons: ["OK"] });
    return true;
  }
  const jobs = manageJobs(kind, picked);
  if (!jobs.length) return false;
  const s = manageSheet(kind, jobs.length, kind === "resign" ? jobs.filter((j) => j.url).length : 0);
  if (await sheet({ title: s.title, buttons: [s.button] }) !== 0) return false;
  await run(kind, jobs);
  done();
  return true;
}

// One app of a bulk Delete: the helper's uninstall behind its HUD, or forgetting the record.
async function deleteOne(a, r) {
  if (a.kind === "uninstall") return runDelete(a, r);
  return forgetApp(r);
}

// The run: every job into the app queue (screens/queue.js runAppQueue, as Confirm's: one at a time, iFizBox last, the
// first failure stops it and leaves the rest queued), each on the progress page as "Re-signing Delta (1 of 3)".
export async function runManageJobs(kind, jobs, { queue = null, run = null, install = manageInstall, hud = null } = {}) {
  const q = queue ?? (await import("../app-queue.js")).appQueue;
  const runner = run ?? (await import("./queue.js")).runAppQueue;
  for (const j of jobs) q.add(j);
  let i = 0;
  const n = jobs.length;
  return runner(jobs, { queue: q, install: (j) => install(j, { verb: MANAGE_VERB[kind] ?? "Installing", i: ++i, n, hud }) });
}

// One job of the run with the bulk label: a re-sign through screens/queue.js resignApp, an update signed on the phone
// (installOnDevice) or, on the site, in the browser (signAndInstall).
export async function manageInstall(job, { verb, i, n, hud = null, sc = null, resign = null } = {}) {
  sc ??= await import("../signing-client.js");
  hud ??= (await import("../nav/progress.js")).progressHUD;
  const h = bulkHud(hud, { verb, name: job.name || job.id, i, n });
  if (job.mode === "resign") {
    resign ??= (await import("./queue.js")).resignApp;
    return resign(job, { sc, hud: h, deps: { hud: h } });
  }
  if (sc.localSigning() && !sc.isSelfIpa(job.url)) return sc.installOnDevice({ url: job.url, name: job.name || "" }, { hud: h });
  return sc.signAndInstall({ url: job.url, name: job.name || "" });
}

// A HUD factory for job `i` of `n`: its label is always "<verb> <name> (i of n)", the bar the whole run's progress
// (the job's own percent counted in), and the job's own phases go to the page's log.
export function bulkHud(factory, { verb, name, i, n }) {
  return () => {
    let p = 0;
    const label = () => `${verb} ${name} (${i} of ${n}) ${Math.round(((i - 1) + p / 100) / n * 100)}%`;
    const h = factory(label());
    const w = Object.create(h);
    w.set = (t) => {
      const { text, percent } = hudLine(t);
      if (percent != null) p = percent;
      if (text) h.page?.raw?.(String(t));
      h.set(label());
    };
    return w;
  };
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
