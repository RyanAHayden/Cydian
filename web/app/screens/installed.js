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
// F87: in the jailbreak app, apps Cydian remembers (core/installed.js) are on an Apps page one row down
// (#installed/apps, the row above dpkg's packages, there only when it has any), listed at the version on the phone
// (app-updates.js rememberedApps, I4) with the note where it differs from what Cydian remembered.
//
// F91: in the sideload app every app Cydian signed (signing.installed) shows its signature's days left on the right,
// a small pill (core/signing.js signatureState; packages.css .sig-pill): green outside the re-sign window (Settings >
// Signing > Re-sign Reminder), amber inside it, red once expired. Signed apps the list doesn't remember (My IPAs,
// Custom Install as another ID) are listed under them, without Delete (Signed Apps in Settings forgets those).
//
// F104: the dpkg list has a scope bar as on iOS 6's Usage screen: Name (A–Z, as before), Recent (newest install
// first, by the mtime of dpkg's info/<pkg>.list, which the jailbreak app reads: apt.installDates in Apt.swift;
// the site's uploaded status file has no dates, so no Recent there) and Size (Installed-Size, largest first).
//
// F125: the Wish List lives here (it was a row on Home): a Wish List row with its count (a grey count badge) on the
// root, under the installed lists (beside Apps above dpkg's packages in the jailbreak app, so it isn't hundreds of rows
// down; a Packages section under the apps elsewhere), opens #installed/wishlist: the wished packages as a package
// list, Edit (the red minus, then Delete) or a left swipe removes one, as on the apps list.
import * as browse from "./browse.js";
import * as myipas from "./myipas.js";
import { grouped, plain, placeholder } from "../nav/ui.js";
import { format } from "../router.js";
import { catalog, ALL } from "../catalog.js";
import { showAlert } from "../nav/alert.js";
import { detectMode } from "../core/settings.js";
import { apps, appRows, appUpgrades, removeInstall, onAppsChange } from "../core/installed.js";
import { mediaUrl } from "./depiction.js";
import { rememberedApps } from "../app-updates.js";
import { signatureState, signedIndex, resignWindow } from "../core/signing.js";
import { settings } from "./settings.js";
import { wishRows, wishCount, WISH_EMPTY } from "../core/wishlist.js";

export const title = "Installed";

export const DPKG = "dpkg"; // the site's path segment for the status file's packages
export const APPS = "apps"; // F87: the jailbreak app's path segment for the remembered apps
export const WISH = "wishlist"; // F125: the Wish List page's path segment

const state = { body: null, route: null, list: null, seq: 0, dates: null };

// ---- F104: sorting the dpkg list --------------------------------------------------------------------------------

export const SORTS = ["name", "recent", "size"];
const SORT_LABEL = { name: "Name", recent: "Recent", size: "Size" };
const SORT_KEY = "cydian.installedSort";

// The scope bar's segments: Recent only where install dates can be read.
export const sortScopes = (hasDates) => SORTS.filter((s) => s !== "recent" || hasDates);

// rows (sorted by name, as catalog.installed gives them) in `by`'s order. `dates`: { id: seconds } (Recent);
// packages without a date or size go last, by name.
export function sortInstalled(rows, by, dates = null) {
  if (by !== "recent" && by !== "size") return rows;
  const val = by === "recent" ? (r) => Number(dates?.[r.id]) || 0 : (r) => Number(r.size) || 0;
  return rows.map((r, i) => [val(r), i, r]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[2]);
}

// What a row shows beside its version under Recent or Size.
export function sortDetail(r, by, dates = null, locale) {
  if (by === "size") return browse.formatSize(r.size);
  const t = by === "recent" ? Number(dates?.[r.id]) : 0;
  return t > 0 ? new Date(t * 1000).toLocaleDateString(locale, { dateStyle: "medium" }) : null;
}

function readSort() {
  try { const v = globalThis.localStorage?.getItem(SORT_KEY); return SORTS.includes(v) ? v : "name"; } catch { return "name"; }
}
function saveSort(v) {
  try { globalThis.localStorage?.setItem(SORT_KEY, v); } catch { /* private mode: this session only */ }
}
let sortBy = readSort();

// { package: seconds } from apt.installDates (the jailbreak app), or null where it can't be read.
export async function installDates(native = globalThis.cydianNative) {
  if (typeof native?.call !== "function" || typeof native?.dpkgStatus !== "function") return null;
  try {
    const d = await native.call("apt.installDates", {});
    return d && typeof d === "object" && Object.keys(d).length ? d : null;
  } catch { return null; }
}

function scopeBar(scopes, current, onPick) {
  const bar = Object.assign(document.createElement("div"), { className: "search-scope installed-scope" });
  const seg = Object.assign(document.createElement("div"), { className: "scope-segments" });
  for (const s of scopes) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "scope-segment", textContent: SORT_LABEL[s] });
    b.classList.toggle("selected", s === current);
    b.addEventListener("click", () => { if (s !== current) onPick(s); });
    seg.append(b);
  }
  bar.append(seg);
  return bar;
}
const appView = { body: null, route: null, seq: 0, editing: false, right: null };

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
  // F125: the count on the Wish List row, and the Wish List page, follow the list (the package page's sheet, a Delete).
  browse.wishlist().onChange(() => {
    if (wishView.body) loadWish();
    if (state.body && state.rows !== undefined) draw();
    if (appView.body) loadApps();
  });
}

export function nav(route) {
  const kind = pageKind(route);
  if (kind === "browse") return browse.nav(route);
  if (kind === "myipas") return myipas.nav(route);
  if (kind === "wishlist") {
    return { title: "Wish List", style: "plain",
      right: { label: wishView.editing ? "Done" : "Edit", onClick: (e) => setWishEditing(!wishView.editing, e.currentTarget) } };
  }
  if (kind === "apps") {
    return { title: recordsApps() ? "Installed" : "Apps", style: "plain", // F87: "Apps" one row down in the jailbreak app
      right: { label: appView.editing ? "Done" : "Edit", onClick: (e) => setEditing(!appView.editing, e.currentTarget) } };
  }
  const info = { title: recordsApps() ? "dpkg Status" : "Installed", style: "plain" };
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
  try {
    // F87: the Apps row has to be there before the list measures where it starts (vlist.js caches the offset).
    [rows, appCount, dates] = await Promise.all([catalog.installed(), recordsApps() ? 0 : jailbreakAppCount(), installDates()]);
  } catch (e) {
    if (seq === state.seq) state.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== state.seq) return;
  Object.assign(state, { rows, appCount, dates });
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
  // F87's Apps row and F125's Wish List row, on the root (not the site's dpkg page one row down).
  const top = [appCount ? appsRow(state.route, appCount) : null,
    state.route.path.length ? null : wishListRow(state.route, wishCount(browse.wishlist().list(), rows.map((r) => r.id)))].filter(Boolean);
  if (!rows.length) {
    body.replaceChildren(...(top.length ? [grouped([{ rows: top }])] : []), note("No packages."));
    return;
  }
  body.replaceChildren();
  if (top.length) body.append(grouped([{ rows: top }]));
  // F104: the scope bar goes in before the list measures where it starts.
  const scopes = sortScopes(Boolean(state.dates));
  const by = scopes.includes(sortBy) ? sortBy : "name";
  body.append(scopeBar(scopes, by, (s) => { sortBy = s; saveSort(s); draw(); }));
  const dates = state.dates;
  state.list = browse.packageList(body, state.route, sortInstalled(rows, by, dates), by === "name" ? undefined : {
    letters: false,
    decorate: (row, item) => {
      const extra = sortDetail(item, by, dates);
      row._.version.textContent = [item.version, extra].filter(Boolean).join(" · ");
    },
  });
  body.append(state.list.el);
}

// F87: how many apps (not Cydian itself) the jailbreak app remembers; 0 when the store can't be read.
async function jailbreakAppCount() {
  try { return (await (await apps()).all()).filter((r) => r?.id && !r.self).length; } catch { return 0; }
}

function appsRow(route, n) {
  return { label: "Apps", subtitle: n === 1 ? "1 app installed from an app page" : `${n} apps installed from an app page`,
    href: format({ tab: route.tab, path: [...route.path, APPS] }) };
}

// F125: Installed's Wish List row; `n` (wished, not installed) as the grey count badge, none at 0.
export function wishListRow(route, n) {
  return { label: "Wish List", subtitle: "Packages to install later", badge: n > 0 ? String(n) : undefined,
    href: format({ tab: route.tab, path: [WISH] }) };
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
  // F87: I4's note, where the phone's version isn't the one Cydian remembered, comes first.
  return [r.note || null, r.upgrade ? `Upgrade to ${r.upgrade}` : null, r.sourceName || r.source, date].filter(Boolean).join(" · ");
}

// F87: the remembered apps for the list; an app the phone doesn't have (I4's `actual` null) offers no upgrade.
export function appListRows(records, candidateOf) {
  return appUpgrades(appRows(records), candidateOf).map((r) => (r.actual === null ? { ...r, upgrade: null } : r));
}

// F91: each row's signature ({ state, text, long } or none) from signing.installed, by bundle ID (installed or
// original), and the signed apps no row stands for, as rows of their own (`signedOnly`). -> { rows, extra }
export function withSignatures(rows, installed, { now = new Date(), window } = {}) {
  const index = signedIndex(installed);
  const used = new Set();
  const out = rows.map((r) => {
    const a = index.get(r.id);
    if (!a) return r;
    used.add(a.bundleId);
    const sig = signatureState(a.expires, { now, window });
    return sig ? { ...r, sig } : r;
  });
  const extra = [];
  for (const a of Array.isArray(installed?.apps) ? installed.apps : []) {
    if (!a?.bundleId || used.has(a.bundleId)) continue;
    used.add(a.bundleId);
    extra.push({ id: a.bundleId, name: a.name || a.bundleId, version: a.version || "", signedOnly: true,
      sig: signatureState(a.expires, { now, window }) ?? undefined });
  }
  return { rows: out, extra };
}

// signing.installed in the sideload app; null anywhere else or when the call fails.
async function signedApps(native = globalThis.cydianNative) {
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
  if (!recordsApps()) rows = rows.filter((r) => !r?.self); // Cydian's own row is dpkg's there
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
  // F91: the signature pill in place of the version (the version stays in the subtitle).
  const signed = appView.signed ? withSignatures(listRows, appView.signed, { window: resignWindow((k) => settings.get(k)) }) : { rows: listRows, extra: [] };
  const rows = signed.rows;
  const sections = [{
    rows: [...rows.map((r) => ({
      label: r.name, subtitle: r.sig && !r.upgrade && r.version ? [`Version ${r.version}`, appSubtitle(r)].filter(Boolean).join(" · ") : appSubtitle(r),
      detail: r.sig && !r.upgrade ? r.sig.text : r.upgrade || r.actual === null ? undefined : r.version,
      badge: r.upgrade ? "Upgrade" : undefined, icon: { text: r.name.charAt(0).toUpperCase() },
      // The app page, while a source still has the app.
      href: cands.has(r.id) ? format({ tab: route.tab, path: [...route.path, `package:${r.id}`] }) : null,
    })), ...signed.extra.map((r) => ({ label: r.name, subtitle: [r.version ? `Version ${r.version}` : null, "Signed by Cydian"].filter(Boolean).join(" · "),
      detail: r.sig?.text, icon: { text: r.name.charAt(0).toUpperCase() } }))],
  }];
  if (site) {
    sections.push({ header: "Jailbroken iPhone", rows: [hasStatus
      ? { label: "dpkg Status File", subtitle: "Packages installed with apt", href: format({ tab: route.tab, path: [DPKG] }) }
      : { label: "Choose Status File", subtitle: "See the packages a jailbroken iPhone has", onClick: () => chooseStatus() }] });
  }
  sections.push({ header: "Packages", rows: [wishListRow(route, wishCount(browse.wishlist().list(), appView.installedIds ?? []))] }); // F125
  const ul = plain(sections);
  ul.classList.toggle("editing", appView.editing);
  const cells = ul.querySelectorAll(":scope > .cell");
  rows.forEach((r, i) => decorateApp(cells[i], r));
  [...rows, ...signed.extra].forEach((r, i) => { if (r.sig && !r.upgrade) sigPill(cells[i], r.sig); });
  attachRowGestures(ul);
  body.classList.replace("grouped", "plain");
  // F87: no Install IPAs tile on the jailbreak app's Apps page (My IPAs is a sideload page).
  body.replaceChildren(...(recordsApps() ? [myIpasTile(route, site)] : []), ul);
  if (!rows.length) {
    ul.before(note("No apps yet. Apps you install from an app's page are listed here, on this device.")); // under My IPAs
  }
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
