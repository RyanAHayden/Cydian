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

export const title = "Installed";

export const DPKG = "dpkg"; // the site's path segment for the status file's packages
export const APPS = "apps"; // F87: the jailbreak app's path segment for the remembered apps

const state = { body: null, route: null, list: null, seq: 0 };
const appView = { body: null, route: null, seq: 0, editing: false, right: null };

// Records apps (F30) rather than reading dpkg: everywhere but the jailbreak app.
export const recordsApps = (mode = detectMode()) => mode !== "jailbreak";

// Which page a route is: "apps" (F30's list), "dpkg" (the status file's packages), "myipas" (F77) or a browse.js page.
export function pageKind(route, mode = detectMode()) {
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
}

export function nav(route) {
  const kind = pageKind(route);
  if (kind === "browse") return browse.nav(route);
  if (kind === "myipas") return myipas.nav(route);
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
  try {
    // F87: the Apps row has to be there before the list measures where it starts (vlist.js caches the offset).
    [rows, appCount] = await Promise.all([catalog.installed(), recordsApps() ? 0 : jailbreakAppCount()]);
  } catch (e) {
    if (seq === state.seq) state.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== state.seq) return;
  const body = state.body;
  state.list?.destroy();
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
  if (!rows.length) {
    body.replaceChildren(note("No packages."));
    return;
  }
  body.replaceChildren();
  if (appCount) body.append(appsRow(state.route, appCount));
  state.list = browse.packageList(body, state.route, rows);
  body.append(state.list.el);
}

// F87: how many apps (not Cydian itself) the jailbreak app remembers; 0 when the store can't be read.
async function jailbreakAppCount() {
  try { return (await (await apps()).all()).filter((r) => r?.id && !r.self).length; } catch { return 0; }
}

function appsRow(route, n) {
  return grouped([{ rows: [{ label: "Apps", subtitle: n === 1 ? "1 app installed from an app page" : `${n} apps installed from an app page`,
    href: format({ tab: route.tab, path: [...route.path, APPS] }) }] }]);
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
  const hasStatus = site ? await catalog.hasStatus() : false;
  if (seq !== appView.seq) return;
  if (!recordsApps()) rows = rows.filter((r) => !r?.self); // Cydian's own row is dpkg's there
  drawApps(appListRows(rows, () => null), new Map(), site, hasStatus);
  // The upgrade badges wait on the sources; the list doesn't.
  if (!rows.length) return;
  let cands;
  try { cands = await candidates(rows); } catch { return; }
  if (seq !== appView.seq) return;
  drawApps(appListRows(rows, (id) => cands.get(id) ?? null), cands, site, hasStatus);
}

function drawApps(rows, cands, site, hasStatus) {
  const body = appView.body;
  const route = appView.route;
  const sections = [{
    rows: rows.map((r) => ({
      label: r.name, subtitle: appSubtitle(r), detail: r.upgrade || r.actual === null ? undefined : r.version,
      badge: r.upgrade ? "Upgrade" : undefined, icon: { text: r.name.charAt(0).toUpperCase() },
      // The app page, while a source still has the app.
      href: cands.has(r.id) ? format({ tab: route.tab, path: [...route.path, `package:${r.id}`] }) : null,
    })),
  }];
  if (site) {
    sections.push({ header: "Jailbroken iPhone", rows: [hasStatus
      ? { label: "dpkg Status File", subtitle: "Packages installed with apt", href: format({ tab: route.tab, path: [DPKG] }) }
      : { label: "Choose Status File", subtitle: "See the packages a jailbroken iPhone has", onClick: () => chooseStatus() }] });
  }
  const ul = plain(sections);
  ul.classList.toggle("editing", appView.editing);
  const cells = ul.querySelectorAll(":scope > .cell");
  rows.forEach((r, i) => decorateApp(cells[i], r));
  attachRowGestures(ul);
  body.classList.replace("grouped", "plain");
  // F87: no Install IPAs tile on the jailbreak app's Apps page (My IPAs is a sideload page).
  body.replaceChildren(...(recordsApps() ? [myIpasTile(route, site)] : []), ul);
  if (!rows.length) {
    ul.before(note("No apps yet. Apps you install from an app's page are listed here, on this device.")); // under My IPAs
  }
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
