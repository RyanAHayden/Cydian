// Changes tab, after Cydia's ChangesController (docs/cydia.md "Changes and metadata.cb0"). Every catalog reload
// files what it saw in IndexedDB on the device (core/changes.js, via catalog.js); this tab lists the last 7 days
// of it, a section per day ("Today", "Yesterday", then the date; F51), newest first, leaving out what the first
// load saw. AltStore versions file under their own dates. Rows say New or Updated (Cydian's addition). Nav bar:
// Refresh, as on the Sources tab. Below the root, the routes are screens/browse.js tokens (package:<id>, author:<name>).
// F51 filters, as on Search: a search field and a scope bar, All / Installed. Installed (dpkg's packages and the
// apps recorded on the device) is the default whenever anything is installed, else All; a tap on a segment holds
// for the session.
// Upgrades (F7): installed packages with a newer version on a source come first, under "Available Upgrades", then
// held ones (dpkg holds and Settings' Ignored Upgrades) under "Ignored Upgrades"; the tab badge counts the
// available ones, as Cydia's does.
// F62: Cydia's "Upgrade (N)" nav button (jailbreak build only: the site and the sideload build have no install
// queue). It queues every Available Upgrade, never the ignored ones, through N4's queue (one install job each, with
// the installed version so the queue reads it as an upgrade), which opens the Confirm sheet: Cydia's dist-upgrade.
// Hidden while there are none, as Cydia's is.
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { dayTitle, filterGroups, filterRows, defaultScope } from "../core/changes.js";
import { apps, installedIds, onAppsChange } from "../core/installed.js";
import { settings } from "./settings.js";
import { sourceFilter } from "../core/sources.js";
import { detectMode } from "../core/settings.js";
import { upgradesWithSelf } from "../essential-ui.js";

export const title = "Changes";

const state = { body: null, route: null, list: null, busy: false, seq: 0, query: "", scope: null, data: null, note: null, segs: null };

export const SCOPES = [["all", "All"], ["installed", "Installed"]];

// The scope shown: the user's pick this session, else Installed when anything is installed.
export const scopeOf = (picked, installed) => picked ?? defaultScope(installed.size);

export function init(ctx) {
  state.ctx = ctx;
  catalog.onChange(() => { if (state.body) load(); else badge(); });
  onAppsChange(() => { if (state.body) load(); });
  settings.onChange((key) => { if (key === "holds") { if (state.body) load(); else badge(); } });
  // At launch, only with a status file: without one there are no upgrades, and no reason to load every source.
  catalog.hasStatus().then((has) => { if (has) badge(); });
  // The app: take dpkg's holds (apt-mark showhold) as Ignored Upgrades; a change redraws through onChange.
  if (catalog.statusSource() === "native") settings.holds.sync().catch(() => {});
}

// The tab badge: how many upgrades are available (ignored ones don't count).
async function badge(upgrades) {
  try {
    upgrades ??= await upgradesWithSelf(await catalog.upgrades(settings.holds.list())); // F72: Cydian's own (sideload)
    state.ctx?.setBadge("changes", upgrades.available.length);
  } catch {
    // no catalog yet: no badge
  }
}

export function nav(route, ctx) {
  if (route.path.length) return browse.nav(route);
  const info = { title: "Changes", style: "plain", left: { label: "Refresh", onClick: () => refresh(ctx) } };
  if (canUpgrade()) info.right = { label: upgradeLabel(0), onClick: () => upgradeAll(queueFn(), state.data?.upgrades.available) };
  return info;
}

// ---- Upgrade (N) (F62) ----------------------------------------------------------------------------------------

// Only the jailbreak build has an install queue (backend-native.js queueCalls); the site and sideload never ask.
export function canUpgrade(mode = detectMode(), backend = () => getBackend()) {
  return mode === "jailbreak" && typeof backend()?.queue === "function";
}

export const upgradeLabel = (n) => `Upgrade (${n})`;

// One install job per available upgrade, as browse.js's Upgrade action queues it.
export const upgradeJobs = (available = []) =>
  available.filter((r) => r?.id && r.version).map((r) => ({ op: "install", id: r.id, version: r.version, installed: r.installed ?? null, name: r.name ?? null }));

// Queues them all; the first add opens Confirm (screens/queue.js initQueue), the rest refresh it. -> jobs queued.
export function upgradeAll(queue, available) {
  const jobs = upgradeJobs(available);
  if (!queue) return [];
  for (const job of jobs) queue(job);
  return jobs;
}

const queueFn = () => { const b = getBackend(); return typeof b.queue === "function" ? (job) => b.queue(job) : null; };

// The root page's nav bar button, found as browse.js setRightLabel finds its own: label and shown with the count.
function drawUpgradeButton(n) {
  const page = state.body?.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const item = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i];
  const b = item?.querySelector(".nav-right .bar-button");
  if (!b) return;
  const label = upgradeLabel(n);
  if (b.textContent !== label) b.textContent = label;
  b.hidden = n === 0;
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  state.body = body;
  state.route = route;
  state.list?.destroy();
  state.list = null;
  state.data = null;
  drawUpgradeButton(0);
  body.append(...filterBar());
  state.note = note("Loading Changes");
  body.append(state.note);
  load();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Search's grey bar and scope bar (screens/search.js, packages.css), without the Filter button.
function filterBar() {
  const bar = el("form", "search-bar has-scope");
  bar.setAttribute("role", "search");
  const field = el("label", "search-field");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search changes: name, description or author");
  input.enterKeyHint = "search";
  input.value = state.query;
  field.append(input);
  bar.append(field);
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.query = input.value; draw(); }, 120); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); state.query = input.value; draw(); input.blur(); });

  const scope = el("div", "search-scope");
  const seg = el("div", "scope-segments");
  seg.setAttribute("role", "tablist");
  state.segs = SCOPES.map(([value, label]) => {
    const b = el("button", "scope-segment", label);
    b.type = "button";
    b.dataset.scope = value;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => { state.scope = value; draw(); });
    return b;
  });
  seg.append(...state.segs);
  scope.append(seg);
  drawScope();
  return [bar, scope];
}

function drawScope(current = state.scope ?? (state.data ? scopeOf(null, state.data.installed) : null)) {
  for (const b of state.segs ?? []) {
    const on = b.dataset.scope === current;
    b.classList.toggle("selected", on);
    b.setAttribute("aria-selected", String(on));
  }
}

function note(text) {
  return Object.assign(document.createElement("p"), { className: "empty", textContent: text });
}

// Rows as the package list draws them, with each group's header in front: the upgrades first, then a group per
// day. An installed package shows under its upgrade, not again under its day (Cydia's rule). `filter`: the search
// field and scope (core/changes.js filterRows); upgrades are installed packages, so the scope never hides them.
export function itemsOf(groups, locale, upgrades = { available: [], ignored: [] }, { now = Date.now(), query = "", scope = "all", installed = new Set() } = {}) {
  const items = [];
  const upgraded = new Set();
  for (const [header, all] of [["Available Upgrades", upgrades.available], ["Ignored Upgrades", upgrades.ignored]]) {
    const rows = filterRows(all, { query });
    for (const r of all) upgraded.add(r.id);
    if (!rows.length) continue;
    items.push({ header });
    for (const r of rows) {
      items.push({ ...r, change: "upgrade" });
    }
  }
  for (const g of filterGroups(groups, { query, scope, installed })) {
    const rows = g.rows.filter((r) => !upgraded.has(r.id));
    if (!rows.length) continue;
    items.push({ header: dayTitle(g.day, now, locale) });
    items.push(...rows);
  }
  return items;
}

// What the empty list says.
export function emptyText({ query = "", scope = "all" } = {}) {
  if (query.trim()) return "No changes match your search.";
  if (scope === "installed") return "No changes to installed packages in the last 7 days.";
  return "No changes in the last 7 days. New and updated packages show here after a refresh.";
}

function decorate(row, item) {
  row.dataset.change = item.change;
}

// Everything installed (dpkg's packages and the apps recorded on the device), as ids; failures count as none.
async function installedNow() {
  const [rows, recs] = await Promise.all([catalog.installed().catch(() => null), apps().then((s) => s.all()).catch(() => [])]);
  return installedIds(rows, recs);
}

async function load() {
  const seq = ++state.seq;
  let groups, upgrades, installed;
  try {
    await catalog.ensure();
    [groups, upgrades, installed] = await Promise.all([catalog.changes(), catalog.upgrades(settings.holds.list()), installedNow()]);
    upgrades = await upgradesWithSelf(upgrades); // F72: the sideload build lists Cydian's own upgrade here
  } catch (e) {
    if (seq === state.seq && state.note) { state.note.textContent = e.message; state.note.hidden = false; }
    return;
  }
  if (seq !== state.seq) return;
  badge(upgrades);
  state.data = { groups, upgrades, installed };
  draw();
}

// Draws the list from the last load with the current search and scope (no reload: typing stays fast).
function draw() {
  const body = state.body;
  if (!body || !state.data) return;
  const { groups, upgrades, installed } = state.data;
  drawUpgradeButton(upgrades.available.length);
  const scope = scopeOf(state.scope, installed);
  drawScope(scope);
  const items = itemsOf(groups, undefined, upgrades, { query: state.query, scope, installed });
  state.note.hidden = items.length > 0;
  state.note.textContent = items.length ? "" : emptyText({ query: state.query, scope });
  if (!state.list) {
    state.list = browse.packageList(body, state.route, items, { letters: false, decorate });
    body.append(state.list.el);
  } else {
    browse.rememberNames(items.filter((r) => r.id));
    state.list.setItems(items);
  }
}

async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  const hide = ctx.showHUD("Reloading Data");
  try {
    await getBackend().refreshSources(undefined, { filter: sourceFilter(settings.deviceType()) }); // F41
    if (catalog.statusSource() === "native") await catalog.reloadInstalled();
    await load();
  } catch (e) {
    hide();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    hide();
    state.busy = false;
  }
}
