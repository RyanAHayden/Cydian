// The package pages the Sources and Search tabs share: a source's Sections, a package list, a package's page and
// an author's packages. Not a tab of its own: sources.js and search.js hand it the routes below them.
//
// Routes. In the Sources tab the first segment is a source key (`deb:<URI>:<dist>`, or `*` for All Sources) and
// opens its Sections; every segment after that (and every segment in the Search tab) is a token:
//   section:<name>   the packages in that section ("section:*" = All Packages)
//   package:<id>     a package's page, in the source of the route (the newest version for All Sources/Search)
//   author:<name>    every package whose Author or Maintainer is <name>
//   versions:<id>    a package's Version History (F29): every version the sources offer, or an app's versions[]
// e.g. #/sources/deb%3Ahttps%3A%2F%2Frepo.chariz.com%2F%3A.%2F/section%3ATweaks/package%3Acom.example.tweak
//
// Lists come from the catalog in the parse worker (catalog.js); long ones are virtualised (nav/vlist.js).
import { grouped, placeholder, el, segments } from "../nav/ui.js";
import { createVList, withLetterHeaders } from "../nav/vlist.js";
import { createSectionIndex } from "../nav/sectionindex.js";
import { showSheet } from "../nav/sheet.js";
import { format, settingsRoute } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog, ALL } from "../catalog.js";
import { NO_SECTION, indexLetter, parseAuthor } from "../core/catalog.js";
import { packageIcon } from "../core/sectionicons.js";
import { description, parseRelations, compareVersions } from "../core/apt.js";
import { displayName, releaseDepiction } from "../core/sources.js";
import { renderSileo, mediaUrl, reviewBody } from "./depiction.js";
import { settings, createSwitch } from "./settings.js";
import { initDevice, filterRow, compatBadge, currentDevice } from "../device.js";
import { compat, markOf, isIncompatible } from "../core/compat.js";
import { isAltKey } from "../core/altstore.js";
import { renderAltSource, renderApp, installRows, appBundleId, formatDate, osRange, appPageAction, appPageCustom } from "./altstore.js";
import { linksGroup, previewSlot } from "./altstore.js";
import { descriptionGroup } from "./description.js";
import { packageLinks, packageGithub, aptShots, sileoShots, sileoRatings, sileoWhatsNew } from "../core/previews.js";
import { storeHeader, headerLine, storeTabs, tileRow, worksOnTile, sizeTile, sectionTile, ratingTile, reviewsPane, whatsNewGroup } from "./storepage.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { signAndInstall, localSigning } from "../signing-client.js";
import { installOptions } from "../core/altstore.js";
import { ipaInstallAvailable } from "../ipa-install.js";
import { IPA_FOOTER } from "../core/ipainstall.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall } from "../core/installed.js";
import { rememberedApps } from "../app-updates.js";
import { openInGroup, setSourceShare } from "./handoff.js";
import { healthOf } from "../core/health.js";
import { addSource } from "./manage.js";
import { featuredStrip, paymentGroup, paidStateOf, soldByVendor } from "./extras.js";
import { installQueue } from "../queue.js";
import { queuedFor, MODE_LABEL } from "../core/queue.js";
import { hasRollback, rollbackSlot } from "./rollback.js";
import { autoMarkShown, AUTO_MARK_LABEL, AUTO_MARK_FOOTER } from "../core/automark.js";
import { createWishlist, wishLabel, wishRows, WISH_EMPTY } from "../core/wishlist.js";
import { filterRows } from "../core/changes.js";
import { sizeText as formatSize } from "../core/appqueue.js";
import { dailyPick, browseKind, collectionsFor, dayKey } from "../core/catalog.js";
import { readSpins, currentStreak, rouletteRow } from "./roulette.js";
import { NAME } from "../brand.js";

const ROW_HEIGHT = 58;

// Section Visibility (F24): the hidden sections live on the device (core/settings.js hiddenSections) and reach
// the worker's catalog before its next answer, so every list, Search and Changes leave them out.
catalog.setHidden(settings.hiddenSections.list());
settings.onChange((key, value) => { if (key === "hiddenSections") catalog.setHidden(value); });
// Hide by Author (F104): the same, for authors hidden from their page (core/settings.js hiddenAuthors).
catalog.setHiddenAuthors(settings.hiddenAuthors.list());
settings.onChange((key, value) => { if (key === "hiddenAuthors") catalog.setHiddenAuthors(value); });
// Works on My Phone (F17): the device and the filter reach the worker the same way.
initDevice();

// Compatibility marks (F35): Settings > Show Compatibility Marks hides them all with one attribute, so rows bound
// while scrolling never read the setting.
function applyMarks() {
  if (globalThis.document?.documentElement) document.documentElement.dataset.compatMarks = settings.get("compatMarks") ? "on" : "off";
}
applyMarks();
settings.onChange((key) => { if (key === "compatMarks") applyMarks(); });

const MARK_LABEL = { works: "Works on this iPhone", no: "Doesn't work on this iPhone", unknown: "Compatibility unknown",
  unchecked: "Not checked yet: open the app to check" }; // F160

// The mark for a row's compat code: data-mark works | no | unknown (packages.css draws it); none when unjudged.
function setMark(span, code) {
  const m = markOf(code);
  if (m) { span.dataset.mark = m; span.setAttribute("aria-label", MARK_LABEL[m]); span.setAttribute("role", "img"); }
  else { delete span.dataset.mark; span.removeAttribute("aria-label"); span.removeAttribute("role"); }
}

export function parseToken(seg) {
  const s = String(seg ?? "");
  const i = s.indexOf(":");
  const kind = i > 0 ? s.slice(0, i) : "";
  return ["section", "package", "author", "versions"].includes(kind) ? { kind, value: s.slice(i + 1) } : { kind: "unknown", value: s };
}

export const token = (kind, value) => `${kind}:${value}`;

// Names seen in lists, so a package page's title (and the next page's back button) is ready before the worker
// answers. A deep link falls back to the id.
const names = new Map();
export const rememberNames = (rows) => { for (const r of rows) names.set(r.id, r.name); };

// What a route below the tab's own root shows: { key, page: "sections" | token kind, value }.
export function pageOf(route) {
  if (route.tab === "sources") {
    const key = route.path[0];
    if (route.path.length === 1) return { key, page: "sections" };
    const t = parseToken(route.path.at(-1));
    return { key, page: t.kind, value: t.value };
  }
  const t = parseToken(route.path.at(-1));
  return { key: ALL, page: t.kind, value: t.value };
}

export function nav(route, sourceName = () => null) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": if (isAltKey(p.key)) return { title: sourceName(p.key) || "Source" }; // F9: screens/altstore.js
    return {
      title: p.key === ALL ? "Sections" : sourceName(p.key) || "Sections", style: "plain",
      right: { label: "Edit", onClick: (e) => toggleVisibility(route, e.currentTarget) },
    };
    case "section": return { title: p.value === ALL ? "All Packages" : p.value, style: "plain" };
    case "author": return { title: p.value || "Author", style: "plain" };
    // F29: Install (Modify once the page knows it's installed) opens the action sheet of what can be done here.
    case "package": return { title: names.get(p.value) || p.value,
      right: { label: "Install", onClick: (e) => packageActions(route, e.currentTarget) } };
    case "versions": return { title: "Versions" };
    default: return { title: "Not Found" };
  }
}

export function render(body, route, ctx) {
  const p = pageOf(route);
  switch (p.page) {
    case "sections": return isAltKey(p.key) ? renderAltSource(body, route, p.key) : renderSections(body, route, p.key);
    case "section": return renderList(body, route, () => catalog.list(p.key, p.value), true);
    case "author": return renderAuthor(body, route, p.value);
    case "package": return renderPackage(body, route, p.key, p.value, ctx);
    case "versions": return renderVersions(body, route, p.key, p.value);
    default:
      body.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing here." }));
  }
}

function spinner(text = "Loading Packages") {
  const p = el("div", "loading");
  p.append(el("span", "loading-spinner"), el("span", null, text));
  return p;
}

const deeper = (route, seg) => format({ tab: route.tab, path: [...route.path, seg] });

// ---- Sections (Cydia's SectionsController): "All Packages", then every section with its count -----------

// Sections pages on screen, by route, so their nav bar's Edit can find them: { body, route, key, editing, title }.
const sectionPages = new Map();

function renderSections(body, route, key) {
  for (const [k, p] of sectionPages) if (!p.body.isConnected) sectionPages.delete(k);
  const page = { body, route, key, editing: false, title: null, draw: 0 };
  sectionPages.set(format(route), page);
  return drawSections(page);
}

async function drawSections(page) {
  const { body, route, key, editing } = page;
  const turn = ++page.draw; // an Edit tapped while the worker answers: only the last draw lands
  body.replaceChildren(placeholder("list", 7));
  let data;
  try {
    await catalog.ensure();
    data = await catalog.sections(key, editing ? { hidden: true } : undefined);
  } catch (e) {
    if (turn === page.draw) body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  if (turn !== page.draw) return;
  const status = key === ALL ? null : catalog.status(key);
  const ul = el("ul", "table plain sections");
  if (editing) {
    // Cydia's edit mode: every section, hidden ones too, each with a switch (on = shown); no All Packages row.
    ul.classList.add("visibility");
    for (const s of data.sections) ul.append(visibilityRow(s));
  } else {
    ul.append(sectionRow("All Packages", data.total, deeper(route, token("section", ALL))));
    for (const s of data.sections) ul.append(sectionRow(s.name, s.count, deeper(route, token("section", s.name))));
  }
  body.replaceChildren(ul);
  if (!editing) body.prepend(filterRow(() => drawSections(page)));
  if (status?.error) body.append(el("p", "empty", status.error));
  else if (editing ? !data.sections.length : !data.total) {
    body.append(el("p", "empty", data.sections.length ? "Every section is hidden. Tap Edit to show them." : "No packages for this device."));
  }
  // F76: Share in the nav bar (the iOS 6 share sheet: Copy Link, Add on Another Device, the APT managers) took the
  // place of F8's Open In group under the sections.
  if (!editing && key !== ALL) {
    const source = await getBackend().sources().then((l) => l.find((x) => x.key === key)).catch(() => null);
    if (source && turn === page.draw && body.isConnected) {
      body.prepend(featuredStrip(source)); // F20: the source's sileo-featured.json banners, above its sections
      setSourceShare(body, source);
      body.append(grouped([{ footer: healthOf(source).label }])); // F19: last reached, last Release, Not Responding
    }
  }
}

// Edit <-> Done: the title becomes "Section Visibility" (Cydia's SECTION_VISIBILITY) and the rows turn into switches.
function toggleVisibility(route, button) {
  const page = sectionPages.get(format(route));
  if (!page || !page.body.isConnected) return;
  page.editing = !page.editing;
  button.textContent = page.editing ? "Done" : "Edit";
  button.classList.toggle("done", page.editing);
  const h1 = button.closest(".nav-item")?.querySelector(".nav-title");
  if (h1) {
    if (page.editing) { page.title = h1.textContent; h1.textContent = "Section Visibility"; }
    else if (page.title != null) h1.textContent = page.title;
  }
  drawSections(page);
}

function visibilityRow(s) {
  const li = el("li", "cell section-row");
  const inner = el("div", "cell-inner has-switch");
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", s.count > 9999 ? `${Math.floor(s.count / 1000)}k` : String(s.count)));
  inner.append(folder, el("span", "cell-label", s.name), createSwitch({
    label: `Show ${s.name}`, checked: !s.hidden,
    onToggle: (on) => settings.hiddenSections.set(s.name, !on),
  }));
  li.append(inner);
  return li;
}

function sectionRow(name, count, href) {
  const li = el("li", "cell section-row");
  const a = el("a", "cell-inner chevron");
  a.href = href;
  const folder = el("span", "folder");
  folder.append(el("span", "folder-count", count > 9999 ? `${Math.floor(count / 1000)}k` : String(count)));
  a.append(folder, el("span", "cell-label", name));
  li.append(a);
  return li;
}

// ---- package lists ---------------------------------------------------------------------------------------

const iconOk = new Set();  // icon URLs that loaded once: shown at once when their row comes back
const iconBad = new Set(); // and those that failed: never asked again

// F126, Cydia's PackageCell: the section's icon (else unknown.png) until the package's own icon loads, and a small
// badge in the bottom-right corner (core/sectionicons.js packageIcon: the purpose:: tag's, else the section's on
// an own icon). `art` holds the icon and the badge, which hangs over the icon's corner as in Cydia.
function createArt(large = false) {
  const art = el("span", large ? "pkg-art large" : "pkg-art");
  const icon = el("span", large ? "pkg-icon cy large" : "pkg-icon cy");
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  const badge = el("img", "pkg-badge");
  badge.alt = "";
  badge.hidden = true;
  icon.append(img);
  art.append(icon, badge);
  return { art, icon, img, badge };
}

// Fallback and badge for `item`; the own icon's <img> is the caller's (lists load it only once scrolling stops).
function paintArt(r, item) {
  const look = packageIcon(item);
  if (r.icon.dataset.fallback !== look.fallback) {
    r.icon.dataset.fallback = look.fallback;
    r.icon.style.backgroundImage = `url("${look.fallback}")`;
  }
  const badge = look.badgeKind === "section" && iconBad.has(item.icon) ? null : look.badge;
  r.badge.hidden = !badge;
  r.badge.classList.toggle("section", look.badgeKind === "section");
  if (badge && r.badge.dataset.url !== badge) { r.badge.dataset.url = badge; r.badge.src = badge; }
}

function createRow() {
  const row = el("div", "pkg-row");
  const a = el("a", "cell-inner pkg");
  const { art, icon, img, badge } = createArt();
  img.onload = () => { iconOk.add(img.dataset.url); img.classList.add("loaded"); art.classList.add("own"); };
  img.onerror = () => { iconBad.add(img.dataset.url); img.removeAttribute("src"); badge.classList.contains("section") && (badge.hidden = true); };
  const text = el("span", "pkg-text");
  const top = el("span", "pkg-top");
  const compatEl = el("span", "compat-mark"); // F35: the check, X or ? (F17's text badge is on the package page)
  top.append(el("span", "pkg-name"), compatEl, el("span", "pkg-version"));
  text.append(top, el("span", "pkg-desc"));
  a.append(art, text);
  row.append(a);
  row._ = { a, art, icon, img, badge, name: top.firstChild, compat: compatEl, version: top.lastChild, desc: text.lastChild };
  return row;
}

function iconSrc(item) {
  if (!item.icon || iconBad.has(item.icon)) return null;
  return mediaUrl(item.icon);
}

function bindRow(row, item, route) {
  const r = row._;
  row._item = item;
  row.dataset.id = item.id;
  r.a.href = deeper(route, token("package", item.id));
  r.name.textContent = item.name;
  r.version.textContent = item.version;
  // Works on my phone (F17): the worker's code for this row, drawn as a mark (F35); rows never judged get none.
  setMark(r.compat, item.compat);
  // Search's exact match that can't work (F35): its name in red, the reason in place of the description.
  const flagged = Boolean(item.exact && isIncompatible(item.compat));
  r.name.classList.toggle("incompatible", flagged);
  r.desc.textContent = flagged && item.why ? item.why : item.short;
  markQueued(row);
  paintArt(r, item);
  const src = iconSrc(item);
  // Icons only load once scrolling stops (idle), unless this one already loaded: a fling starts no fetches.
  if (src && iconOk.has(item.icon)) {
    if (r.img.dataset.url !== item.icon) { r.img.dataset.url = item.icon; r.img.src = src; }
    r.img.classList.add("loaded");
    r.art.classList.add("own");
  } else {
    r.img.classList.remove("loaded");
    r.art.classList.remove("own");
    if (r.img.dataset.url) { r.img.removeAttribute("src"); delete r.img.dataset.url; }
  }
}

// N4: a queued package's row says so at once, in every list (Zebra #1992, #1892): Cydia's "Queued for <mode>" in
// place of the description, and data-queued for queue.css's tint. Rows on screen are redrawn on every change.
function markQueued(row) {
  const item = row._item;
  if (!item) return;
  const job = installQueue.get(item.id);
  if (job) row.dataset.queued = job.mode; else delete row.dataset.queued;
  if (job) row._.desc.textContent = queuedFor(job.mode);
  else if (row._.desc.textContent.startsWith("Queued for ")) {
    const flagged = Boolean(item.exact && isIncompatible(item.compat));
    row._.desc.textContent = flagged && item.why ? item.why : item.short;
  }
}

// The package page's "Package Queue" row (Cydia's), shown while the package is queued.
function fillQueueSlot(slot) {
  const job = installQueue.get(slot.dataset.id);
  slot.replaceChildren(job ? grouped([{ header: "Package Queue", rows: [{ label: MODE_LABEL[job.mode] + (job.version && job.mode !== "remove" ? ` ${job.version}` : ""),
    detail: "Queued" }], footer: "Confirm from the Installed tab's Queue button, or tap Modify > Clear." }]) : "");
}

installQueue.subscribe(() => {
  if (!globalThis.document) return;
  for (const row of document.querySelectorAll(".pkg-row[data-id]")) markQueued(row);
  for (const slot of document.querySelectorAll(".package-queue-slot[data-id]")) fillQueueSlot(slot);
});

function loadIcon(row, item) {
  const src = iconSrc(item);
  if (!src || row._.img.dataset.url === item.icon) return;
  row._.img.dataset.url = item.icon;
  row._.img.src = src;
}

// A virtualised package list. `letters`: Cydia's A–Z headers (lists sorted by name; search results aren't).
// `rows` may hold { header } items of their own when `letters` is off. `decorate(row, item)` runs after each bind.
export function packageList(body, route, rows, { letters = true, decorate = null } = {}) {
  rememberNames(rows.filter((r) => r.id));
  const items = letters ? withLetterHeaders(rows, (r) => indexLetter(r.name)) : rows;
  const list = createVList(body, {
    items, rowHeight: ROW_HEIGHT, headerHeight: 23,
    createRow,
    bindRow: (row, item) => { bindRow(row, item, route); decorate?.(row, item); },
    idle: loadIcon,
  });
  list.el.classList.add("pkg-vlist"); // placeholder rows show through wherever real rows aren't drawn yet
  // Sorted by name with A–Z headers: Cydia's index down the right edge, instead of the scroll indicator.
  if (letters && body.parentElement) createSectionIndex(body, list);
  return list;
}

// Exported for Home's Browse (F46).
async function renderList(body, route, fetchRows, letters) {
  body.append(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    rows = await fetchRows();
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  body.replaceChildren();
  if (!rows.length) { body.append(el("p", "empty", "No packages.")); return; }
  const list = packageList(body, route, rows, { letters });
  body.append(list.el);
}

// F124: Browse's lists (New, Recently Updated, Popular, Featured, Free..., a category): the grey search bar, then the
// package list, filtered as you type (name, id, description, author: core/changes.js filterRows). `letters`: A–Z
// headers (lists by name); else `headers(rows)` may return the items with { header } rows of its own (New's days).
export async function renderSearchableList(body, route, fetchRows, { letters = false, headers = null, empty = "No packages.", label = "Search this list" } = {}) {
  const bar = listSearchBar(label);
  const note = el("p", "empty");
  note.hidden = true;
  const ph = placeholder("list");
  body.append(bar.el, note, ph);
  let rows;
  try {
    await catalog.ensure();
    rows = await fetchRows();
  } catch (e) {
    ph.remove();
    note.textContent = e.message;
    note.hidden = false;
    return;
  }
  ph.remove();
  const itemsFor = (rs) => (letters ? withLetterHeaders(rs, (r) => indexLetter(r.name)) : headers ? headers(rs) : rs);
  const shown = (q) => filterRows(rows, { query: q });
  let list = null;
  const draw = (q) => {
    const rs = shown(q);
    note.textContent = rs.length ? "" : q.trim() ? "No packages match your search." : empty;
    note.hidden = rs.length > 0;
    rememberNames(rs);
    if (!list) {
      list = packageList(body, route, letters ? rs : itemsFor(rs), { letters }); // packageList adds the letters itself
      body.append(list.el);
    } else list.setItems(itemsFor(rs));
  };
  draw(bar.input.value);
  bar.onQuery(draw);
}

// The grey search bar alone (Changes' and Search's look, packages.css), for a list's own filter.
function listSearchBar(label) {
  const form = el("form", "search-bar list-search");
  form.setAttribute("role", "search");
  const field = el("label", "search-field");
  const input = document.createElement("input");
  Object.assign(input, { type: "search", placeholder: "Search", autocapitalize: "off", autocomplete: "off", spellcheck: false, enterKeyHint: "search" });
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", label);
  field.append(input);
  form.append(field);
  let handler = () => {};
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => handler(input.value), 120); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); handler(input.value); input.blur(); });
  return { el: form, input, onQuery: (f) => { handler = f; } };
}

// ---- Wish List (F102) --------------------------------------------------------------------------------------

// The device's Wish List (core/wishlist.js), made on first use.
let wishes = null;
export const wishlist = () => (wishes ??= createWishlist());

// Home's Wish List page: the wished packages the sources carry, as a plain package list; installed ones drop off the
// list for good (dpkg's status in the app, the uploaded one on the site; nothing drops where neither is known).
export async function renderWishlist(body, route) {
  body.append(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    const installed = ((await catalog.installed().catch(() => null)) ?? []).map((r) => r.id);
    wishlist().prune(installed);
    const ids = wishlist().list();
    const found = await Promise.all(ids.map((id) => catalog.package(id).then((p) => (p && !p.installedOnly ? p.row : null), () => null)));
    rows = wishRows(ids, found, installed);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  body.replaceChildren();
  if (!rows.length) { body.append(el("p", "empty", WISH_EMPTY)); return; }
  const list = packageList(body, route, rows, { letters: false });
  body.append(list.el);
}

// F104: an author's page: a Hide (or Show) Packages by <author> row, then their packages, which author() lists
// even while hidden. Manage > Hidden lists the hidden ones too.
export function authorToggleRow(name, hiddenNow) {
  return { label: `${hiddenNow ? "Show" : "Hide"} Packages by ${name}`, chevron: false };
}

// A list drawn again in the same page: the old one stops listening, and its A–Z index goes (packageList adds one).
const authorLists = new WeakMap();
export function dropList(body, list) {
  list?.destroy();
  for (const ix of body.parentElement?.querySelectorAll(":scope > .section-index") ?? []) ix.remove();
  delete body.dataset.sectionIndex;
}

async function renderAuthor(body, route, name) {
  dropList(body, authorLists.get(body));
  authorLists.delete(body);
  body.replaceChildren(placeholder("list"));
  let rows;
  try {
    await catalog.ensure();
    rows = await catalog.author(name);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  body.replaceChildren();
  // The row goes in before the list, which measures where it starts (vlist.js); a tap redraws the page.
  if (name) {
    const hiddenNow = settings.hiddenAuthors.has(name);
    const g = grouped([{ rows: [{ ...authorToggleRow(name, hiddenNow), onClick: () => {
      settings.hiddenAuthors.set(name, !hiddenNow);
      renderAuthor(body, route, name);
    } }], footer: hiddenNow ? "Hidden everywhere else: lists, Search and Changes." : null }]);
    g.classList.add("author-hide");
    body.append(g);
  }
  if (!rows.length) { body.append(el("p", "empty", "No packages.")); return; }
  const list = packageList(body, route, rows);
  authorLists.set(body, list);
  body.append(list.el);
}

// ---- the package page --------------------------------------------------------------------------------------

const httpUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

async function renderPackage(body, route, key, id, ctx) {
  body.append(placeholder("page"));
  let pkg, sources;
  try {
    await catalog.ensure();
    [pkg, sources] = await Promise.all([catalog.package(id, key), getBackend().sources()]);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  if (!pkg) {
    body.replaceChildren(grouped([{ rows: [{ label: "Package not found" }], footer: id }]));
    return;
  }
  const st = pkg.stanza;
  if (st.kind === "ipa" && st.ipa) { // F9: an AltStore app
    names.set(id, st.name);
    setTitle(body, st.name);
    const altSrc = sources.find((s) => s.key === pkg.key);
    // F181: its Related tab is the same as a package's: the source's other apps in that category.
    const { details } = renderApp(body, route, pkg, altSrc, { related: (pane) => relatedPane(pane, route, pkg, id) });
    if (detectMode() === "jailbreak") installedAppGroup(st.ipa.bundleIdentifier).then((g) => { if (g && details.isConnected) details.append(g); });
    rememberPackage(body, route, { id, pkg, source: altSrc, history: await catalog.history(id, key).catch(() => null) });
    return;
  }
  const sourceOf = (k) => sources.find((s) => s.key === k);
  const source = sourceOf(pkg.key);
  const sourceName = source ? displayName(source) : "";
  const desc = description(st);
  const name = st.name || st.package;
  names.set(id, name);
  setTitle(body, name);

  // F181: the iOS 6 App Store's header (screens/storepage.js): the large glossy icon, name, author, stars once a
  // rating is known, and "Version · size · price". Install / Modify stays the nav bar's right button.
  const art = createArt(true);
  paintArt(art, { ...pkg.row, icon: st.iconUrl ?? pkg.row.icon });
  const src = st.iconUrl && mediaUrl(st.iconUrl);
  if (src) {
    art.img.onload = () => { art.img.classList.add("loaded"); art.art.classList.add("own"); };
    art.img.onerror = () => { art.img.remove(); if (art.badge.classList.contains("section")) art.badge.hidden = true; };
    art.img.src = src;
  } else art.img.remove();
  // Works on my phone (F17): judged here from the stanza, so an installed-only page gets one too.
  const fit = compat(st, currentDevice());
  const fitCode = fit.status === "no" ? fit.reason : fit.status;
  const headMark = el("span", "compat-mark large");
  setMark(headMark, fitCode);
  const headAuthor = parseAuthor(st.author) || parseAuthor(st.maintainer);
  const size = formatSize(st.size);
  const header = storeHeader({ art: art.art, name, mark: headMark, author: headAuthor?.name ?? null,
    authorHref: headAuthor ? deeper(route, token("author", headAuthor.name)) : null, // F29: opens their packages
    line: headerLine({ version: st.version, size, price: pkg.installedOnly ? null : isPaid(st) ? "Paid" : "Free" }) });

  // Depiction: Sileo JSON drawn natively in Details; else an HTML depiction in a sheet, and the description. A package
  // with no Depiction: of its own gets the source's Release template (Cydia's fallback; an own non-http one
  // still counts as having one, so it gets neither).
  const sileo = httpUrl(st.sileodepiction);
  const html = st.depiction?.trim() ? httpUrl(st.depiction) : releaseDepiction(source, st.package || id);
  // One fetch of the Sileo JSON for the Details body, What's New, the stars and the Reviews tab (F181).
  const sileoJson = sileo ? getBackend().text(sileo).then((t) => JSON.parse(t)).catch(() => null) : Promise.resolve(null);
  const ratingOf = (json) => (json ? sileoRatings(json) : null);
  sileoJson.then((json) => { if (body.isConnected) header.setRating(ratingOf(json)); });
  const descText = desc.long || desc.short;

  const tabs = storeTabs({
    reviews: async (pane) => {
      if (sileo) pane.replaceChildren(spinner("Loading Reviews"));
      const r = ratingOf(await sileoJson);
      reviewsPane(pane, { rating: r, reviews: r?.reviews ?? [], renderText: (rv) => reviewBody(rv, { open: openSileoSheet }),
        footer: r ? "Ratings and reviews from the package's depiction, as its source wrote them." : "Its source gives no ratings or reviews for this package." });
    },
    related: (pane) => relatedPane(pane, route, pkg, id),
  });
  const details = tabs.panes.details;
  body.replaceChildren(header.head, ...tabs.nodes);

  // Depends (and Pre-Depends): each line links to the first alternative we carry.
  const rels = [...parseRelations(st["pre-depends"]), ...parseRelations(st.depends)];
  const known = new Set(rels.length ? await catalog.has([...new Set(rels.flat().map((r) => r.name))]) : []);
  // F18: what stops it installing, in plain words; its `targets` also link a virtual name to its provider.
  const depReport = await catalog.deps(id, key).catch(() => null);
  const depRows = rels.map((group) => {
    const text = group.map((r) => r.name + (r.op ? ` (${r.op} ${r.version})` : "")).join(" | ");
    const target = group.find((r) => known.has(r.name));
    const via = !target && group.map((r) => depReport?.targets?.[r.name]).find(Boolean);
    if (via) return { label: text, href: deeper(route, token("package", via)) };
    return target ? { label: text, href: deeper(route, token("package", target.name)) } : { label: text, chevron: false };
  });
  const conflicts = parseRelations(st.conflicts).map((g) => ({ label: g.map((r) => r.name + (r.op ? ` (${r.op} ${r.version})` : "")).join(" | ") }));

  // Source, other versions, and (on the site) the .deb through the proxy.
  const srcRows = [{ label: sourceName || "Unknown Source", subtitle: source?.uri }];
  for (const o of pkg.others) {
    if (o.key === pkg.key) continue;
    const s = sourceOf(o.key);
    srcRows.push({ label: s ? displayName(s) : o.key, detail: o.version,
      href: format({ tab: "sources", path: [o.key, token("package", id)] }) });
  }

  // F20: price; in the app Sign In, Buy, Install. B11: in the app its state also drives the nav bar button.
  const payBox = pkg.installedOnly ? null : paymentGroup(st, source, ctx, { onState: (s) => paidButton(body, s) });
  if (payBox) details.append(payBox);
  // F122: the gallery (Screenshots:/Header:, a Sileo depiction's screenshots, else the HTML depiction's pictures or
  // the GitHub repo's), sideways with page dots and tap-to-zoom (F181, altstore.js galleryGroup).
  const previews = el("div", "package-previews");
  details.append(previews);
  const previewKey = `pkg:${pkg.key ?? "installed"}:${st.package || id}`;
  const drawPreviews = (json) => previews.replaceChildren(previewSlot(previewKey, {
    shots: [...aptShots(st), ...(json ? sileoShots(json) : [])],
    html: sileo ? null : html,
    gh: packageGithub(st, json),
  }));
  if (!sileo) drawPreviews(null);

  // F181: the sideways info tiles: Rating (once known), Works On, Size, Section.
  const tiles = tileRow();
  tiles.set("works", worksOnTile(fit));
  tiles.set("size", sizeTile(size));
  tiles.set("section", sectionTile(pkg.row.section === NO_SECTION ? null : pkg.row.section, { rootless: "Rootless", rootful: "Rootful", roothide: "Roothide" }[fit.need] ?? null));
  details.append(tiles.row);
  sileoJson.then((json) => tiles.set("rating", ratingTile(ratingOf(json))));

  // Description, or the Sileo depiction as Details' body (its reviews go to the Reviews tab, its pictures to the
  // gallery).
  const depictionSlot = el("div", "depiction-slot");
  details.append(depictionSlot);
  if (!sileo && descText) depictionSlot.append(descriptionGroup(descText)); // F165: own group, long ones fold behind More

  // What's New (a Sileo depiction's newest changelog entry) with Version History (F29) under it.
  const news = el("div", "store-news-slot");
  details.append(news);

  // Information: who, where from, what it is and needs, and where it runs.
  const info = [];
  const author = parseAuthor(st.author);
  const maint = parseAuthor(st.maintainer);
  if (author) info.push({ label: "Developer", detail: author.name, href: deeper(route, token("author", author.name)) });
  if (maint && maint.name.toLowerCase() !== author?.name.toLowerCase()) {
    info.push({ label: author ? "Maintainer" : "Contact", detail: maint.name, href: deeper(route, token("author", maint.name)) });
  }
  if (!pkg.installedOnly) {
    info.push({ label: "Source", detail: sourceName || "Unknown",
      href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) });
  }
  info.push({ label: "Package", detail: st.package });
  info.push({ label: "Version", detail: st.version ?? "" });
  const inst = Number(st["installed-size"]);
  if (inst > 0) info.push({ label: "Installed Size", detail: formatSize(inst * 1024) });
  if (st.architecture) info.push({ label: "Architecture", detail: st.architecture });
  if (rels.length) info.push({ label: "Depends", detail: rels.map((g) => g[0].name).join(", "), cls: "store-info-long" });
  info.push({ label: "Compatibility", detail: fit.range ?? compatBadge(fitCode) });
  details.append(grouped([{ header: "Information", rows: info, footer: fit.detail }]));

  // More by the author, the HTML depiction, and Support: the Links group (the source, Homepage:, GitHub, a Sileo
  // depiction's buttons).
  const more = [];
  if (headAuthor) more.push({ label: `More by ${headAuthor.name}`, href: deeper(route, token("author", headAuthor.name)) });
  if (html) more.push({ label: "Depiction", onClick: () => openHtmlDepiction(html, name), chevron: true });
  if (more.length) details.append(grouped([{ rows: more }]));
  const sourceLink = pkg.installedOnly ? null : { label: sourceName || "Unknown Source", subtitle: source?.uri,
    href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) };
  const links = el("div", "package-links");
  const drawLinks = (json) => {
    const list = packageLinks(st, json);
    links.replaceChildren(...(sourceLink || list.length ? [linksGroup(sourceLink, list)] : []));
  };
  drawLinks(null);
  details.append(links);

  // F29: Version History, every version the sources offer (Downgrade's list); and Modify once it's installed.
  const history = await catalog.history(id, key).catch(() => null);
  rememberPackage(body, route, { id, key, pkg, source, history, payBox });
  const drawNews = (json) => {
    const notes = json ? sileoWhatsNew(json) : null;
    const row = history?.versions.length ? versionHistoryCell(route, id, history) : null;
    const g = whatsNewGroup({ version: notes ? notes.title || st.version : null, notes: notes?.text || null, history: row });
    news.replaceChildren(...(g ? [g] : []));
  };
  drawNews(null);
  if (queueOf()) {
    const slot = el("div", "package-queue-slot");
    slot.dataset.id = st.package || id;
    fillQueueSlot(slot);
    details.append(slot);
  }
  const installedEl = await installedGroup(st.package || id);
  if (installedEl) details.append(installedEl);
  // F71: the copies N7's daemon kept, filled in when the helper answers (screens/rollback.js).
  if (installedEl && hasRollback()) details.append(rollbackSlot(st.package || id, { installed: installedOf(history), name: pkg.row?.name }));
  if (depReport?.problems.length) details.append(depProblemsGroup(depReport, route, ctx));
  if (depRows.length) details.append(grouped([{ header: "Depends", rows: depRows }]));
  if (conflicts.length) details.append(grouped([{ header: "Conflicts", rows: conflicts }]));
  // An installed package no source carries (F27) has no source to name: its page is the status stanza alone.
  if (!pkg.installedOnly) details.append(grouped([{ header: pkg.others.length > 1 ? "Sources" : "Source", rows: srcRows }]));
  // F8: Open In, the package in another package manager (and its source from another device).
  if (!pkg.installedOnly && source) details.append(openInGroup(source, { pkg: st.package || id }));
  if (st.debUrl && getBackend().kind === "http") {
    // Paid packages (cydia::commercial) only download for a buyer's device: the repo refuses the proxy.
    if (/(^|,)\s*cydia::commercial\s*(,|$)/.test(st.tag ?? "")) details.append(grouped([{ footer: "A paid package: buy and install it from a package manager on the phone." }]));
    else details.append(downloadGroup(st));
  }
  details.append(grouped([{ footer: `${st.package}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));

  if (sileo) {
    loadSileo(depictionSlot, sileo, { fallback: descText, json: sileoJson }).then((json) => {
      if (!previews.isConnected) return;
      // The gallery shows the depiction's screenshots (F122), so its own strip goes; the Reviews tab its reviews.
      if (json && sileoShots(json).length) for (const strip of depictionSlot.querySelectorAll(".dep-shots")) strip.remove();
      if (json && sileoRatings(json)?.reviews.length) for (const rv of depictionSlot.querySelectorAll(".dep-review")) rv.remove();
      drawLinks(json);
      drawPreviews(json);
      drawNews(json);
    });
  }
}

// F181: the Related tab: other packages in the same section from the same source (All Sources: from every source),
// as a plain list of up to RELATED rows; none when the package has no section.
const RELATED = 50;
async function relatedPane(pane, route, pkg, id) {
  const section = pkg.row?.section;
  if (!section || section === NO_SECTION || pkg.installedOnly) {
    pane.replaceChildren(el("p", "empty", "No related packages."));
    return;
  }
  pane.replaceChildren(spinner("Loading Packages"));
  let rows;
  try { rows = await catalog.list(pkg.key ?? ALL, section); } catch (e) { pane.replaceChildren(el("p", "empty", e.message)); return; }
  rows = rows.filter((r) => r.id !== id);
  if (!rows.length) { pane.replaceChildren(el("p", "empty", `Nothing else in ${section}.`)); return; }
  pane.replaceChildren(grouped([{ header: `More in ${section}`, rows: rows.slice(0, RELATED).map((r) => ({
    label: r.name, subtitle: r.short || null, href: deeper(route, token("package", r.id)), cls: "store-related-row",
    icon: { text: (r.name || "?").charAt(0).toUpperCase(), src: r.icon ? mediaUrl(r.icon) : null, cls: "store-related-icon" },
  })), footer: rows.length > RELATED ? `${RELATED} of ${rows.length}: all of them are in ${section}.` : null }]));
  if (rows.length > RELATED) pane.append(grouped([{ rows: [{ label: `All of ${section}`, href: deeper(route, token("section", section)) }] }]));
}

// ---- Install / Modify and Version History (F29) ------------------------------------------------------------
//
// Cydia's nav bar button: Install, or Modify when the package is installed (ref/4s/screens/cydia-package-top.png),
// opening an action sheet (cydia-package-modify.png: Reinstall, Remove, Downgrade; Downgrade then lists the
// older versions, cydia-package-downgrade.png). The install queue is N4's: a backend that has one exposes
// `queue({ op: "install" | "remove", id, version })` and the sheet offers those; until then it offers what works
// here: the Version History page, the .deb on the site, and an AltStore app's install rows.

// Package pages on screen, by route, for their nav bar button: { body, route, id, pkg, source, history }.
const packagePages = new Map();

function rememberPackage(body, route, page) {
  for (const [k, p] of packagePages) if (!p.body.isConnected) packagePages.delete(k);
  packagePages.set(format(route), { body, route, ...page });
  const installed = page.pkg.stanza.kind !== "ipa" && page.history?.versions.some((v) => v.installed);
  setRightLabel(body, buttonLabel(body, installed));
}

// B11: a paid package a vendor sells (extras.js paidNav) shows its price on the button until it's bought, as Cydia
// did; Install once the vendor lets this account download it; Modify once it's installed, as for any package.
const paidLabels = new WeakMap(); // page body -> label
const buttonLabel = (body, installed) => installed ? "Modify" : paidLabels.get(body) ?? "Install";
function paidButton(body, state) {
  if (state) paidLabels.set(body, state.label);
  else paidLabels.delete(body);
  const page = [...packagePages.values()].find((p) => p.body === body);
  if (page) setRightLabel(body, buttonLabel(body, page.history?.versions.some((v) => v.installed)));
}

// N11: a run (install, upgrade, remove) re-reads dpkg (catalog.reloadInstalled), which fires catalog.onChange. A
// package page left open under the console kept saying Install after its package went in (and Modify after it was
// removed) until it was opened again (iPhone 7). Each APT page on screen asks for its Version History again, so the
// nav bar button and Modify's sheet follow what is installed now. AltStore pages keep their own state (altstore.js).
export async function refreshPackagePages(pages = packagePages, { history = (id, key) => catalog.history(id, key ?? ALL),
  label = setRightLabel } = {}) {
  for (const [k, p] of [...pages]) {
    if (!p.body.isConnected) { pages.delete(k); continue; }
    if (p.pkg.stanza.kind === "ipa") continue;
    const h = await history(p.id, p.key).catch(() => null);
    if (!h || !p.body.isConnected) continue;
    p.history = h;
    label(p.body, buttonLabel(p.body, h.versions.some((v) => v.installed)));
  }
}
catalog.onChange(() => { refreshPackagePages().catch(() => {}); });

const installedOf = (history) => history?.versions.find((v) => v.installed)?.version ?? null;
// N4: `extra` ({ installed, name }) goes with every job, so the queue knows the mode (Reinstall, Downgrade...) at once.
const queueOf = (extra = {}) => { const b = getBackend(); return typeof b.queue === "function" ? (job) => b.queue({ ...extra, ...job }) : null; };
const isPaid = (st) => /(^|,)\s*cydia::commercial\s*(,|$)/.test(st?.tag ?? "");
const versionsHref = (route, id) => deeper(route, token("versions", id));
const go = (href) => { location.hash = href.replace(/^#/, ""); };

function downloadDeb(url, name) {
  const a = document.createElement("a");
  a.href = getBackend().assetUrl(url);
  a.download = decodeURIComponent(url.split("/").pop() || `${name}.deb`);
  document.body.append(a);
  a.click();
  a.remove();
}

// F30's record of an installed app (as renderApp does for its Install rows). F88: in the jailbreak app too, where
// installRows runs it on the helper's success.
function recordApp(pkg, source, v) {
  const app = pkg.stanza.ipa;
  return () => {
    apps().then((store) => recordInstall(store, { id: app.bundleIdentifier, name: app.name, version: v.version, key: pkg.key,
      source: app.sourceUrl, sourceName: app.sourceName || (source ? displayName(source) : ""), icon: app.iconURL })).catch(() => {});
  };
}

// An action sheet over [{ label, run }]; runs the tapped one.
async function sheet(title, actions) {
  const i = await showActionSheet({ title, buttons: actions.map((a) => a.label) });
  if (i >= 0) actions[i].run();
}

async function packageActions(route, button) {
  const page = packagePages.get(format(route));
  if (!page || !page.body.isConnected) return;
  const { id, pkg, source, history } = page;
  const st = pkg.stanza;
  const many = (history?.versions.length ?? 0) > 1;
  const actions = [];
  if (st.kind === "ipa" && st.ipa) {
    const v = st.ipa.versions[0];
    // F80: Install / Upgrade / Reinstall queue the app and open Confirm; Modify while it's queued (altstore.js).
    if (await appPageAction(pkg, source)) return;
    // I5: in the sideload app Install signs this app on the phone and installs it.
    if (await signIfReady(st.ipa, v, recordApp(pkg, source, v))) return;
    // Install at the top right installs: the first row (the source's signed link, or the jailbreak). Download IPA and
    // older versions are on the page, not in a menu in between. On the website the first row is Install (F92: the
    // certificate alert until F93's browser signing).
    const { rows, options } = installRows(v, st.ipa.sourceUrl, undefined, recordApp(pkg, source, v), undefined, st.ipa.name,
      { bundleId: appBundleId(st.ipa, pkg.row?.id ?? id) });
    if (rows[0] && rows[0].label !== "Download IPA") return rows[0].onClick();
    for (const r of rows) actions.push({ label: r.label, run: r.onClick });
    if (many) actions.push({ label: "Version History", run: () => go(versionsHref(route, id)) });
    return sheet(options.itms ? "" : "Download IPA keeps the file.", actions);
  }
  const installed = installedOf(history);
  const queue = queueOf({ installed, name: pkg.row?.name });
  // B11: apt can't fetch a paid package its vendor sells, so the sheet offers the Purchase group's step instead.
  const paid = queue ? await paidStateOf(page.payBox) : null;
  if (paid) {
    if (!page.body.isConnected) return;
    const { actions: paidSheet, title } = paidActions(paid, { id: st.package || id, version: st.version, installed, queue,
      queued: !!installQueue.get(st.package || id) });
    return sheet(title, paidSheet);
  }
  const older = installed ? history.versions.filter((v) => v.keys.length && compareVersions(v.version, installed) < 0) : [];
  // Cydia's first action on a queued package: Clear (N4).
  if (queue && installQueue.get(st.package || id)) actions.push({ label: "Clear", run: () => installQueue.clear(st.package || id) });
  if (queue) {
    if (installed) {
      // Cydia's order: Upgrade or Reinstall (only what a source can download), then Remove, then Downgrade.
      const newest = history.versions.find((v) => v.keys.length);
      if (newest && compareVersions(newest.version, installed) > 0) actions.push({ label: "Upgrade", run: () => queue({ op: "install", id, version: newest.version }) });
      if (history.versions.some((v) => v.installed && v.keys.length)) actions.push({ label: "Reinstall", run: () => queue({ op: "install", id, version: installed }) });
      actions.push({ label: "Remove", run: () => queue({ op: "remove", id }) });
      if (older.length) actions.push({ label: "Downgrade", run: () => sheet("", older.map((v) => ({ label: v.version, run: () => queue({ op: "install", id, version: v.version }) }))) });
    } else {
      actions.push({ label: "Install", run: () => queue({ op: "install", id, version: st.version }) });
    }
  } else if (installed && older.length) {
    actions.push({ label: "Downgrade", run: () => go(versionsHref(route, id)) });
  }
  if (many && !(installed && older.length)) actions.push({ label: "Other Versions", run: () => go(versionsHref(route, id)) });
  // The website: a jailbroken phone's iFizBox installs it with apt (cydian://package, websign-gate.js), so nobody has to
  // download a .deb (user 2026-11-18); Download .deb stays below for other package managers.
  if (getBackend().kind === "http" && (st.package || id)) {
    actions.push({ label: `Install in ${NAME}`, run: () => import("../websign-gate.js").then((g) => { location.href = g.packageLink(st.package || id); }) });
  }
  if (st.debUrl && getBackend().kind === "http" && !isPaid(st)) actions.push({ label: "Download .deb", run: () => downloadDeb(st.debUrl, st.package) });
  // F102: Add to Wish List while it isn't installed; Remove from Wish List whenever it is on the list.
  const wishId = st.package || id;
  if (!installed || wishlist().has(wishId)) actions.push({ label: wishLabel(wishlist().has(wishId)), run: () => wishlist().set(wishId, !wishlist().has(wishId)) });
  const title = queue ? "" : getBackend().kind === "http"
    ? `Packages install on the iPhone, from ${NAME}'s jailbreak app or another package manager.`
    : `Installing from ${NAME} comes with its install queue, which this build doesn't have yet.`;
  return sheet(title, actions);
}

// B11: the nav bar sheet of a paid package its vendor sells, in the app (`paid`: extras.js paidNav). Not installed:
// the Purchase group's step (Sign In, Buy, Download & Install). Installed: Upgrade or Reinstall through Download &
// Install (it fetches the page's version, `version`) once bought, and Remove through the queue; no Downgrade, since
// the vendor only hands out the current deb. Add to / Remove from Wish List as for any package.
export function paidActions(paid, { id, version, installed, queue, queued = false, wish = wishlist() }) {
  const actions = [];
  if (queued) actions.push({ label: "Clear", run: () => installQueue.clear(id) });
  if (installed) {
    if (paid.install && version && compareVersions(version, installed) > 0) actions.push({ label: "Upgrade", run: paid.install });
    else if (paid.install && version === installed) actions.push({ label: "Reinstall", run: paid.install });
    actions.push({ label: "Remove", run: () => queue({ op: "remove", id }) });
  } else {
    actions.push(...paid.actions);
  }
  if (!installed || wish.has(id)) actions.push({ label: wishLabel(wish.has(id)), run: () => wish.set(id, !wish.has(id)) });
  return { actions, title: installed && paid.install ? "" : paid.note ?? "" };
}

// I5: in the sideload app, sign `v` on the phone and install it when the version has an IPA. True when signing took
// over (whatever its outcome: errors are shown in an alert). False elsewhere: nothing else signs (F89).
async function signIfReady(app, v, record) {
  const url = installOptions(v, app.sourceUrl).download;
  // F75: Install goes straight to signAndInstall, which opens the Signing walkthrough at the missing step when the
  // certificate or the server isn't there yet (no sheet first, no alert)
  if (!url || !localSigning()) return false;
  await signAndInstall({ url, name: app.name, onInstalled: () => record?.() });
  return true;
}

// The package page's row to its Version History: how many versions are on offer.
// Version History's row (F29), for the What's New card (F181, screens/storepage.js whatsNewGroup).
export function versionHistoryCell(route, id, history) {
  const n = history.versions.filter((v) => (history.kind === "ipa" ? true : v.keys.length)).length;
  return { label: "Version History", detail: n === 1 ? "1 version" : `${n} versions`, href: versionsHref(route, id) };
}

// One version's cell: version (and build), its tags, the detail on the right, a line under it, release notes.
function versionCell({ label, tags = [], detail = null, sub = null, notes = null, onClick = null, unavailable = false }) {
  const li = el("li", "cell version-row");
  if (unavailable) li.classList.add("unavailable");
  const inner = el(onClick ? "button" : "div", "cell-inner");
  if (onClick) { inner.type = "button"; inner.addEventListener("click", onClick); }
  const top = el("div", "version-top");
  top.append(el("span", "cell-label", label));
  for (const t of tags) top.append(el("span", "version-tag", t));
  if (detail) top.append(el("span", "cell-detail", detail));
  inner.append(top);
  if (sub) inner.append(el("span", "version-sub", sub));
  if (notes) inner.append(el("p", "version-notes", notes));
  li.append(inner);
  return li;
}

function versionsGroup(cells, footer) {
  const g = el("div", "group");
  const ul = el("ul", "table grouped versions");
  ul.append(...cells);
  g.append(ul);
  if (footer) g.append(el("p", "group-footer", footer));
  return g;
}

// The Version History page. APT: every version any source offers, newest first, with the sources that carry it;
// tapping one offers installing it (N4's queue: Downgrade) or, on the site, its .deb. AltStore: every versions[]
// entry with its date, size, iOS range and notes; one this iPhone runs installs from its own row when it has an
// IPA (or a signed link); the others are greyed.
async function renderVersions(body, route, key, id) {
  body.append(placeholder("page"));
  let history, pkg, sources;
  try {
    await catalog.ensure();
    [history, pkg, sources] = await Promise.all([catalog.history(id, key), catalog.package(id, key), getBackend().sources()]);
  } catch (e) {
    body.replaceChildren(el("p", "empty", e.message));
    return;
  }
  if (!history || !pkg) {
    body.replaceChildren(grouped([{ rows: [{ label: "Package not found" }], footer: id }]));
    return;
  }
  const sourceLabel = (k) => { const s = sources.find((x) => x.key === k); return s ? displayName(s) : k; };
  body.replaceChildren();
  if (history.kind === "ipa") {
    const source = sources.find((s) => s.key === history.key);
    const cells = history.versions.map((v) => {
      const can = v.runs && v.installable;
      return versionCell({
        label: `Version ${v.version}${v.buildVersion ? ` (${v.buildVersion})` : ""}`,
        tags: v.candidate ? ["Latest"] : [],
        detail: formatDate(v.date),
        sub: [formatSize(v.size), v.runs ? osRange(v) : `Needs ${osRange(v) ?? "another iOS version"}`].filter(Boolean).join(" · ") || null,
        notes: v.localizedDescription || null,
        unavailable: !can,
        onClick: can ? async () => {
          const record = recordApp(pkg, source, v);
          // F85: Install and Custom Install go through the queue (Confirm) like the app page's (F84): that version's job.
          // Where Custom Install is on offer (the sideload app) the sheet comes first so it can be picked; elsewhere a
          // tap queues the version, or (no queue: the jailbreak build, no certificate) does what it did before.
          const queued = detectMode() !== "jailbreak";
          const queue = queued ? () => appPageAction(pkg, source, { version: v.version }) : null;
          const customize = queued ? (o) => appPageCustom(pkg, source, o, { version: v.version }) : null;
          const customOffered = localSigning() && !ipaInstallAvailable();
          if (queue && !customOffered && await queue()) return;
          if (!customOffered && await signIfReady(pkg.stanza.ipa ?? { name: history.name, sourceUrl: history.sourceUrl }, v, record)) return;
          const { rows, options } = installRows(v, history.sourceUrl, undefined, record, queue, history.name,
            { ...(customize ? { customize } : {}), bundleId: appBundleId(pkg.stanza.ipa, history.id) });
          sheet(options.itms ? `${history.name} ${v.version}` : `${history.name} ${v.version}\nA sideloader signs it on the iPhone with your Apple ID.`,
            rows.map((r) => ({ label: r.label, run: r.onClick })));
        } : null,
      });
    });
    const off = history.versions.filter((v) => !(v.runs && v.installable)).length;
    body.append(versionsGroup(cells, `Every version ${history.name}'s source lists.${off ? " Greyed ones don't run on this iPhone or have no download." : ""}`));
    return;
  }
  const st = pkg.stanza;
  const site = getBackend().kind === "http";
  const installed = installedOf(history);
  const queue = queueOf({ installed, name: history.name });
  // B11: a paid package its vendor sells only installs through its page's Download & Install, never apt.
  const vendorPaid = queue && isPaid(st) ? await soldByVendor(st, sources.find((s) => s.key === pkg.key)) : false;
  const cells = history.versions.map((v) => {
    const tags = [];
    if (v.candidate) tags.push("Latest");
    if (v.installed) tags.push("Installed");
    const actions = [];
    if (queue && !vendorPaid && v.keys.length) {
      const label = v.version === installed ? "Reinstall" : installed && compareVersions(v.version, installed) < 0 ? "Downgrade" : "Install";
      actions.push({ label, run: () => queue({ op: "install", id, version: v.version }) });
    }
    if (site && v.debUrl && !isPaid(st)) actions.push({ label: "Download .deb", run: () => downloadDeb(v.debUrl, id) });
    return versionCell({
      label: v.version, tags,
      detail: formatSize(v.size),
      sub: v.keys.length ? v.keys.map(sourceLabel).join(", ") : "No source offers it any more",
      unavailable: !v.keys.length,
      onClick: actions.length ? () => sheet(`${history.name} ${v.version}`, actions) : null,
    });
  });
  const how = vendorPaid ? "It's sold by its source: install it with Download & Install on its page." : queue ? "Tap one to install it." : site ? "Tap one for its .deb. Installing an older one is Downgrade, in the jailbreak app." : "Installing an older one is Downgrade, which comes with the install queue.";
  body.append(versionsGroup(cells, `Every version of ${history.name} your sources offer. ${how}`));
}

// The nav bar's right button on this page (Install / Modify), found the way setTitle finds the title.
function setRightLabel(body, label) {
  const page = body.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const item = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i];
  const b = item?.querySelector(".nav-right .bar-button:not(.share-button)"); // F76: not the Share icon
  if (b && b.textContent !== label) b.textContent = label;
}

// F87: in the jailbreak app, an app iFizBox remembers (core/installed.js) at the version on the phone, with I4's note
// where that isn't the one it remembered ("Installed: 1.6 (iFizBox remembered 1.5)", "Not installed (...)").
// Null when iFizBox doesn't remember the app.
async function installedAppGroup(id, { records = () => rememberedApps({ mode: "jailbreak" }) } = {}) {
  let rec;
  try { rec = (await records()).find((r) => r?.id === id && !r.self); } catch { return null; }
  return rec ? grouped([installedAppSection(rec)]) : null;
}

export function installedAppSection(rec) {
  const version = rec.actual === null ? "Not Installed" : rec.version || "Unknown";
  return { header: "Installed App", rows: [{ label: "Version", detail: version }], footer: rec.note || null };
}

// Installed Package (F7, Cydia's Installed Details): the version on the device and the Ignore Upgrades switch
// (Settings' Ignored Upgrades; in the app a dpkg hold, core/settings.js holds). Null when it isn't installed.
async function installedGroup(id) {
  let rows;
  try { rows = await catalog.installed(); } catch { return null; }
  const p = rows?.find((r) => r.id === id);
  if (!p) return null;
  // On the site a hold in the uploaded status file is dpkg's, set on the phone: shown, not switchable here.
  const dpkgHeld = p.held && catalog.statusSource() !== "native";
  const mark = autoMarkShown(settings); // F70: Update Automatically, for Only Packages I Mark
  const frag = grouped([{
    header: "Installed Package",
    rows: [{ label: "Version", detail: p.version }, { label: "Ignore Upgrades", detail: dpkgHeld ? "Held by dpkg" : null },
      ...(mark ? [{ label: AUTO_MARK_LABEL }] : [])],
    footer: "Do not include this package when selecting Upgrade All." + (mark ? " " + AUTO_MARK_FOOTER : ""),
  }]);
  if (!dpkgHeld) {
    // grouped() draws plain rows; the switch goes into its cell afterwards, as on the Settings tab.
    const cell = frag.querySelectorAll(".cell-inner")[1];
    cell.append(createSwitch({ label: "Ignore Upgrades", checked: settings.holds.has(id), onToggle: (on) => { settings.holds.set(id, on); } }));
    cell.classList.add("has-switch");
  }
  if (mark) {
    const cell = frag.querySelectorAll(".cell-inner")[2];
    cell.append(createSwitch({ label: AUTO_MARK_LABEL, checked: settings.autoMarked.has(id), onToggle: (on) => { settings.autoMarked.set(id, on); } }));
    cell.classList.add("has-switch");
  }
  return frag;
}

// F18: the package's dependency problems (core/deps.js explain), each sentence in a cell of its own with its
// action under it: Add <source>, Remove <package> (through N4's queue where the backend has one, else its page),
// Open <package>, or Settings' iOS Version. The firmware explanation goes in the footer.
function depProblemsGroup(report, route, ctx) {
  const frag = document.createDocumentFragment();
  const blocking = report.problems.some((p) => p.blocking);
  report.problems.forEach((p, i) => {
    const g = el("div", "group deps-problem");
    if (i === 0) g.append(el("h2", "group-header", blocking ? "Can't Install Yet" : "Before Installing"));
    // One table: the sentence in a wrapping cell, the action row under it.
    const row = depActionRow(p, route, ctx);
    const ul = row ? grouped([{ rows: [row] }]).firstElementChild.querySelector("ul") : el("ul", "table grouped");
    const li = el("li", "cell");
    li.append(el("div", "pkg-description", p.sentence));
    ul.prepend(li);
    g.append(ul);
    if (p.detail) g.append(el("p", "group-footer", p.detail));
    frag.append(g);
  });
  return frag;
}

function depActionRow(p, route, ctx) {
  const a = p.action;
  if (!a) return p.id && p.id !== "firmware" && p.kind !== "missing" ? { label: p.id, href: deeper(route, token("package", p.id)) } : null;
  switch (a.kind) {
    case "open": return { label: a.label, href: deeper(route, token("package", a.id)) };
    case "add-source": return { label: a.label, subtitle: a.url, chevron: true, onClick: () => addSource(ctx, { url: a.url }) };
    case "settings": return getBackend().kind === "http" ? { label: a.label, href: format(settingsRoute(["iosVersion"])) } : null;
    case "remove": {
      const q = queueOf();
      if (q) return { label: a.label, onClick: () => q({ op: "remove", id: a.id }) };
      return { label: a.label.replace(/^Remove /, "Open "), href: deeper(route, token("package", a.id)) };
    }
    default: return null;
  }
}

// A deep link titles the page with the id until the package loads; then its name goes in the nav bar. app.js
// keeps each tab's pages and nav items in step, so the item has the page's index.
function setTitle(body, title) {
  const page = body.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const item = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i];
  const h1 = item?.querySelector(".nav-title");
  if (h1 && h1.textContent !== title) h1.textContent = title;
}

function downloadGroup(st) {
  const url = st.debUrl;
  const file = decodeURIComponent(url.split("/").pop() || `${st.package}.deb`);
  const g = grouped([{ rows: [{ label: "Download .deb", subtitle: file, href: getBackend().assetUrl(url), chevron: false }],
    footer: "Fetched through this site, for installing by hand." }]);
  const a = g.querySelector("a.cell-inner");
  a.setAttribute("download", file.endsWith(".deb") ? file : `${file}.deb`);
  a.classList.add("download");
  return g;
}

// `json`: the page's own fetch of it (F181: shared with the stars, What's New and Reviews), else fetched here.
async function loadSileo(slot, url, { fallback, json: fetched = null }) {
  slot.append(spinner("Loading Depiction"));
  try {
    const json = fetched ? await fetched : JSON.parse(await getBackend().text(url));
    if (!json) throw new Error("no depiction");
    const dep = renderSileo(json, { open: (u, title) => openSileoSheet(u, title) });
    const g = el("div", "group");
    const t = el("div", "table grouped dep-card");
    t.append(dep);
    g.append(t);
    slot.replaceChildren(g);
    return json; // F122: its screenshots and links go to the gallery and the Links group
  } catch {
    // A dead or broken JSON depiction: show the description instead, as if there were none.
    slot.replaceChildren();
    if (fallback) slot.append(descriptionGroup(fallback)); // F165
    return null;
  }
}

function openSileoSheet(url, title) {
  const box = el("div", "sheet-scroll grouped page-body");
  box.append(spinner("Loading Depiction"));
  showSheet({ title: title || "Depiction", body: box });
  getBackend().text(url).then((t) => {
    const g = el("div", "group");
    const card = el("div", "table grouped dep-card");
    card.append(renderSileo(JSON.parse(t), { open: openSileoSheet }));
    g.append(card);
    box.replaceChildren(g);
  }).catch((e) => box.replaceChildren(el("p", "empty", e.message)));
}

// HTML depictions open in a sheet, in a sandboxed iframe with no bridge to us (docs/cydia.md). An http
// depiction on the https site would be blocked as mixed content, so it comes through the proxy instead, as
// srcdoc with scripts off; everything else loads directly from its own origin.
function openHtmlDepiction(url, title) {
  const frame = document.createElement("iframe");
  frame.className = "depiction-frame";
  frame.title = title;
  frame.referrerPolicy = "no-referrer";
  const mixed = globalThis.location?.protocol === "https:" && /^http:/i.test(url) && getBackend().kind === "http";
  if (mixed) {
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    getBackend().text(url).then((html) => { frame.srcdoc = withBase(html, url); })
      .catch((e) => { frame.srcdoc = `<p style="font:17px Helvetica Neue,sans-serif;text-align:center;margin-top:40px">${escapeHtml(e.message)}</p>`; });
  } else {
    frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms");
    frame.src = url;
  }
  return showSheet({ title, body: frame });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Relative links and images in a proxied depiction resolve against its real URL; links open outside the sheet.
export function withBase(html, url) {
  const base = `<base href="${escapeHtml(url)}" target="_blank">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
}

// ---- Browse (F154) -----------------------------------------------------------------------------------------
//
// Home's Browse page, rebuilt from the approved concept (docs/concepts/browse/browse.dc.html): Featured | New | Top 25
// as a segmented control in a bar at the top of the page, as iOS 6 puts one under the nav bar (in the title's place it
// overlapped Back; a title drop-down isn't iOS 6, user 2026-11-18). Featured: the Tweak of the Day card, the Tweak Roulette row, New This Week, Collections, All Categories.
// New: F124's New list; Top 25: F124's Popular, ranked. No horizontal scroller. Placeholders while loading.
// home.js routes browse/ here (and the pages below it: collection:<id>, categories, roulette).

export const BROWSE_FILTERS = [
  { id: "featured", label: "Featured" },
  { id: "new", label: "New" },
  { id: "top", label: "Top 25" },
];
export const browseFilter = (id) => BROWSE_FILTERS.find((f) => f.id === id) ?? BROWSE_FILTERS[0];
export const TOP_LIMIT = 25;
export const WEEK_DAYS = 7;
const SECTION_ICON = (name) => `icons/sections/${name}.png`;

// The choice lives for the session; the page on screen.
const browseHome = { filter: "featured", page: null };
export const browseFilterNow = () => browseHome.filter;

// The Browse page's nav bar: "Browse" (also the back button of the pages above it).
export function browseHomeNav() {
  return { title: "Browse" };
}

// The bar at the top of the page: Featured | New | Top 25 (Search's scope bar and segments).
function filterBar() {
  const bar = el("div", "search-scope browse-scope");
  bar.append(segments(BROWSE_FILTERS.map((f) => f.id), Object.fromEntries(BROWSE_FILTERS.map((f) => [f.id, f.label])),
    browseHome.filter, (id) => setBrowseFilter(id)));
  return bar;
}

// Shows filter `id` (unknown ids: Featured): the page on screen redraws in place, its bar showing the choice.
export function setBrowseFilter(id) {
  const f = browseFilter(id);
  browseHome.filter = f.id;
  if (browseHome.page?.body.isConnected) drawBrowseHome(browseHome.page);
  return f.id;
}

// What each filter draws: the rows' source and how they read. Top 25 is ranked (rank on every row).
export function filterView(id, { fresh, popular }) {
  const f = browseFilter(id);
  if (f.id === "new") return { id: "new", rows: () => fresh("new"), ranked: false, empty: "Nothing new lately. Packages your sources add show up here after a refresh." };
  if (f.id === "top") return { id: "top", rows: async () => (await popular({ limit: TOP_LIMIT })).slice(0, TOP_LIMIT), ranked: true,
    empty: "Add a source to see what's popular.", footer: "Ranked by how many of your sources list each package." };
  return { id: "featured" };
}

// `opts`: { jailbroken, featured: () => rows (the sources' featured packages), headers: rows -> items (New's days) }.
export function renderBrowseHome(body, route, opts = {}) {
  const page = { body, route, turn: 0, list: null, ...opts };
  browseHome.page = page;
  return drawBrowseHome(page);
}

function drawBrowseHome(page) {
  const turn = ++page.turn;
  page.list?.destroy();
  page.list = null;
  const { body } = page;
  const featured = browseHome.filter === "featured";
  body.classList.toggle("grouped", featured);
  body.classList.toggle("plain", !featured);
  page.bar = filterBar();
  body.replaceChildren(page.bar);
  body.scrollTop = 0;
  return featured ? drawFeatured(page, turn) : drawFilterList(page, turn);
}

async function drawFilterList(page, turn) {
  const { body, route } = page;
  const v = filterView(browseHome.filter, { fresh: catalog.fresh, popular: catalog.popular });
  body.append(placeholder("list", 8));
  let rows;
  try {
    await catalog.ensure();
    rows = await v.rows();
  } catch (e) {
    if (turn === page.turn) body.replaceChildren(page.bar, el("p", "empty", e.message));
    return;
  }
  if (turn !== page.turn || !body.isConnected) return;
  body.replaceChildren(page.bar);
  if (!rows.length) { body.append(el("p", "empty", v.empty)); return; }
  const items = v.ranked ? rows.map((r, i) => ({ ...r, rank: i + 1 })) : page.headers ? page.headers(rows) : rows;
  page.list = packageList(body, route, items, { letters: false, decorate: v.ranked ? rankRow : null });
  page.list.el.classList.add(v.ranked ? "browse-ranked" : "browse-new");
  body.append(page.list.el);
  if (v.footer) body.append(el("p", "browse-list-footer", v.footer));
}

// Top 25: the rank at the row's left (packages.css .pkg-rank).
function rankRow(row, item) {
  let r = row._.rank;
  if (!r) { r = row._.rank = el("span", "pkg-rank"); row._.a.prepend(r); }
  r.textContent = item.rank ? String(item.rank) : "";
}

const pkgHref = (route, id) => format({ tab: route.tab, path: [...route.path, token("package", id)] });

async function drawFeatured(page, turn) {
  const { body, route } = page;
  const jailbroken = page.jailbroken ?? true;
  const heroSlot = el("div", "browse-hero-slot");
  heroSlot.append(heroCard(null, { jailbroken }));
  const freshGroup = el("div", "group browse-fresh");
  const head = el("h2", "group-header browse-head");
  const seeAll = el("button", "browse-see-all", "See All");
  seeAll.type = "button";
  seeAll.addEventListener("click", () => setBrowseFilter("new"));
  head.append(el("span", null, "New This Week"), seeAll);
  const freshList = el("ul", "table grouped");
  freshList.append(...phCells(3));
  freshGroup.append(head, freshList);
  const roulette = grouped([rouletteRow({ jailbroken, streak: currentStreak(readSpins(), dayKey()) })]);
  for (const g of roulette.children) g.classList.add("browse-roulette");
  const collections = grouped([{ header: "Collections", rows: collectionsFor(jailbroken).map((c) => ({
    label: c.title, subtitle: c.subtitle, href: format({ tab: route.tab, path: [...route.path, `collection:${c.id}`] }),
    icon: { src: SECTION_ICON(c.icon) }, cls: "browse-icon-row" })) }]);
  const all = grouped([{ rows: [{ label: "All Categories", href: format({ tab: route.tab, path: [...route.path, "categories"] }) }] }]);
  body.append(heroSlot, roulette, freshGroup, collections, all);

  let popular = [], featured = [], fresh = [];
  try {
    await catalog.ensure();
    [popular, featured, fresh] = await Promise.all([
      catalog.popular({ limit: 60 }).catch(() => []),
      (page.featured ? page.featured() : Promise.resolve([])).catch(() => []),
      catalog.fresh("new").catch(() => []),
    ]);
  } catch (e) {
    if (turn === page.turn) heroSlot.replaceChildren(el("p", "empty", e.message));
  }
  if (turn !== page.turn || !body.isConnected) return;
  // Tweak of the Day: the sources' featured packages and the popular ones, of this build's kind when there are any.
  const pool = [...featured, ...popular];
  const kind = pool.filter((r) => browseKind(r, jailbroken));
  const pick = dailyPick(kind.length ? kind : pool, dayKey());
  heroSlot.replaceChildren(pick ? heroCard(pick, { jailbroken, href: pkgHref(route, pick.id) }) : "");
  if (pick) rememberNames([pick]);
  const week = fresh.filter((r) => r.seen >= Date.now() - WEEK_DAYS * 86400000).slice(0, 3);
  rememberNames(week);
  if (week.length) freshList.replaceChildren(...week.map((r) => pkgCell(r, pkgHref(route, r.id))));
  else {
    freshList.remove();
    freshGroup.append(el("p", "group-footer", "Nothing new this week. New packages show up here after a refresh."));
  }
}

// Grey pulsing rows the shape of a package cell (nav/ui.js placeholder's look), for a grouped table.
function phCells(n) {
  return Array.from({ length: n }, (_, i) => {
    const li = el("li", "cell");
    const inner = el("div", "cell-inner browse-ph");
    const lines = el("span", "ph-lines");
    lines.append(el("span", `ph-bar ${["ph-w50", "ph-w35", "ph-w60"][i % 3]}`), el("span", "ph-bar ph-sub ph-w70"));
    inner.append(el("span", "ph-box ph-icon"), lines);
    li.append(inner);
    return li;
  });
}

// A package as a grouped cell: its icon (the section's until its own loads), name, short description, chevron.
function pkgCell(row, href) {
  const li = el("li", "cell browse-icon-row");
  const a = el("a", "cell-inner chevron");
  a.href = href;
  a.append(iconBox(row, "cell-icon"));
  const text = el("span", "cell-text");
  text.append(el("span", "cell-label", row.name), el("span", "cell-subtitle", row.short || row.section || ""));
  a.append(text);
  li.append(a);
  return li;
}

// The package's icon over its section's (core/sectionicons.js packageIcon), dropped when it fails to load.
export function iconBox(row, cls) {
  const look = packageIcon(row);
  const box = el("span", cls);
  box.style.backgroundImage = `url("${look.fallback}")`;
  const src = iconSrc(row);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    box.append(img);
  }
  return box;
}

// The Tweak of the Day card (null: its placeholder while the lists load). The whole card opens the package.
function heroCard(row, { jailbroken = true, href = null } = {}) {
  const card = el(row ? "a" : "div", "browse-hero");
  if (!row) { card.classList.add("is-loading"); card.setAttribute("aria-busy", "true"); card.setAttribute("aria-label", "Loading"); }
  card.append(el("span", "browse-hero-kicker", jailbroken ? "TWEAK OF THE DAY" : "APP OF THE DAY"));
  const main = el("span", "browse-hero-row");
  const words = el("span", "browse-hero-words");
  if (row) {
    card.href = href;
    main.append(iconBox(row, "browse-hero-icon"));
    words.append(el("span", "browse-hero-name", row.name), el("span", "browse-hero-desc", row.short || ""));
  } else {
    main.append(el("span", "browse-hero-icon ph-box"));
    words.append(el("span", "ph-bar ph-w60"), el("span", "ph-bar ph-sub ph-w70"));
  }
  main.append(words);
  const foot = el("span", "browse-hero-foot");
  if (row) foot.append(el("span", "browse-hero-meta", [row.paid ? "Paid" : "Free", row.section].filter(Boolean).join(" · ")), el("span", "browse-hero-view", "View"));
  card.append(main, foot);
  return card;
}
