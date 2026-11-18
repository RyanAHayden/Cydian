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
import { grouped } from "../nav/ui.js";
import { createVList, withLetterHeaders } from "../nav/vlist.js";
import { showSheet } from "../nav/sheet.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { catalog, ALL } from "../catalog.js";
import { NO_SECTION, indexLetter, parseAuthor, simpleSection } from "../core/catalog.js";
import { description, parseRelations, compareVersions } from "../core/apt.js";
import { displayName, releaseDepiction } from "../core/sources.js";
import { renderSileo, mediaUrl } from "./depiction.js";
import { settings, createSwitch } from "./settings.js";
import { initDevice, filterRow, compatBadge, currentDevice } from "../device.js";
import { compat, markOf, isIncompatible } from "../core/compat.js";
import { isAltKey } from "../core/altstore.js";
import { renderAltSource, renderApp, installRows, formatDate, osRange } from "./altstore.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { signingReady, signingAvailable, signAndInstall, localSigning } from "../signing-client.js";
import { installOptions } from "../core/altstore.js";
import { detectMode } from "../core/settings.js";
import { apps, recordInstall } from "../core/installed.js";
import { openInGroup } from "./handoff.js";
import { healthOf } from "../core/health.js";
import { addSource } from "./manage.js";
import { featuredStrip, paymentGroup } from "./extras.js";
import { installQueue } from "../queue.js";
import { queuedFor, MODE_LABEL } from "../core/queue.js";

export const ROW_HEIGHT = 58;
export const SECTION_ROW_HEIGHT = 46;

// Section Visibility (F24): the hidden sections live on the device (core/settings.js hiddenSections) and reach
// the worker's catalog before its next answer, so every list, Search and Changes leave them out.
catalog.setHidden(settings.hiddenSections.list());
settings.onChange((key, value) => { if (key === "hiddenSections") catalog.setHidden(value); });
// Works on My Phone (F17): the device and the filter reach the worker the same way.
initDevice();

// Compatibility marks (F35): Settings > Show Compatibility Marks hides them all with one attribute, so rows bound
// while scrolling never read the setting.
function applyMarks() {
  if (globalThis.document?.documentElement) document.documentElement.dataset.compatMarks = settings.get("compatMarks") ? "on" : "off";
}
applyMarks();
settings.onChange((key) => { if (key === "compatMarks") applyMarks(); });

const MARK_LABEL = { works: "Works on this iPhone", no: "Doesn't work on this iPhone", unknown: "Compatibility unknown" };

// The mark for a row's compat code: data-mark works | no | unknown (packages.css draws it); none when unjudged.
export function setMark(span, code) {
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
    case "author": return renderList(body, route, () => catalog.author(p.value), true);
    case "package": return renderPackage(body, route, p.key, p.value, ctx);
    case "versions": return renderVersions(body, route, p.key, p.value);
    default:
      body.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing here." }));
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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
  body.replaceChildren(spinner());
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
  // F8: Open In, this source in another package manager, under the sections.
  if (!editing && key !== ALL) {
    const source = await getBackend().sources().then((l) => l.find((x) => x.key === key)).catch(() => null);
    if (source && turn === page.draw && body.isConnected) {
      body.prepend(featuredStrip(source)); // F20: the source's sileo-featured.json banners, above its sections
      body.append(openInGroup(source));
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

// A letter tile until the icon loads (Cydia: the section icon, then unknown.png; those are Cydia's artwork).
const TINTS = ["#8c99b3", "#7a9a8c", "#a38c7a", "#8c7aa3", "#7a8ca3", "#a37a8c", "#909090"];
function tint(section) {
  let h = 0;
  for (const c of simpleSection(section)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

function createRow() {
  const row = el("div", "pkg-row");
  const a = el("a", "cell-inner pkg");
  const icon = el("span", "pkg-icon");
  const letter = el("span", "pkg-letter");
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.onload = () => { iconOk.add(img.dataset.url); img.classList.add("loaded"); };
  img.onerror = () => { iconBad.add(img.dataset.url); img.removeAttribute("src"); };
  icon.append(letter, img);
  const text = el("span", "pkg-text");
  const top = el("span", "pkg-top");
  const compatEl = el("span", "compat-mark"); // F35: the check, X or ? (F17's text badge is on the package page)
  top.append(el("span", "pkg-name"), compatEl, el("span", "pkg-version"));
  text.append(top, el("span", "pkg-desc"));
  a.append(icon, text);
  row.append(a);
  row._ = { a, icon, letter, img, name: top.firstChild, compat: compatEl, version: top.lastChild, desc: text.lastChild };
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
  r.letter.textContent = indexLetter(item.name) === "#" ? item.name.charAt(0) : indexLetter(item.name);
  r.icon.style.background = tint(item.section);
  const src = iconSrc(item);
  // Icons only load once scrolling stops (idle), unless this one already loaded: a fling starts no fetches.
  if (src && iconOk.has(item.icon)) {
    if (r.img.dataset.url !== item.icon) { r.img.dataset.url = item.icon; r.img.src = src; }
    r.img.classList.add("loaded");
  } else {
    r.img.classList.remove("loaded");
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
  return list;
}

// Exported for Home's Browse (F46).
export async function renderList(body, route, fetchRows, letters) {
  body.append(spinner());
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

// ---- the package page --------------------------------------------------------------------------------------

export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const httpUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : null);

async function renderPackage(body, route, key, id, ctx) {
  body.append(spinner("Loading"));
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
    renderApp(body, route, pkg, altSrc);
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
  const groups = [];

  // Header: icon, name, version, size.
  const head = el("div", "pkg-head");
  const icon = el("span", "pkg-icon large");
  icon.style.background = tint(pkg.row.section);
  icon.append(el("span", "pkg-letter", name.charAt(0).toUpperCase()));
  const src = st.iconUrl && mediaUrl(st.iconUrl);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.onload = () => img.classList.add("loaded");
    img.onerror = () => img.remove();
    img.src = src;
    icon.append(img);
  }
  const ht = el("div", "pkg-head-text");
  // Works on my phone (F17): judged here from the stanza, so an installed-only page gets one too.
  const fit = compat(st, currentDevice());
  const fitCode = fit.status === "no" ? fit.reason : fit.status;
  const nameLine = el("span", "pkg-head-top");
  const headMark = el("span", "compat-mark large");
  setMark(headMark, fitCode);
  nameLine.append(el("span", "pkg-head-name", name), headMark);
  ht.append(nameLine);
  const headAuthor = parseAuthor(st.author) || parseAuthor(st.maintainer);
  if (headAuthor) { // F29: who made it, under the name; opens their packages
    const a = el("a", "pkg-head-author", headAuthor.name);
    a.href = deeper(route, token("author", headAuthor.name));
    ht.append(a);
  }
  ht.append(el("span", "pkg-head-version", st.version ?? ""));
  const fitBadge = el("span", "pkg-compat", fit.label);
  fitBadge.dataset.compat = fitCode;
  ht.append(fitBadge);
  const size = formatSize(st.size);
  head.append(icon, ht);
  if (size) head.append(el("span", "pkg-head-size", size));
  const headGroup = el("div", "group");
  const headTable = el("div", "table grouped pkg-head-table");
  headTable.append(head);
  headGroup.append(headTable);

  // Author and Maintainer: each opens everything by that person.
  const people = [];
  const author = parseAuthor(st.author);
  const maint = parseAuthor(st.maintainer);
  if (author) people.push({ label: "Author", detail: author.name, href: deeper(route, token("author", author.name)) });
  if (maint && maint.name.toLowerCase() !== author?.name.toLowerCase()) {
    people.push({ label: author ? "Maintainer" : "Contact", detail: maint.name, href: deeper(route, token("author", maint.name)) });
  }
  if (people.length) groups.push({ rows: people });

  // Depiction: Sileo JSON drawn natively below; else an HTML depiction in a sheet, and the description. A package
  // with no Depiction: of its own gets the source's Release template (Cydia's fallback; an own non-http one
  // still counts as having one, so it gets neither).
  const sileo = httpUrl(st.sileodepiction);
  const html = st.depiction?.trim() ? httpUrl(st.depiction) : releaseDepiction(source, st.package || id);
  const depictionSlot = el("div", "depiction-slot");
  const more = [];
  if (html) more.push({ label: "Depiction", onClick: () => openHtmlDepiction(html, name) });
  const homepage = httpUrl(st.homepage);
  if (homepage) more.push({ label: "More Information", subtitle: homepage, onClick: () => window.open(homepage, "_blank", "noopener") });
  const descText = desc.long || desc.short;

  // Details.
  const details = [{ label: "Version", detail: st.version ?? "" }];
  if (size) details.push({ label: "Size", detail: size });
  const inst = Number(st["installed-size"]);
  if (inst > 0) details.push({ label: "Installed Size", detail: formatSize(inst * 1024) });
  details.push({ label: "Section", detail: pkg.row.section === NO_SECTION ? "—" : pkg.row.section });
  if (!pkg.installedOnly) {
    details.push({ label: "Source", detail: sourceName || "Unknown",
      href: route.tab === "sources" && route.path[0] === pkg.key ? null : format({ tab: "sources", path: [pkg.key] }) });
  }
  details.push({ label: "Identifier", detail: st.package });
  if (st.architecture) details.push({ label: "Architecture", detail: st.architecture });

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

  body.replaceChildren(headGroup);
  if (!pkg.installedOnly) body.append(paymentGroup(st, source, ctx)); // F20: price; in the app Sign In, Buy, Install
  const later = [];
  if (groups.length) later.push(...groups);
  body.append(grouped(later));
  body.append(depictionSlot);
  if (!sileo && descText) {
    const g = el("div", "group");
    const t = el("div", "table grouped pkg-description");
    t.textContent = descText;
    g.append(t);
    body.append(g);
  }
  if (more.length) body.append(grouped([{ rows: more.map((r) => ({ ...r, chevron: true })) }]));
  body.append(grouped([{ header: "Details", rows: details }]));
  // F29: Version History, every version the sources offer (Downgrade's list); and Modify once it's installed.
  const history = await catalog.history(id, key).catch(() => null);
  rememberPackage(body, route, { id, pkg, source, history });
  if (history?.versions.length) body.append(versionHistoryRow(route, id, history));
  body.append(grouped([{ header: "Works on My Phone", rows: [{ label: compatBadge(fitCode) }],
    footer: fit.detail }]));
  if (queueOf()) {
    const slot = el("div", "package-queue-slot");
    slot.dataset.id = st.package || id;
    fillQueueSlot(slot);
    body.append(slot);
  }
  const installedEl = await installedGroup(st.package || id);
  if (installedEl) body.append(installedEl);
  if (depReport?.problems.length) body.append(depProblemsGroup(depReport, route, ctx));
  if (depRows.length) body.append(grouped([{ header: "Depends", rows: depRows }]));
  if (conflicts.length) body.append(grouped([{ header: "Conflicts", rows: conflicts }]));
  // An installed package no source carries (F27) has no source to name: its page is the status stanza alone.
  if (!pkg.installedOnly) body.append(grouped([{ header: pkg.others.length > 1 ? "Sources" : "Source", rows: srcRows }]));
  // F8: Open In, the package in another package manager (and its source from another device).
  if (!pkg.installedOnly && source) body.append(openInGroup(source, { pkg: st.package || id }));
  if (st.debUrl && getBackend().kind === "http") {
    // Paid packages (cydia::commercial) only download for a buyer's device: the repo refuses the proxy.
    if (/(^|,)\s*cydia::commercial\s*(,|$)/.test(st.tag ?? "")) body.append(grouped([{ footer: "A paid package: buy and install it from a package manager on the phone." }]));
    else body.append(downloadGroup(st));
  }
  body.append(grouped([{ footer: `${st.package}\n${[sourceName, pkg.row.section].filter(Boolean).join(" · ")}` }]));

  if (sileo) loadSileo(depictionSlot, sileo, { fallback: descText });
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
  setRightLabel(body, installed ? "Modify" : "Install");
}

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

// F30's record of an app installed without a jailbreak (as renderApp does for its Install rows).
function recordApp(pkg, source, v) {
  if (detectMode() === "jailbreak") return undefined;
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
    // I5: with the user's own certificate (Settings > Signing), Install signs this app and installs it.
    if (await signIfReady(st.ipa, v, recordApp(pkg, source, v))) return;
    const { rows, options } = installRows(v, st.ipa.sourceUrl, undefined, recordApp(pkg, source, v));
    for (const r of rows) actions.push({ label: r.label, run: r.onClick });
    if (many) actions.push({ label: "Version History", run: () => go(versionsHref(route, id)) });
    if (!options.itms && (signingAvailable() || localSigning())) actions.push({ label: "Sign with My Certificate", run: () => go(format({ tab: "settings", path: ["signing"] })) });
    return sheet(options.itms ? "" : "This app needs signing: a sideloader signs it on the iPhone with your Apple ID, or add your own certificate in Settings > Signing.", actions);
  }
  const installed = installedOf(history);
  const queue = queueOf({ installed, name: pkg.row?.name });
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
  if (st.debUrl && getBackend().kind === "http" && !isPaid(st)) actions.push({ label: "Download .deb", run: () => downloadDeb(st.debUrl, st.package) });
  const title = queue ? "" : getBackend().kind === "http"
    ? "Packages install on the iPhone, from Cydian's jailbreak app or another package manager."
    : "Installing from Cydian comes with its install queue, which this build doesn't have yet.";
  return sheet(title, actions);
}

// I5: sign `v` with the saved certificate and install it, when one is saved and the version has an IPA. True when
// signing took over (whatever its outcome: errors are shown in an alert).
async function signIfReady(app, v, record) {
  const url = installOptions(v, app.sourceUrl).download;
  if (!url || !(await signingReady())) return false;
  await signAndInstall({ url, name: app.name, onInstalled: () => record?.() });
  return true;
}

// The package page's row to its Version History: how many versions are on offer.
function versionHistoryRow(route, id, history) {
  const n = history.versions.filter((v) => (history.kind === "ipa" ? true : v.keys.length)).length;
  return grouped([{ rows: [{ label: "Version History", detail: n === 1 ? "1 version" : `${n} versions`, href: versionsHref(route, id) }] }]);
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
  body.append(spinner("Loading"));
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
          if (await signIfReady(pkg.stanza.ipa ?? { name: history.name, sourceUrl: history.sourceUrl }, v, recordApp(pkg, source, v))) return;
          const { rows, options } = installRows(v, history.sourceUrl, undefined, recordApp(pkg, source, v));
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
  const cells = history.versions.map((v) => {
    const tags = [];
    if (v.candidate) tags.push("Latest");
    if (v.installed) tags.push("Installed");
    const actions = [];
    if (queue && v.keys.length) {
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
  const how = queue ? "Tap one to install it." : site ? "Tap one for its .deb. Installing an older one is Downgrade, in the jailbreak app." : "Installing an older one is Downgrade, which comes with the install queue.";
  body.append(versionsGroup(cells, `Every version of ${history.name} your sources offer. ${how}`));
}

// The nav bar's right button on this page (Install / Modify), found the way setTitle finds the title.
function setRightLabel(body, label) {
  const page = body.closest(".page");
  const stack = page?.parentElement;
  if (!stack) return;
  const i = [...stack.children].filter((c) => c.classList.contains("page")).indexOf(page);
  const item = document.querySelectorAll(`.nav-stack[data-tab="${stack.dataset.tab}"] > .nav-item`)[i];
  const b = item?.querySelector(".nav-right .bar-button");
  if (b && b.textContent !== label) b.textContent = label;
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
  const frag = grouped([{
    header: "Installed Package",
    rows: [{ label: "Version", detail: p.version }, { label: "Ignore Upgrades", detail: dpkgHeld ? "Held by dpkg" : null }],
    footer: "Do not include this package when selecting Upgrade All.",
  }]);
  if (!dpkgHeld) {
    // grouped() draws plain rows; the switch goes into its cell afterwards, as on the Settings tab.
    const cell = frag.querySelectorAll(".cell-inner")[1];
    cell.append(createSwitch({ label: "Ignore Upgrades", checked: settings.holds.has(id), onToggle: (on) => { settings.holds.set(id, on); } }));
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
    case "settings": return getBackend().kind === "http" ? { label: a.label, href: format({ tab: "settings", path: ["iosVersion"] }) } : null;
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

async function loadSileo(slot, url, { fallback }) {
  slot.append(spinner("Loading Depiction"));
  try {
    const json = JSON.parse(await getBackend().text(url));
    const dep = renderSileo(json, { open: (u, title) => openSileoSheet(u, title) });
    const g = el("div", "group");
    const t = el("div", "table grouped dep-card");
    t.append(dep);
    g.append(t);
    slot.replaceChildren(g);
  } catch {
    // A dead or broken JSON depiction: show the description instead, as if there were none.
    slot.replaceChildren();
    if (fallback) {
      const g = el("div", "group");
      const t = el("div", "table grouped pkg-description");
      t.textContent = fallback;
      g.append(t);
      slot.append(g);
    }
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
export function openHtmlDepiction(url, title) {
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
