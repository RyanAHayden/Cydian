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
import * as browse from "./browse.js";
import { catalog, ALL } from "../catalog.js";
import { compatFilterOn } from "../device.js";
import { settings, createSwitch } from "./settings.js";
import { SECTION_GROUPS } from "../core/catalog.js";
import { displayName } from "../core/sources.js";
import { getBackend } from "../backend.js";
import { grouped } from "../nav/ui.js";

export const title = "Search";

// The segments: All plus the first three groups ("Utilities" and every other section are in the sheet; five
// segments and a button don't fit a 320-point bar).
export const SCOPES = ["All", ...SECTION_GROUPS.slice(0, 3)];

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

export function nav(route) {
  if (route.path.length) return browse.nav(route);
  return { title: "Search", style: "plain" };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  const bar = document.createElement("form");
  bar.className = "search-bar has-scope";
  bar.setAttribute("role", "search");
  const field = document.createElement("label");
  field.className = "search-field";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search packages: name, description or author");
  input.enterKeyHint = "search";
  input.value = state.query;
  rootInput = input;
  input.addEventListener("focus", () => drop?.close()); // typing a search puts the Filter panel away
  field.append(input);
  bar.append(field);

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
  body.append(bar, scope, note);

  const list = browse.packageList(body, route, [], { letters: false });
  body.append(list.el);

  // Show Incompatible, the iOS version or the Architecture changed (here, in the sheet or in Settings): search
  // again. A page left behind unsubscribes.
  const off = settings.onChange((key) => {
    if (!["worksOnMyPhone", "iosVersion", "arch", "device"].includes(key)) return;
    if (!body.isConnected) { off(); return; }
    run();
  });

  let timer = 0;
  async function run() {
    const q = input.value.trim();
    state.query = input.value;
    const seq = ++state.seq;
    if (!q) {
      list.setItems([]);
      note.textContent = "Package names, descriptions and authors.";
      return;
    }
    note.textContent = "";
    let rows;
    try {
      rows = await catalog.search(q, searchFilters(state.filters));
    } catch (e) {
      if (seq === state.seq) note.textContent = e.message;
      return;
    }
    if (seq !== state.seq) return; // a newer keystroke won
    body.scrollTop = 0;
    browse.rememberNames(rows);
    list.setItems(rows);
    note.textContent = rows.length ? "" : "No Results";
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 120); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); input.blur(); });
  run();
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
    box.append(choiceGroup("Source", [{ label: "All Sources" }, ...sources.map((s) => ({ label: displayName(s), value: s.key }))],
      f.source, (v) => set("source", v)));
    const groupRows = SECTION_GROUPS.map((g) => ({ label: `All ${g}`, value: `group:${g}` }));
    box.append(choiceGroup("Section", [{ label: "All Sections" }, ...groupRows, ...sections.map((s) => ({ label: s, value: s }))],
      f.section, (v) => set("section", v)));
    box.scrollTop = top;
  }
  draw();
  try {
    const [list, data] = await Promise.all([getBackend().sources(), catalog.sections(ALL)]);
    sources = list;
    sections = data.sections.map((s) => s.name);
    if (box.isConnected) draw();
  } catch {
    // no sources or sections yet: the sheet keeps its other filters
  }
}
