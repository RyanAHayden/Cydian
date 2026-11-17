// Changes tab, after Cydia's ChangesController (docs/cydia.md "Changes and metadata.cb0"). Every catalog reload
// files what it saw in IndexedDB on the device (core/changes.js, via catalog.js); this tab lists the packages
// under "New at <date>" sections, newest first, and drops the oldest section (the first load). Rows say New or
// Updated (Cydian's addition). Nav bar: Refresh, as on the Sources tab. Below the root, the routes are
// screens/browse.js tokens (package:<id>, author:<name>).
// Upgrades (F7): installed packages with a newer version on a source come first, under "Available Upgrades", then
// held ones (dpkg holds and Settings' Ignored Upgrades) under "Ignored Upgrades"; the tab badge counts the
// available ones, as Cydia's does. Not here yet: Cydia's "Upgrade (N)" button, which needs the install queue.
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { groupTitle } from "../core/changes.js";
import { settings } from "./settings.js";

export const title = "Changes";

const state = { body: null, route: null, list: null, busy: false, seq: 0 };

export function init(ctx) {
  state.ctx = ctx;
  catalog.onChange(() => { if (state.body) load(); else badge(); });
  settings.onChange((key) => { if (key === "holds") { if (state.body) load(); else badge(); } });
  // At launch, only with a status file: without one there are no upgrades, and no reason to load every source.
  catalog.hasStatus().then((has) => { if (has) badge(); });
  // The app: take dpkg's holds (apt-mark showhold) as Ignored Upgrades; a change redraws through onChange.
  if (catalog.statusSource() === "native") settings.holds.sync().catch(() => {});
}

// The tab badge: how many upgrades are available (ignored ones don't count).
async function badge(upgrades) {
  try {
    upgrades ??= await catalog.upgrades(settings.holds.list());
    state.ctx?.setBadge("changes", upgrades.available.length);
  } catch {
    // no catalog yet: no badge
  }
}

export function nav(route, ctx) {
  if (route.path.length) return browse.nav(route);
  return { title: "Changes", style: "plain", left: { label: "Refresh", onClick: () => refresh(ctx) } };
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  state.body = body;
  state.route = route;
  body.append(note("Loading Changes"));
  load();
}

function note(text) {
  return Object.assign(document.createElement("p"), { className: "empty", textContent: text });
}

// Rows as the package list draws them, with each group's header in front: the upgrades first, then the New at
// groups. An installed package shows under its upgrade, not again under New at (Cydia's rule).
export function itemsOf(groups, locale, upgrades = { available: [], ignored: [] }) {
  const items = [];
  const upgraded = new Set();
  for (const [header, rows] of [["Available Upgrades", upgrades.available], ["Ignored Upgrades", upgrades.ignored]]) {
    if (!rows.length) continue;
    items.push({ header });
    for (const r of rows) {
      upgraded.add(r.id);
      items.push({ ...r, change: "upgrade" });
    }
  }
  for (const g of groups) {
    const rows = g.rows.filter((r) => !upgraded.has(r.id));
    if (!rows.length) continue;
    items.push({ header: groupTitle(g.seen, locale) });
    items.push(...rows);
  }
  return items;
}

function decorate(row, item) {
  row.dataset.change = item.change;
}

async function load() {
  const seq = ++state.seq;
  let groups, upgrades;
  try {
    await catalog.ensure();
    [groups, upgrades] = await Promise.all([catalog.changes(), catalog.upgrades(settings.holds.list())]);
  } catch (e) {
    if (seq === state.seq) state.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== state.seq) return;
  badge(upgrades);
  const body = state.body;
  state.list?.destroy();
  state.list = null;
  const items = itemsOf(groups, undefined, upgrades);
  if (!items.length) {
    body.replaceChildren(note("No changes yet. New and updated packages show here after a refresh."));
    return;
  }
  body.replaceChildren();
  state.list = browse.packageList(body, state.route, items, { letters: false, decorate });
  body.append(state.list.el);
}

async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  const hide = ctx.showHUD("Reloading Data");
  try {
    await getBackend().refreshSources();
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
