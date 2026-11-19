// Search tab: the kit's "grey search bar" over a virtualised result list. Every keystroke (debounced) asks the
// catalog in the parse worker, which matches name, id, description, Author and Maintainer (core/catalog.js
// search), best matches first. Results open the package page; its Author row lists all their packages.
// Below the root, the routes are screens/browse.js tokens (package:<id>, author:<name>).
//
// Filters (F35): under the bar, iOS 6's search scope bar: a segmented control over the broad kinds (All, Tweaks,
// Themes, Apps: core/catalog.js SECTION_GROUPS) and a Filter button whose drop-down panel picks a section, a source,
// installed or not, free or paid, and Show Incompatible. Show Incompatible is the Works on My Phone setting turned
// round (F17), so Search, Sections and Settings agree; an exact name or id match shows even when it can't work, in
// red with the reason under it (browse.js bindRow).
//
// Recent (F100, from Zebra): with the field empty, a grouped Recent table of the last five queries (saved on
// Search or when a result is opened; core/settings.js recentSearches) with Clear in its header; a tap runs one again.
import * as browse from "./browse.js";
import { catalog, ALL } from "../catalog.js";
import { compatFilterOn } from "../device.js";
import { settings, createSwitch } from "./settings.js";
import { SECTION_GROUPS, searchable } from "../core/catalog.js";
import { displayName, sourcesFor } from "../core/sources.js";
import { loadNew, onLanded } from "./sources.js";
import { orderSources, loadOrder } from "../core/sourcelist.js";
import { getBackend } from "../backend.js";
import { grouped, el } from "../nav/ui.js";
import { discoveryGroup } from "./extras.js";
import { recommendedApps, addRecommended, onSourcesChanged } from "./manage.js";
import { matchRecommendedApps } from "../core/recommended.js";
import { showAlert } from "../nav/alert.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { detectMode } from "../core/settings.js";

export const title = "Search";

// The segments: All plus the first three groups ("Utilities" and every other section are in the sheet; five
// segments and a button don't fit a 320-point bar).
export const SCOPES = ["All", ...SECTION_GROUPS.slice(0, 3)];

// F41: the segments a device type shows. Not Jailbroken lists apps only (F37), so Tweaks and Themes would only
// ever find nothing: just All and Apps then.
const JAILBREAK_ONLY = ["Tweaks", "Themes"];
export function scopesFor(type) {
  return type === "none" ? SCOPES.filter((n) => !JAILBREAK_ONLY.includes(n)) : SCOPES;
}

// The filters, kept for the session like the query: section (a section name or "group:<kind>"), source (a key),
// installed ("installed" | "not"), price ("free" | "paid"); null is any.
const EMPTY = { section: null, source: null, installed: null, price: null };
const state = { query: "", seq: 0, filters: { ...EMPTY } };
let rootInput = null; // the root page's field, for reselect()

// What the catalog is asked: only the filters that are set (none: undefined, the plain search).
export function searchFilters(f) {
  const out = {};
  for (const k of Object.keys(EMPTY)) if (f[k] != null && f[k] !== "") out[k] = f[k];
  return Object.keys(out).length ? out : undefined;
}

// F53: the Filter panel's Source rows: only the sources the device type shows (Not Jailbroken: AltStore ones,
// core/sources.js sourcesFor), in the Sources tab's order (Manage > Sources, F45) and by its display name.
export function sourceChoices(list, type, order = null) {
  return sourcesFor(orderSources(list, order), type).shown.map((s) => ({ label: displayName(s), value: s.key }));
}

// B75: sources added but never loaded (Manage > Recommended > Add All, then Search) load at once, under the Sources
// tab's reload bar (screens/sources.js loadNew: one shared run, Refresh's words, progress and Cancel), and the query
// runs again each time one's packages reach the catalog, so they show without leaving Search. Called on opening;
// `follow.load()` again as a query is typed (a source tried once is not asked again). `alive()` false (the page was
// left) unsubscribes. `load`, `landed`, `changed` and `loaded` are for the tests.
// B98: an add (Search's Recommended Add Source, Manage's Add / Add All; manage.js onSourcesChanged, whose listener in
// screens/sources.js starts the load) runs it at once too, so Recommended Sources drops the added source; and so does
// any catalog load (catalog.onLoaded): Add Source opens the source's page, whose catalog.ensure() often reads the new
// source before the reload bar's run gets to it, and that path never fires onLanded.
export function followNewSources(ctx, rerun, alive = () => true,
  { load = loadNew, landed = onLanded, changed = onSourcesChanged, loaded = catalog.onLoaded } = {}) {
  const offs = [];
  const off = () => { for (const f of offs.splice(0)) f?.(); };
  const listen = (subscribe) => offs.push(subscribe(() => { if (!alive()) { off(); return; } rerun(); }));
  listen(landed);
  listen(changed);
  listen(loaded);
  const kick = async () => { try { return await load(ctx); } catch { return null; } };
  kick();
  return { load: kick, off };
}

// F100: the Recent table's rows (nav/ui.js grouped), one per query, a tap hands it to `pick`.
export function recentRows(list, pick) {
  return (list || []).map((q) => ({ label: q, cls: "recent-row", onClick: () => pick(q) }));
}

// The segment a section filter selects: its index in SCOPES, or -1 (a section picked in the sheet).
export function scopeIndex(section) {
  if (section == null) return 0;
  const i = SCOPES.indexOf(String(section).replace(/^group:/, ""));
  return String(section).startsWith("group:") && i > 0 ? i : -1;
}

// Whether the sheet holds anything the segments don't show (the Filter button looks pressed then).
export const sheetActive = (f) => Boolean(f.source || f.installed || f.price || scopeIndex(f.section) === -1);

// A tap on the Search tab while already on its root (nav/tabbar.js tapTab, F36): focus the field. Called straight
// from the tap's click handler, never after an await or timer, or iOS won't bring up the keyboard.
export function reselect() {
  if (drop) { drop.close(); return true; } // an open Filter panel closes first
  if (!rootInput || !rootInput.isConnected) return false;
  rootInput.focus();
  return true;
}

// The field's placeholder (user 2026-11-19): tweaks in the jailbreak app, apps everywhere else.
export const searchPlaceholder = (mode = detectMode()) => (mode === "jailbreak" ? "Search Tweaks" : "Search Apps");

export function nav(route) {
  if (route.path.length) return browse.nav(route);
  return { title: "Search", style: "plain" };
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  // The shared bar (nav/searchbar.js): its Cancel empties the field and puts the keyboard away; Search saves the
  // query to Recent.
  const bar = searchBar({ placeholder: searchPlaceholder(), ariaLabel: "Search packages: name, description or author",
    value: state.query, delay: 120, className: "has-scope", onQuery: () => run(),
    onSubmit: (q) => settings.recentSearches.add(q),
    onFocus: () => drop?.close() }); // typing a search puts the Filter panel away
  const input = bar.input;
  rootInput = input;

  // The scope bar: segments, then Filter.
  const scope = el("div", "search-scope");
  const seg = el("div", "scope-segments");
  seg.setAttribute("role", "tablist");
  const segButtons = SCOPES.map((name, i) => {
    const b = el("button", "scope-segment", name);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      state.filters.section = i === 0 ? null : `group:${name}`;
      drawScope();
      run();
    });
    return b;
  });
  seg.append(...segButtons);
  const filterButton = el("button", "scope-filter", "Filter");
  filterButton.type = "button";
  filterButton.addEventListener("click", () => {
    if (drop) drop.close();
    else openFilters(scope, () => { drawScope(); run(); }, drawScope);
  });
  scope.append(seg, filterButton);
  function drawScope() {
    const shown = scopesFor(settings.deviceType());
    // A Tweaks or Themes scope left from Jailbroken goes back to All once those segments are hidden.
    if (scopeIndex(state.filters.section) > 0 && !shown.includes(SCOPES[scopeIndex(state.filters.section)])) state.filters.section = null;
    segButtons.forEach((b, i) => { b.hidden = !shown.includes(SCOPES[i]); });
    const sel = scopeIndex(state.filters.section);
    segButtons.forEach((b, i) => { b.classList.toggle("selected", i === sel); b.setAttribute("aria-selected", String(i === sel)); });
    // While the panel is open the button is a blue Done that puts it away.
    filterButton.textContent = drop ? "Done" : "Filter";
    filterButton.classList.toggle("done", Boolean(drop));
    filterButton.classList.toggle("selected", !drop && sheetActive(state.filters));
  }
  drawScope();

  const note = document.createElement("p");
  note.className = "empty search-note";
  // The bar and its scope row stay put, as Cydia's search bar does on the 4S (ref/4s/screens/search-85.png); only the
  // results scroll, and bounce, under them (packages.css .search-root).
  const results = pinned(body, bar, scope);
  // F100: the Recent table, shown in place of the note while the field is empty.
  const recent = el("div", "search-recent");
  results.append(note, recent);

  const list = browse.packageList(results, route, [], { letters: false });
  results.append(list.el);
  // F20: packages from sources the user hasn't added (Canister), under the local results.
  // B33: its rows not built for this device follow Show Incompatible too (settings.onChange below runs it again).
  const others = discoveryGroup(ctx, { hideIncompatible: compatFilterOn });
  const recs = recommendedGroup(ctx);
  results.append(recs.el, others.el);

  // Show Incompatible, the iOS version or the Architecture changed (here, in the sheet or in Settings): search
  // again. A page left behind unsubscribes.
  const off = settings.onChange((key) => {
    if (key === "recentSearches") { if (body.isConnected) drawRecent(); else off(); return; }
    if (!["worksOnMyPhone", "iosVersion", "arch", "device"].includes(key)) return;
    if (!body.isConnected) { off(); return; }
    if (key === "device") drawScope();
    run();
  });

  function drawRecent() {
    const items = input.value.trim() ? [] : settings.recentSearches.list();
    recent.replaceChildren();
    recent.hidden = !items.length;
    note.hidden = !input.value.trim() && items.length > 0;
    if (!items.length) return;
    recent.append(grouped([{ header: "Recent", rows: recentRows(items, pick) }]));
    const clear = el("button", "recent-clear", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => settings.recentSearches.clear());
    recent.querySelector(".group-header").append(clear);
  }
  // A Recent row: search it again, as if typed and Searched (it moves to the top).
  function pick(q) {
    bar.set(q);
    settings.recentSearches.add(q);
    run();
    input.blur();
  }
  // Opening a result (a package row here or under Other Sources) saves the query that found it.
  results.addEventListener("click", (e) => {
    if (e.target.closest?.("a[href]") && !recent.contains(e.target)) settings.recentSearches.add(input.value);
  });
  // B75: `again`: the same query run once more because a source's packages landed: the list keeps its scroll and
  // Other Sources and Recommended Sources aren't asked again.
  async function run({ again = false } = {}) {
    const q = input.value.trim();
    state.query = input.value;
    const seq = ++state.seq;
    if (!again) {
      // One character searches here; Canister needs two (core/canister.js askable()).
      others.search(searchable(q) && settings.deviceType() !== "none" ? q : ""); // jailbreak packages only
      recs.search(searchable(q) ? q : "");
      drawRecent();
      if (searchable(q)) follow.load(); // B75: anything added since opening loads too
    }
    if (!searchable(q)) {
      list.setItems([]);
      note.textContent = "Package names, descriptions and authors.";
      return;
    }
    if (!again) note.textContent = "";
    let rows;
    try {
      rows = await catalog.search(q, searchFilters(state.filters));
    } catch (e) {
      if (seq === state.seq) note.textContent = e.message;
      return;
    }
    if (seq !== state.seq) return; // a newer keystroke won
    if (!again) results.scrollTop = 0;
    browse.rememberNames(rows);
    list.setItems(rows);
    note.textContent = rows.length ? "" : "No Results";
  }
  // B75: opening Search loads sources never loaded; each one landing runs a typed query again.
  // B98: Recommended Sources is asked again too, so a source just added leaves it once it is in the list.
  const follow = followNewSources(ctx, () => {
    const q = input.value.trim();
    if (!searchable(q)) return;
    run({ again: true });
    recs.search(q, { again: true });
  }, () => body.isConnected);
  run();
}

// ---- apps in recommended sources not added yet ---------------------------------------------------------------
// Under the local results: apps whose source Recommended lists (core/recommended.js) but the user hasn't added.
// A tap offers Add Source, then opens the source's page, where the app installs as usual.
function recommendedGroup(ctx) {
  const box = el("div", "discovery");
  let seq = 0;
  // `again` (B98: a source added or landed): no wait and no blank first; the group is swapped once read.
  async function search(q, { again = false } = {}) {
    const turn = ++seq;
    if (!again) box.replaceChildren();
    if (!q) { box.replaceChildren(); return; }
    if (!again) await new Promise((r) => setTimeout(r, 450)); // once typing stops, as Other Sources does
    if (turn !== seq) return;
    const found = matchRecommendedApps(await recommendedApps().catch(() => []), q);
    if (turn !== seq) return;
    if (!found.length) { box.replaceChildren(); return; }
    box.replaceChildren(grouped([{
      header: "Recommended Sources",
      rows: found.map(({ row, app }) => ({
        label: app.name,
        subtitle: [row.label, app.subtitle || app.developerName].filter(Boolean).join(" · "),
        icon: { text: app.name?.[0]?.toUpperCase() ?? "?" },
        onClick: () => offer(row, app, ctx),
      })),
      footer: "From recommended sources you haven't added. Add the source to install.",
    }]));
  }
  return { el: box, search };
}

async function offer(row, app, ctx) {
  const { index } = await showAlert({ title: app.name, message: `In ${row.label} (${row.record.uri}). Add this source?`,
    buttons: ["Cancel", "Add Source"], cancel: 0 });
  if (index !== 1 || !(await addRecommended(row, ctx))) return;
  ctx.go({ tab: "sources", path: [row.key] });
}

// ---- the Filter sheet ----------------------------------------------------------------------------------------

// One choice group: a row per option, the chosen one checked; a tap picks it and redraws.
function choiceGroup(header, options, current, pick, footer) {
  return grouped([{ header, footer, rows: options.map((o) => ({
    label: o.label, checked: (o.value ?? null) === (current ?? null), onClick: () => pick(o.value ?? null),
  })) }]);
}

// The Filter panel drops down from under the scope bar and covers only the results (the search field and the
// segments stay), like a menu; Filter again, or a tap on the Search tab, puts it away (reselect()). Leaving Search
// closes it too. Transform only.
let drop = null; // the open panel: { close() }
async function openFilters(scope, changed, redraw) {
  const box = el("div", "grouped filter-sheet filter-drop-inner");
  box.dataset.scroller = ""; // the iOS 6 scroll indicator follows it too (nav/scroller.js)
  const wrap = el("div", "filter-drop");
  wrap.style.top = Math.round(scope.getBoundingClientRect().bottom) + "px";
  wrap.append(box);
  document.body.append(wrap);
  const ease = "cubic-bezier(.25,.1,.25,1)";
  box.animate([{ transform: "translateY(-100%)" }, { transform: "none" }], { duration: 280, easing: ease });
  const onRoute = () => { if (!/^#\/search\/?$/.test(location.hash)) close(); };
  addEventListener("hashchange", onRoute);
  function close() {
    if (drop !== ctl) return;
    drop = null;
    removeEventListener("hashchange", onRoute);
    redraw?.();
    const a = box.animate([{ transform: "none" }, { transform: "translateY(-100%)" }], { duration: 220, easing: ease, fill: "forwards" });
    a.finished.then(() => wrap.remove(), () => wrap.remove());
  }
  const ctl = { close };
  drop = ctl;
  redraw?.();
  let sources = [], sections = [];
  const f = state.filters;
  const set = (key, value) => { f[key] = value; draw(); changed(); };

  function draw() {
    const top = box.scrollTop;
    box.replaceChildren();
    // Compatibility first: the one users reach for when a package they know isn't there.
    const compat = grouped([{ rows: [{ label: "Show Incompatible" }],
      footer: "Packages that say they don't work on this iPhone. An exact name always shows, in red." }]);
    const cell = compat.querySelector(".cell-inner");
    cell.classList.add("has-switch");
    cell.append(createSwitch({ label: "Show Incompatible", checked: !compatFilterOn(),
      onToggle: (on) => { if (compatFilterOn() === on) settings.set("worksOnMyPhone", !on); } }));
    box.append(compat);
    if (searchFilters(f)) {
      box.append(grouped([{ rows: [{ label: "Clear Filters", onClick: () => { Object.assign(f, EMPTY); draw(); changed(); } }] }]));
      box.querySelector(".group:last-child .cell-inner").classList.add("filter-clear");
    }
    box.append(choiceGroup("Installed", [{ label: "All Packages" }, { label: "Installed", value: "installed" },
      { label: "Not Installed", value: "not" }], f.installed, (v) => set("installed", v),
    catalog.statusSource() === "upload" ? "Installed packages come from the dpkg status file uploaded on the Installed page." : null));
    box.append(choiceGroup("Price", [{ label: "Free and Paid" }, { label: "Free", value: "free" }, { label: "Paid", value: "paid" }],
      f.price, (v) => set("price", v)));
    box.append(choiceGroup("Source", [{ label: "All Sources" }, ...sources],
      f.source, (v) => set("source", v)));
    const groupRows = SECTION_GROUPS.map((g) => ({ label: `All ${g}`, value: `group:${g}` }));
    box.append(choiceGroup("Section", [{ label: "All Sections" }, ...groupRows, ...sections.map((s) => ({ label: s, value: s }))],
      f.section, (v) => set("section", v)));
    box.scrollTop = top;
  }
  draw();
  try {
    const type = settings.deviceType();
    const [list, data] = await Promise.all([getBackend().sources(), catalog.sections(ALL)]);
    sources = sourceChoices(list, type, loadOrder());
    sections = data.sections.map((s) => s.name);
    // A source picked under the other device type, now hidden: back to All Sources.
    if (f.source != null && !sources.some((o) => o.value === f.source)) { f.source = null; changed(); }
    if (box.isConnected) draw();
    // F53: AltStore sources seeded by URL (F28) have no name until loaded, as on the Sources tab's first visit
    // (F43): load them (B75: Search's shared run under the reload bar, screens/sources.js loadNew) and redraw with
    // their names.
    if (await loadNew()) {
      sources = sourceChoices(await getBackend().sources(), type, loadOrder());
      if (box.isConnected) draw();
    }
  } catch {
    // no sources or sections yet (or a first load failed): the sheet keeps what it has
  }
}
