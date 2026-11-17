// Changes tab, after Cydia's ChangesController (docs/cydia.md "Changes and metadata.cb0"). Every catalog reload
// files what it saw in IndexedDB on the device (core/changes.js, via catalog.js); this tab lists the packages
// under "New at <date>" sections, newest first, and drops the oldest section (the first load). Rows say New or
// Updated (Cydian's addition). Nav bar: Refresh, as on the Sources tab. Below the root, the routes are
// screens/browse.js tokens (package:<id>, author:<name>).
// Not here yet: Available/Ignored Upgrades and the badge count of upgrades, which need the installed list.
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { getBackend } from "../backend.js";
import { showAlert } from "../nav/alert.js";
import { groupTitle } from "../core/changes.js";

export const title = "Changes";

const state = { body: null, route: null, list: null, busy: false, seq: 0 };

export function init() {
  catalog.onChange(() => { if (state.body) load(); });
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

// Rows as the package list draws them, with each group's header in front.
export function itemsOf(groups, locale) {
  const items = [];
  for (const g of groups) {
    items.push({ header: groupTitle(g.seen, locale) });
    items.push(...g.rows);
  }
  return items;
}

function decorate(row, item) {
  row.dataset.change = item.change;
}

async function load() {
  const seq = ++state.seq;
  let groups;
  try {
    await catalog.ensure();
    groups = await catalog.changes();
  } catch (e) {
    if (seq === state.seq) state.body.replaceChildren(note(e.message));
    return;
  }
  if (seq !== state.seq) return;
  const body = state.body;
  state.list?.destroy();
  state.list = null;
  if (!groups.length) {
    body.replaceChildren(note("No changes yet. New and updated packages show here after a refresh."));
    return;
  }
  body.replaceChildren();
  state.list = browse.packageList(body, state.route, itemsOf(groups), { letters: false, decorate });
  body.append(state.list.el);
}

async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  const hide = ctx.showHUD("Reloading Data");
  try {
    await getBackend().refreshSources();
    await load();
  } catch (e) {
    hide();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    hide();
    state.busy = false;
  }
}
